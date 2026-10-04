"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { preload } from "react-dom";
import { CheckCircle2, Download, Keyboard } from "lucide-react";
import { AppHeader } from "@/components/app-shell/app-header";
import { AiAnnotateDialog } from "@/components/annotate/ai-annotate-dialog";
import { AiJobStatusChip } from "@/components/annotate/ai-job-status-chip";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import type { BoxRect } from "@/components/annotate/annotation-canvas";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
import {
  AnnotationToolbar,
  type AiAnnotateScope,
} from "@/components/annotate/annotation-toolbar";
import { CanvasPlaceholder } from "@/components/annotate/canvas-placeholder";
import { ImageStrip } from "@/components/annotate/image-strip";
import { KeyboardShortcutsDialog } from "@/components/annotate/keyboard-shortcuts-dialog";
import { SuggestionReviewCard } from "@/components/annotate/suggestion-review-card";
import { Button } from "@/components/ui/button";
import { useAnnotationJob } from "@/hooks/use-annotation-job";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useSerialQueue } from "@/hooks/use-serial-queue";
import { saveImageAnnotations } from "@/lib/actions/annotations";
import { saveImageThumbhash } from "@/lib/actions/images";
import { createLabel, deleteLabel, renameLabel } from "@/lib/actions/labels";
import { resolveSuggestions } from "@/lib/actions/suggestions";
import {
  acceptAllSuggestions,
  acceptedBoxes,
  acceptSuggestion,
  addBox,
  addSuggestions,
  duplicateBox,
  editorReducer,
  hasServerSuggestions,
  hasUnsavedBoxes,
  moveLayer,
  openEditor,
  pendingSuggestions,
  planSave,
  rejectAllSuggestions,
  relabelSuggestion,
  removeBox,
  replaceBoxes,
  sessionsReducer,
  updateBox,
  type EditorAction,
  type EditorSessions,
  type EditorSnapshot,
  type ImageEditor,
  type LayerMove,
  type ReviewCardView,
  type SavePlan,
} from "@/lib/annotations/editor";
import { loadUnsavedDraft, saveAnnotations } from "@/lib/annotations/storage";
import { createWorkspaceCache } from "@/lib/annotations/workspace-cache";
import { createThumbhash } from "@/lib/image-placeholder";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  AnnotationSuggestion,
  AnnotationTool,
  BoundingBox,
  ImageAiState,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

const AnnotationCanvas = dynamic(
  () =>
    import("@/components/annotate/annotation-canvas").then(
      (mod) => mod.AnnotationCanvas,
    ),
  // The frame's CanvasPlaceholder shows through while the canvas code loads.
  { ssr: false, loading: () => null },
);

const AUTOSAVE_DELAY_MS = 1500;
/** Continuous editing still saves at least this often. */
const AUTOSAVE_MAX_WAIT_MS = 10_000;
/** A failed save retries after 2 s, 4 s, 8 s, 16 s, 30 s; then it waits for an edit or Save. */
const SAVE_RETRY_LIMIT = 5;
const SAVE_RETRY_MAX_DELAY_MS = 30_000;

function saveRetryDelay(failures: number) {
  return Math.min(2000 * 2 ** (failures - 1), SAVE_RETRY_MAX_DELAY_MS);
}

const NO_BOXES: BoundingBox[] = [];

/** Tailwind `xl` (80rem): the review card overlays the right column from here. */
const XL_QUERY = "(min-width: 80rem)";

function subscribeToXl(onChange: () => void) {
  const query = window.matchMedia(XL_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getIsXl() {
  return window.matchMedia(XL_QUERY).matches;
}

function getIsXlOnServer() {
  return true;
}

function subscribeToNothing() {
  return () => {};
}

/** False while server rendering and hydrating, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false);
}

function imageHref(projectId: string, imageId: string) {
  return `/projects/${projectId}/annotate/${imageId}`;
}

function isRunActive(job: AnnotationJobProgress | null) {
  return job?.status === "queued" || job?.status === "running";
}

/** An image's AI state as a cache version: a newer AI result changes it. */
function aiStateVersion(state: ImageAiState | undefined) {
  return state ? `${state.status}:${state.pendingSuggestions}` : "none";
}

/**
 * Local labels updated with fresh server labels: server versions win for
 * shared IDs, local additions are kept, locally deleted labels stay deleted.
 */
function mergeLabels(
  local: AnnotationLabel[],
  server: AnnotationLabel[],
  deletedIds: ReadonlySet<string>,
) {
  const serverById = new Map(server.map((label) => [label.id, label]));
  const merged = local
    .filter((label) => !deletedIds.has(label.id))
    .map((label) => serverById.get(label.id) ?? label);
  const known = new Set(merged.map((label) => label.id));
  for (const label of server) {
    if (!known.has(label.id) && !deletedIds.has(label.id)) merged.push(label);
  }
  return merged;
}

/** `failures`: consecutive failed saves (retried up to `SAVE_RETRY_LIMIT`). */
type SaveStatus = { error: string | null; savedAt: Date | null; failures: number };

/** Keys that switch tools (shown in the toolbar tooltips and Shortcuts dialog). */
const TOOL_KEYS = new Map<string, AnnotationTool>([["v", "select"], ["b", "bbox"], ["h", "pan"]]);

/** Accepted (non-suggestion) boxes exist: the strip marks the image annotated. */
function hasAcceptedBoxes(editor: ImageEditor) {
  return editor.present.boxes.some((box) => !editor.present.meta[box.id]);
}

type AnnotationWorkspaceProps = {
  project: Project;
  /** Never empty: the annotate layout sends empty projects back to the project page. */
  images: ProjectImage[];
  labels: AnnotationLabel[];
  latestJob: AnnotationJobProgress | null;
  aiStates: Record<string, ImageAiState>;
};

/**
 * The annotation workspace for one project. The annotate layout mounts it
 * once per project visit and it stays mounted while the user moves between
 * images: the open image comes from the URL, which image switches update with
 * `history.pushState` (no server round trip), so only the canvas changes.
 * Each opened image keeps its editor session, undo history included.
 */
export function AnnotationWorkspace({
  project,
  images,
  labels: serverLabels,
  latestJob,
  aiStates: serverAiStates,
}: AnnotationWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [cache] = useState(() => createWorkspaceCache(project.id));

  const routeImageId = pathname.split("/").pop();
  const activeIndex = Math.max(
    0,
    images.findIndex((image) => image.id === routeImageId),
  );
  const activeImage = images[activeIndex];
  const activeImageId = activeImage.id;

  // Start the open image's download from the server-rendered HTML.
  if (activeImage.url) {
    preload(activeImage.url, { as: "image", fetchPriority: "high" });
  }

  const [labels, setLabels] = useState(serverLabels);
  /** Labels deleted here, so a stale server list cannot bring them back. */
  const deletedLabelIdsRef = useRef(new Set<string>());
  const [syncedServerLabels, setSyncedServerLabels] = useState(serverLabels);
  if (serverLabels !== syncedServerLabels) {
    setSyncedServerLabels(serverLabels);
    setLabels((current) =>
      mergeLabels(current, serverLabels, deletedLabelIdsRef.current),
    );
  }
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const activeLabelId = labels.some((label) => label.id === selectedLabelId)
    ? selectedLabelId
    : (labels[0]?.id ?? "");

  // Sessions open on the client only: an unsaved sessionStorage draft (edits
  // from this tab that never reached the server) wins over the server copy,
  // and is then saved. Saved drafts are ignored: the server may be newer.
  const [sessions, dispatch] = useReducer(sessionsReducer, {} as EditorSessions);
  const session = sessions[activeImageId];
  if (hydrated && !session) {
    dispatch({
      type: "open",
      imageId: activeImageId,
      editor: openEditor(
        activeImage.annotations,
        loadUnsavedDraft(project.id, activeImageId) ?? undefined,
      ),
    });
  }
  const present = session?.present;
  const boxes = present?.boxes ?? NO_BOXES;

  const [selection, setSelection] = useState<{ imageId: string; boxId: string } | null>(null);
  const selectedBoxId =
    selection?.imageId === activeImageId &&
    boxes.some((box) => box.id === selection.boxId)
      ? selection.boxId
      : null;
  /** Natural size of the open image once the canvas has loaded it. */
  const [loadedImage, setLoadedImage] = useState<{
    imageId: string;
    width: number;
    height: number;
  } | null>(null);
  const imageSize = loadedImage?.imageId === activeImageId ? loadedImage : null;

  const [tool, setTool] = useState<AnnotationTool>("select");
  const [zoom, setZoom] = useState(100);
  const [fitToken, setFitToken] = useState(0);
  const [saveFlash, setSaveFlash] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const [suggestionsError, setSuggestionsError] = useState<{ imageId: string; message: string } | null>(null);
  /** Per image, the AI state version whose suggestions were all reviewed here. */
  const [reviewed, setReviewed] = useState<Record<string, string>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [aiAnnotateOpen, setAiAnnotateOpen] = useState(false);
  const [aiAnnotateScope, setAiAnnotateScope] = useState<AiAnnotateScope>("current");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Only while "Add & review next" saves and switches images; routine
  // auto-saves must not disable the review card.
  const [isAdvancingReview, startAdvancingReview] = useTransition();
  const {
    isFullscreen,
    isOverlayOnly,
    toggle: toggleFullscreen,
    exitOverlay,
  } = useFullscreen();
  const isXl = useSyncExternalStore(subscribeToXl, getIsXl, getIsXlOnServer);
  const { run: runSave, settled: savesSettled, isBusy: isSaving } = useSerialQueue();

  /** Latest values for stable callbacks (image switching, saves). */
  const latest = useRef({ sessions, activeImageId, aiStates: serverAiStates, labels, isSaving });
  /** Consecutive failed saves and the pending retry, per image. */
  const saveFailuresRef = useRef(new Map<string, number>());
  const retryTimersRef = useRef(new Map<string, number>());
  /** Set once `saveNow` exists, so a failed save can schedule its retry. */
  const retrySaveRef = useRef<(imageId: string) => void>(() => undefined);

  const editImage = useCallback(
    (imageId: string, action: EditorAction) => dispatch({ type: "edit", imageId, action }),
    [],
  );
  const commit = useCallback(
    (update: (present: EditorSnapshot) => EditorSnapshot) =>
      editImage(activeImageId, { type: "commit", update }),
    [activeImageId, editImage],
  );

  /**
   * Persists a save plan through the serialized save queue: accepted boxes
   * first, then the review decisions, so a failure in between can only leave
   * a suggestion that is already accepted (syncing skips those by box ID).
   */
  const persist = useCallback(
    async (imageId: string, plan: SavePlan) => {
      const version = aiStateVersion(latest.current.aiStates[imageId]);
      window.clearTimeout(retryTimersRef.current.get(imageId));
      retryTimersRef.current.delete(imageId);
      try {
        const result = await runSave(async () => {
          const saved = plan.boxes
            ? await saveImageAnnotations(project.id, imageId, plan.boxes)
            : null;
          if (plan.resolutions.length > 0) {
            await resolveSuggestions(project.id, plan.resolutions);
          }
          return saved;
        });
        editImage(imageId, { type: "saved", plan });
        saveFailuresRef.current.delete(imageId);
        setSaveStatus((current) => ({
          ...current,
          [imageId]: {
            error: null,
            savedAt: result ? new Date(result.savedAt) : (current[imageId]?.savedAt ?? null),
            failures: 0,
          },
        }));
        if (plan.clearsReview) {
          setReviewed((current) => ({ ...current, [imageId]: version }));
        }
        return true;
      } catch (error) {
        // Usually the network: retry with backoff (a retry saves whatever is
        // unsaved by then). An edit or the Save button also retries.
        const failures = (saveFailuresRef.current.get(imageId) ?? 0) + 1;
        saveFailuresRef.current.set(imageId, failures);
        setSaveStatus((current) => ({
          ...current,
          [imageId]: {
            error: error instanceof Error ? error.message : "Could not save annotations.",
            savedAt: current[imageId]?.savedAt ?? null,
            failures,
          },
        }));
        if (failures <= SAVE_RETRY_LIMIT) {
          retryTimersRef.current.set(
            imageId,
            window.setTimeout(() => retrySaveRef.current(imageId), saveRetryDelay(failures)),
          );
        }
        return false;
      }
    },
    [editImage, project.id, runSave],
  );

  /** Saves an image's unsaved changes now, skipping the auto-save delay. */
  const saveNow = useCallback(
    (imageId: string, options?: { force?: boolean }) => {
      const editor = latest.current.sessions[imageId];
      const plan = editor ? planSave(editor, options) : null;
      if (plan) return persist(imageId, plan);
      // Nothing left to save (e.g. undone back to the saved copy): an
      // earlier failure no longer matters.
      if (saveFailuresRef.current.has(imageId)) {
        saveFailuresRef.current.delete(imageId);
        window.clearTimeout(retryTimersRef.current.get(imageId));
        retryTimersRef.current.delete(imageId);
        setSaveStatus((current) => ({
          ...current,
          [imageId]: { error: null, savedAt: current[imageId]?.savedAt ?? null, failures: 0 },
        }));
      }
      return Promise.resolve(true);
    },
    [persist],
  );

  useLayoutEffect(() => {
    retrySaveRef.current = (imageId) => void saveNow(imageId);
  }, [saveNow]);
  useEffect(() => {
    const timers = retryTimersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  /** Saves every opened image, then waits for all saves to settle. */
  const saveAll = useCallback(async () => {
    await Promise.all(
      Object.keys(latest.current.sessions).map((imageId) => saveNow(imageId)),
    );
    await savesSettled();
  }, [saveNow, savesSettled]);

  /** Saves everything, then re-renders the layout with fresh server data. */
  const syncWithServer = useCallback(async () => {
    await saveAll();
    startTransition(() => router.refresh());
  }, [router, saveAll]);

  const {
    job,
    states: aiStates,
    isActive: isJobActive,
    start: startJob,
    cancel: cancelJob,
  } = useAnnotationJob({
    initialJob: latestJob,
    initialStates: serverAiStates,
    onFinished: syncWithServer,
  });
  // The footer chip follows a run that was active during this visit until
  // it is dismissed.
  const [chipJobId, setChipJobId] = useState(
    latestJob && isRunActive(latestJob) ? latestJob.id : null,
  );
  if (job && isJobActive && job.id !== chipJobId) setChipJobId(job.id);
  const chipJob = job && job.id === chipJobId ? job : null;

  useLayoutEffect(() => {
    latest.current = { sessions, activeImageId, aiStates, labels, isSaving };
  });

  const reviewImageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const image of images) {
      const state = aiStates[image.id];
      if (
        state &&
        state.pendingSuggestions > 0 &&
        reviewed[image.id] !== aiStateVersion(state)
      ) {
        ids.add(image.id);
      }
    }
    return ids;
  }, [aiStates, images, reviewed]);
  // Images with accepted boxes, including edits made during this visit. Keyed
  // by the ID list so the memoised strip re-renders only when it changes.
  const annotatedKey = images
    .filter((image) => {
      const editor = sessions[image.id];
      return editor ? hasAcceptedBoxes(editor) : image.annotations.length > 0;
    })
    .map((image) => image.id)
    .join(",");
  const annotatedImageIds = useMemo(
    () => new Set(annotatedKey ? annotatedKey.split(",") : []),
    [annotatedKey],
  );
  const activeNeedsReview = reviewImageIds.has(activeImageId);
  const otherImagesToReview = reviewImageIds.size - (activeNeedsReview ? 1 : 0);
  const nextReviewImageId = useMemo(() => {
    const ordered = [...images.slice(activeIndex + 1), ...images.slice(0, activeIndex)];
    return ordered.find((image) => reviewImageIds.has(image.id))?.id ?? null;
  }, [activeIndex, images, reviewImageIds]);

  // Auto-save: debounced while editing (but at least every
  // AUTOSAVE_MAX_WAIT_MS); image switches and leaving the workspace save
  // immediately instead.
  const savePlan = useMemo(() => (session ? planSave(session) : null), [session]);
  const savePlanKey = savePlan ? JSON.stringify(savePlan) : null;
  useEffect(() => {
    if (!savePlanKey) return;
    const timer = window.setTimeout(() => void saveNow(activeImageId), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeImageId, saveNow, savePlanKey]);
  const hasUnsavedChanges = savePlan !== null;
  const activeSavedAt = saveStatus[activeImageId]?.savedAt ?? null;
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const timer = window.setTimeout(() => void saveNow(activeImageId), AUTOSAVE_MAX_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [activeImageId, activeSavedAt, hasUnsavedChanges, saveNow]);
  useEffect(() => () => void saveAll(), [saveAll]);

  // Whatever changed the open image (strip, toolbar, review, or the
  // browser's Back/Forward buttons), save the one it left at once.
  const shownImageIdRef = useRef(activeImageId);
  useEffect(() => {
    const previousImageId = shownImageIdRef.current;
    if (previousImageId === activeImageId) return;
    shownImageIdRef.current = activeImageId;
    void saveNow(previousImageId);
  }, [activeImageId, saveNow]);

  // Closing or reloading the tab with unsaved work: start saving, and ask
  // the browser to confirm leaving (it shows its own generic message).
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const { sessions: current, isSaving: saving } = latest.current;
      const unsaved = Object.values(current).some((editor) => planSave(editor) !== null);
      if (!unsaved && !saving) return;
      void saveAll();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveAll]);

  // Local draft backup per opened image, also read by the export sheet.
  // Each records whether it is unsaved, so only unsaved edits win on reopen.
  const writtenDraftsRef = useRef(new Map<string, Pick<ImageEditor, "present" | "savedBoxes">>());
  useEffect(() => {
    for (const [imageId, editor] of Object.entries(sessions)) {
      const written = writtenDraftsRef.current.get(imageId);
      if (written?.present === editor.present && written.savedBoxes === editor.savedBoxes) continue;
      writtenDraftsRef.current.set(imageId, { present: editor.present, savedBoxes: editor.savedBoxes });
      saveAnnotations(project.id, imageId, acceptedBoxes(editor.present), {
        unsaved: hasUnsavedBoxes(editor),
      });
    }
  }, [project.id, sessions]);

  // Pending AI suggestions for the open image: loaded (usually prefetched)
  // when it is up for review, and again whenever a newer AI result for it
  // arrives (its AI state version changes).
  const activeAiVersion = aiStateVersion(aiStates[activeImageId]);
  const hasSession = Boolean(session);
  useEffect(() => {
    if (!hasSession || !activeNeedsReview) return;
    const imageId = activeImageId;
    cache.loadSuggestions(imageId, activeAiVersion).then(
      (sets) => {
        setSuggestionsError(null);
        editImage(imageId, {
          type: "syncSuggestions",
          sets,
          labelIds: new Set(latest.current.labels.map((label) => label.id)),
        });
        // Nothing left on the server (e.g. reviewed in another tab).
        if (!hasServerSuggestions(sets)) {
          setReviewed((current) => ({ ...current, [imageId]: activeAiVersion }));
        }
      },
      (error: unknown) =>
        setSuggestionsError({
          imageId,
          message: error instanceof Error ? error.message : "Could not load AI suggestions.",
        }),
    );
  }, [activeAiVersion, activeImageId, activeNeedsReview, cache, editImage, hasSession]);

  /** Gets an image ready to open: its bytes and, if up for review, its suggestions. */
  const prefetchImage = useCallback(
    (imageId: string) => {
      const image = images.find((candidate) => candidate.id === imageId);
      if (!image) return;
      cache.warmImage(image.url);
      const state = latest.current.aiStates[imageId];
      if (state && state.pendingSuggestions > 0) {
        void cache.loadSuggestions(imageId, aiStateVersion(state)).catch(() => undefined);
      }
    },
    [cache, images],
  );

  const openImage = useCallback(
    (imageId: string) => window.history.pushState(null, "", imageHref(project.id, imageId)),
    [project.id],
  );

  /**
   * Switches images client-side; Next syncs pushState URLs into usePathname.
   * The image left behind is saved by the effect watching the open image.
   */
  const selectImage = useCallback(
    (imageId: string) => {
      if (imageId === latest.current.activeImageId) return;
      openImage(imageId);
    },
    [openImage],
  );

  const selectImageAt = useCallback(
    (index: number) => {
      const image = images[index];
      if (image) selectImage(image.id);
    },
    [images, selectImage],
  );

  // Once the open image is drawn, warm the images likely to be opened next.
  const imageReady = imageSize !== null;
  const previousImageId = images[activeIndex - 1]?.id;
  const nextImageId = images[activeIndex + 1]?.id;
  useEffect(() => {
    if (!imageReady) return;
    for (const imageId of [nextImageId, previousImageId, nextReviewImageId]) {
      if (imageId) prefetchImage(imageId);
    }
  }, [imageReady, nextImageId, nextReviewImageId, prefetchImage, previousImageId]);

  // Images uploaded before placeholders existed: hash this one once it has
  // loaded. A second download, once per image; best-effort. It bypasses the
  // HTTP cache: the cached copy came from a no-CORS <img> load, so it lacks
  // the CORS headers this read needs.
  const backfilledRef = useRef(new Set<string>());
  useEffect(() => {
    const { thumbhash, url } = activeImage;
    if (!imageReady || thumbhash || !url || backfilledRef.current.has(activeImageId)) return;
    backfilledRef.current.add(activeImageId);
    void fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.blob() : Promise.reject()))
      .then(createThumbhash)
      .then((hash) => saveImageThumbhash(project.id, activeImageId, hash))
      .catch(() => undefined);
  }, [activeImage, activeImageId, imageReady, project.id]);

  // Re-fit the image once the canvas has been resized for the new mode. Two
  // frames let the canvas's ResizeObserver report the new size first.
  const wasFullscreenRef = useRef(isFullscreen);
  useEffect(() => {
    if (wasFullscreenRef.current === isFullscreen) return;
    wasFullscreenRef.current = isFullscreen;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => setFitToken((value) => value + 1));
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [isFullscreen]);

  /**
   * Selecting a box elsewhere (layers, review card) switches to the Select
   * tool so it can be moved; a box just drawn keeps the box tool
   * (`keepTool`), so the next one can be drawn straight away.
   */
  const selectBox = useCallback(
    (boxId: string | null, options?: { keepTool?: boolean }) => {
      setSelection(boxId ? { imageId: activeImageId, boxId } : null);
      if (boxId && !options?.keepTool) setTool("select");
    },
    [activeImageId],
  );

  const handleCreateLabel = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      // Checked here too: production builds hide the server's message.
      if (labels.some((label) => label.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new Error(`A label named “${trimmed}” already exists.`);
      }
      const label = await createLabel(project.id, trimmed);
      setLabels((current) => [...current, label]);
      return label;
    },
    [labels, project.id],
  );

  /** The label with this name (case-insensitive), created if needed; it becomes the selected label. */
  const resolveLabel = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Label name is required.");
      const label =
        labels.find((candidate) => candidate.name.toLowerCase() === trimmed.toLowerCase()) ??
        (await handleCreateLabel(trimmed));
      setSelectedLabelId(label.id);
      return label;
    },
    [handleCreateLabel, labels],
  );

  // Relabelling a box accepts it if it was a suggestion. The edit targets
  // the image it started on, even if creating the label took a while.
  const handleAssignBoxLabel = useCallback(
    async (boxId: string, name: string) => {
      const imageId = activeImageId;
      const label = await resolveLabel(name);
      editImage(imageId, { type: "commit", update: updateBox(boxId, { labelId: label.id }) });
    },
    [activeImageId, editImage, resolveLabel],
  );

  /** A box drawn before the project had labels joins once its label exists. */
  const handleCreateBox = useCallback(
    async (rect: BoxRect, name: string) => {
      const imageId = activeImageId;
      const label = await resolveLabel(name);
      editImage(imageId, { type: "commit", update: addBox({ ...rect, labelId: label.id }) });
      if (latest.current.activeImageId === imageId) {
        setSelection({ imageId, boxId: rect.id });
      }
    },
    [activeImageId, editImage, resolveLabel],
  );

  const handleRenameLabel = useCallback(
    async (labelId: string, name: string) => {
      const currentLabel = labels.find((label) => label.id === labelId);
      const trimmed = name.trim();
      if (!currentLabel || currentLabel.name === trimmed) return;
      const updated = await renameLabel(project.id, labelId, trimmed);
      setLabels((current) =>
        current.map((label) => (label.id === labelId ? updated : label)),
      );
    },
    [labels, project.id],
  );

  const handleDeleteLabel = useCallback(
    async (labelId: string) => {
      const name = labels.find((label) => label.id === labelId)?.name ?? "This label";
      // This image's unsaved boxes are invisible to the server check below.
      const localUses = boxes.filter((box) => box.labelId === labelId).length;
      if (localUses > 0) {
        throw new Error(
          `“${name}” is used by ${localUses} ${localUses === 1 ? "box" : "boxes"} on this image. Relabel or delete them first.`,
        );
      }
      // Let the server see every opened image's latest boxes.
      await saveAll();
      const result = await deleteLabel(project.id, labelId);
      if (!result.ok) throw new Error(result.error);
      deletedLabelIdsRef.current.add(labelId);
      setLabels((current) => current.filter((label) => label.id !== labelId));
    },
    [boxes, labels, project.id, saveAll],
  );

  const handleRelabelSuggestion = useCallback(
    (boxId: string, labelId: string) => {
      commit(relabelSuggestion(boxId, labelId));
      setSelectedLabelId(labelId);
    },
    [commit],
  );
  const handleBoxesChange = useCallback(
    (next: BoundingBox[]) => commit(replaceBoxes(next)),
    [commit],
  );
  const handleUpdateBox = useCallback(
    (boxId: string, patch: Parameters<typeof updateBox>[1]) => commit(updateBox(boxId, patch)),
    [commit],
  );
  const handleDeleteBox = useCallback((boxId: string) => commit(removeBox(boxId)), [commit]);
  const handleDelete = useCallback(() => {
    if (selectedBoxId) commit(removeBox(selectedBoxId));
  }, [commit, selectedBoxId]);
  const handleAcceptSuggestion = useCallback(
    (boxId: string) => commit(acceptSuggestion(boxId)),
    [commit],
  );
  const handleAcceptAll = useCallback(() => commit(acceptAllSuggestions), [commit]);
  const handleRejectAll = useCallback(() => commit(rejectAllSuggestions), [commit]);
  const handleMoveBox = useCallback(
    (boxId: string, move: LayerMove) => commit(moveLayer(boxId, move)),
    [commit],
  );
  /** Drag-and-drop from the Layers list (later = drawn on top). */
  const handleReorderBox = useCallback(
    (boxId: string, toIndex: number) => commit(moveLayer(boxId, toIndex)),
    [commit],
  );
  const handleDuplicateBox = useCallback(
    (boxId: string) => {
      if (!boxes.some((box) => box.id === boxId)) return;
      const copyId = `box-${crypto.randomUUID()}`;
      commit(duplicateBox(boxId, copyId, imageSize));
      selectBox(copyId);
    },
    [boxes, commit, imageSize, selectBox],
  );
  const handleAiDetected = useCallback(
    (detected: AnnotationSuggestion[]) => commit(addSuggestions(detected)),
    [commit],
  );

  const canUndo = (session?.past.length ?? 0) > 0;
  const canRedo = (session?.future.length ?? 0) > 0;
  const handleUndo = useCallback(
    () => editImage(activeImageId, { type: "undo" }),
    [activeImageId, editImage],
  );
  const handleRedo = useCallback(
    () => editImage(activeImageId, { type: "redo" }),
    [activeImageId, editImage],
  );

  const flashSaved = useCallback(() => {
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 1600);
  }, []);

  /** Save button: rewrites this image, and saves any other image with unsaved changes. */
  const handleSave = useCallback(async () => {
    const others = Object.keys(latest.current.sessions).filter((imageId) => imageId !== activeImageId);
    const results = await Promise.all([
      saveNow(activeImageId, { force: true }),
      ...others.map((imageId) => saveNow(imageId)),
    ]);
    if (results.every(Boolean)) flashSaved();
  }, [activeImageId, flashSaved, saveNow]);

  /**
   * Save this image's review (accepting every pending suggestion first when
   * `acceptAll`), then open the next image to review.
   */
  const saveAndReviewNext = useCallback(
    (acceptAll: boolean) => {
      if (!session) return;
      const imageId = activeImageId;
      const action: EditorAction = { type: "commit", update: acceptAllSuggestions };
      const editor = acceptAll ? editorReducer(session, action) : session;
      if (acceptAll) editImage(imageId, action);
      startAdvancingReview(async () => {
        const plan = planSave(editor, { force: !nextReviewImageId });
        if (plan && !(await persist(imageId, plan))) return;
        if (nextReviewImageId) openImage(nextReviewImageId);
        else flashSaved();
      });
    },
    [activeImageId, editImage, flashSaved, nextReviewImageId, openImage, persist, session],
  );

  const handleStartJob = useCallback(
    (input: { imageIds: string[]; labelIds: string[]; confidence: number }) =>
      startJob({ projectId: project.id, ...input }),
    [project.id, startJob],
  );

  const handleCanvasImageSize = useCallback(
    (size: { width: number; height: number }) =>
      setLoadedImage({ imageId: activeImageId, ...size }),
    [activeImageId],
  );

  // Usually an expired signed URL (they last at least an hour): re-render
  // the layout once per failed URL to sign fresh ones.
  const recoveredUrlsRef = useRef(new Set<string>());
  const handleCanvasImageError = useCallback(() => {
    const { url } = activeImage;
    if (!url || recoveredUrlsRef.current.has(url)) return;
    recoveredUrlsRef.current.add(url);
    startTransition(() => router.refresh());
  }, [activeImage, router]);

  const reviewSuggestions = useMemo(
    () => (present ? pendingSuggestions(present) : []),
    [present],
  );
  // "1. car" tags on the canvas match the card's "Detection 1 of n".
  const { suggestionConfidence, suggestionNumbers } = useMemo(() => {
    const confidence: Record<string, number> = {};
    const numbers: Record<string, number> = {};
    reviewSuggestions.forEach((suggestion, index) => {
      confidence[suggestion.id] = suggestion.confidence;
      numbers[suggestion.id] = index + 1;
    });
    return { suggestionConfidence: confidence, suggestionNumbers: numbers };
  }, [reviewSuggestions]);
  const pendingCount = reviewSuggestions.length;
  const selectedIsSuggestion = Boolean(
    selectedBoxId && suggestionConfidence[selectedBoxId] !== undefined,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const modified = event.ctrlKey || event.metaKey;
      // Keys typed into a text field or pressed inside an open dialog, sheet,
      // menu or listbox belong to it, not to the canvas.
      if (
        target?.isContentEditable ||
        target?.closest?.(
          'input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      ) {
        return;
      }
      // A focused Select trigger (e.g. Properties › Label just after picking
      // one) uses letters, arrows and Space itself; undo/redo and Delete
      // still work there. Tabs use the arrow keys to move between tabs.
      if (target?.closest?.('[role="combobox"]') && !modified && event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      if (target?.closest?.('[role="tablist"]') && event.key.startsWith("Arrow")) {
        return;
      }

      // Overlay full screen (no browser fullscreen to exit with Escape).
      if (event.key === "Escape" && isOverlayOnly) {
        exitOverlay();
        return;
      }

      const key = event.key.toLowerCase();
      if (modified && (key === "z" || key === "y")) {
        event.preventDefault();
        if (key === "y" || event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
        return;
      }
      if (modified || event.altKey) return;

      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.shiftKey) {
        event.preventDefault();
        selectImageAt(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
        return;
      }
      const nextTool = event.shiftKey ? undefined : TOOL_KEYS.get(key);
      if (nextTool) {
        event.preventDefault();
        setTool(nextTool);
        return;
      }
      if (key === "a") {
        if (event.shiftKey && pendingCount > 0) {
          event.preventDefault();
          handleAcceptAll();
        } else if (!event.shiftKey && selectedBoxId && selectedIsSuggestion) {
          event.preventDefault();
          handleAcceptSuggestion(selectedBoxId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeIndex,
    exitOverlay,
    handleAcceptAll,
    handleAcceptSuggestion,
    handleDelete,
    handleRedo,
    handleUndo,
    isOverlayOnly,
    pendingCount,
    selectImageAt,
    selectedBoxId,
    selectedIsSuggestion,
  ]);

  const status = saveStatus[activeImageId];
  const otherFailedSaves = Object.entries(saveStatus).filter(
    ([imageId, imageStatus]) => imageId !== activeImageId && imageStatus.error,
  ).length;
  const notice =
    status?.error ??
    (suggestionsError?.imageId === activeImageId ? suggestionsError.message : null) ??
    (otherFailedSaves > 0
      ? `Changes to ${otherFailedSaves} other ${otherFailedSaves === 1 ? "image have" : "images have"} not saved yet. Press Save to try again.`
      : null);
  // Saved during this visit, else the image's last annotation save (only
  // meaningful once it has saved boxes: before that `modifiedAt` is the
  // column default).
  const lastSavedAt =
    status?.savedAt ??
    (activeImage.annotations.length > 0 && activeImage.modifiedAt
      ? new Date(activeImage.modifiedAt)
      : null);
  const saveState = status?.error
    ? status.failures <= SAVE_RETRY_LIMIT
      ? "Auto-save failed · retrying"
      : "Auto-save failed"
    : isSaving
      ? "Saving…"
      : hasUnsavedChanges
        ? "Unsaved changes"
        : "Auto-save: On";

  // Full screen: the canvas grows to fill the viewport left after the
  // toolbar, thumbnail strip and footer (about 17.5rem).
  const canvasHeightClass = isFullscreen
    ? "h-[max(420px,calc(100dvh_-_17.5rem))]"
    : "h-[510px]";

  // Hidden until this image's suggestions have loaded, so it never shows
  // "nothing to review" for an image that is up for review.
  const reviewCardView: ReviewCardView = session?.reviewCard ?? "expanded";
  const awaitingSuggestions = activeNeedsReview && !session?.serverSets;
  const showReviewCard =
    Boolean(session) &&
    !awaitingSuggestions &&
    (pendingCount > 0 || otherImagesToReview > 0) &&
    reviewCardView !== "dismissed";
  // From xl the expanded card floats over the Labels/Layers panel (below
  // Save/Export, which stay usable); the covered panel is inert so keyboard
  // focus cannot reach it. Minimised, it is a slim row in normal flow. Below
  // xl it sits in normal flow above the canvas.
  const reviewCardOverlaysPanel = showReviewCard && isXl && reviewCardView === "expanded";
  const setReviewCardView = (view: ReviewCardView) =>
    editImage(activeImageId, { type: "setReviewCard", view });
  const reviewCard = showReviewCard ? (
    <SuggestionReviewCard
      suggestions={reviewSuggestions}
      labels={labels}
      selectedBoxId={selectedBoxId}
      otherImagesToReview={otherImagesToReview}
      isSaving={isAdvancingReview}
      error={status?.error ?? null}
      collapsed={reviewCardView === "collapsed"}
      onCollapsedChange={(collapsed) => setReviewCardView(collapsed ? "collapsed" : "expanded")}
      onDismiss={() => setReviewCardView("dismissed")}
      onSelect={selectBox}
      onChangeLabel={handleRelabelSuggestion}
      onCreateLabel={handleCreateLabel}
      onDeleteSelected={handleDeleteBox}
      onAcceptAll={handleAcceptAll}
      onRejectAll={handleRejectAll}
      onAcceptAllAndNext={() => saveAndReviewNext(true)}
      onNextToReview={() => saveAndReviewNext(false)}
    />
  ) : null;

  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: activeImage.fileName },
        ]}
      />
      <div className="flex-1 p-4 md:p-6">
        <div
          className={cn(
            "flex flex-col gap-4",
            isFullscreen &&
              "fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background p-4 md:p-6",
          )}
        >
          <AnnotationToolbar
            imageIndex={activeIndex}
            imageCount={images.length}
            tool={tool}
            zoom={zoom}
            canUndo={canUndo}
            canRedo={canRedo}
            canDelete={Boolean(selectedBoxId)}
            isFullscreen={isFullscreen}
            onPrev={() => selectImageAt(activeIndex - 1)}
            onNext={() => selectImageAt(activeIndex + 1)}
            onToolChange={setTool}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDelete={handleDelete}
            onZoomOut={() => setZoom((value) => Math.max(10, value - 10))}
            onZoomIn={() => setZoom((value) => Math.min(400, value + 10))}
            onResetView={() => setFitToken((value) => value + 1)}
            onToggleFullscreen={toggleFullscreen}
            onAiAnnotate={(scope) => {
              setAiAnnotateScope(scope);
              setAiAnnotateOpen(true);
            }}
          />

          <AiAnnotateDialog
            open={aiAnnotateOpen}
            onOpenChange={setAiAnnotateOpen}
            projectId={project.id}
            currentImageId={activeImageId}
            images={images}
            labels={labels}
            initialScope={aiAnnotateScope}
            onCreateLabel={handleCreateLabel}
            onDetected={handleAiDetected}
            onStartJob={handleStartJob}
          />

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
            <div className="min-w-0 space-y-4">
              {!isXl ? reviewCard : null}

              <div
                className={cn(
                  "overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
                  !isFullscreen && "min-h-[510px]",
                )}
              >
                <div className={cn("relative", canvasHeightClass)}>
                  <CanvasPlaceholder thumbhash={activeImage.thumbhash} />
                  {session ? (
                    <AnnotationCanvas
                      key={activeImageId}
                      imageUrl={activeImage.url}
                      fileName={activeImage.fileName}
                      tool={tool}
                      zoom={zoom}
                      boxes={boxes}
                      labels={labels}
                      selectedBoxId={selectedBoxId}
                      selectedLabelId={activeLabelId}
                      onSelectBox={selectBox}
                      onBoxesChange={handleBoxesChange}
                      onAssignBoxLabel={handleAssignBoxLabel}
                      onCreateBox={handleCreateBox}
                      onZoomChange={setZoom}
                      suggestionConfidence={suggestionConfidence}
                      suggestionNumbers={suggestionNumbers}
                      fitNonce={fitToken}
                      onImageSizeChange={handleCanvasImageSize}
                      onImageError={handleCanvasImageError}
                    />
                  ) : null}
                </div>
              </div>

              <ImageStrip
                images={images}
                activeImageId={activeImageId}
                reviewImageIds={reviewImageIds}
                annotatedImageIds={annotatedImageIds}
                onSelect={selectImage}
                onPrefetch={prefetchImage}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" onClick={handleSave} disabled={isSaving || !session} className="rounded-lg">
                  {saveFlash ? <CheckCircle2 className="size-4" /> : null}
                  {isSaving ? "Saving..." : saveFlash ? "Saved" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setExportOpen(true)} className="rounded-lg">
                  <Download className="size-4" /> Export
                </Button>
              </div>
              {notice ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {notice}
                </p>
              ) : null}
              <div className="relative flex flex-col gap-4">
                {isXl && reviewCard ? (
                  <div className={cn(reviewCardOverlaysPanel && "absolute inset-x-0 top-0 z-20")}>
                    {reviewCard}
                  </div>
                ) : null}
                <div inert={reviewCardOverlaysPanel}>
                  <AnnotationSidePanel
                    labels={labels}
                    boxes={boxes}
                    selectedLabelId={activeLabelId}
                    selectedBoxId={selectedBoxId}
                    imageSize={imageSize}
                    onSelectLabel={setSelectedLabelId}
                    onCreateLabel={handleCreateLabel}
                    onRenameLabel={handleRenameLabel}
                    onDeleteLabel={handleDeleteLabel}
                    onSelectBox={selectBox}
                    onUpdateBox={handleUpdateBox}
                    onMoveBox={handleMoveBox}
                    onReorderBox={handleReorderBox}
                    onDuplicateBox={handleDuplicateBox}
                    onRenameBox={handleAssignBoxLabel}
                    onDeleteBox={handleDeleteBox}
                    suggestionConfidence={suggestionConfidence}
                    onAcceptSuggestion={handleAcceptSuggestion}
                    onRejectSuggestion={handleDeleteBox}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", status?.error ? "bg-destructive" : isSaving || hasUnsavedChanges ? "bg-amber-500" : "bg-emerald-500")} />
                {saveState}
              </span>
              <span aria-hidden className="h-3.5 w-px bg-border" />
              <span>
                Last saved:{" "}
                {lastSavedAt
                  ? `${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ${lastSavedAt.toLocaleDateString()}`
                  : "–"}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {chipJob ? (
                <AiJobStatusChip
                  job={chipJob}
                  isActive={isJobActive}
                  onCancel={cancelJob}
                  onDismiss={() => setChipJobId(null)}
                />
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => setShortcutsOpen(true)} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
                Shortcuts <Keyboard className="size-3.5" />
              </Button>
            </div>
          </div>

          <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

          <AnnotationExportSheet
            open={exportOpen}
            onOpenChange={setExportOpen}
            projectId={project.id}
            projectName={project.name}
            images={images}
            labels={labels}
          />
        </div>
      </div>
    </>
  );
}
