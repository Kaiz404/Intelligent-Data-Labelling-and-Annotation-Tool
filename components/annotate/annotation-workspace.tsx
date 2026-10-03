"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Keyboard,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { AiAnnotateDialog } from "@/components/annotate/ai-annotate-dialog";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import {
  AnnotationToolbar,
  type AiAnnotateScope,
} from "@/components/annotate/annotation-toolbar";
import { SuggestionReviewCard } from "@/components/annotate/suggestion-review-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveImageAnnotations } from "@/lib/actions/annotations";
import {
  createLabel,
  deleteLabel,
  renameLabel,
} from "@/lib/actions/labels";
import { resolveSuggestions } from "@/lib/actions/suggestions";
import { useAnnotationJob } from "@/hooks/use-annotation-job";
import {
  loadAnnotations,
  saveAnnotations,
} from "@/lib/annotations/storage";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  AnnotationSuggestion,
  AnnotationTool,
  BoundingBox,
  ImageAiState,
  ImageSuggestionSet,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

const AnnotationCanvas = dynamic(
  () =>
    import("@/components/annotate/annotation-canvas").then(
      (mod) => mod.AnnotationCanvas,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-[10px] bg-accent text-sm text-muted-foreground">
        Loading canvas...
      </div>
    ),
  },
);

type AnnotationWorkspaceProps = {
  project: Project;
  images: ProjectImage[];
  imageId: string;
  labels: AnnotationLabel[];
  /** Unreviewed bulk-AI suggestions for this image, grouped by job item. */
  suggestionSets: ImageSuggestionSet[];
  /** Project images that still have bulk-AI suggestions to review. */
  reviewImageIds: string[];
};

/**
 * Boxes on the canvas that are AI suggestions not yet accepted. `itemId` is
 * the bulk job item they came from, or null for single-image AI Annotate
 * results (which only live on this page until accepted).
 */
type SuggestionMeta = Record<
  string,
  { itemId: string | null; confidence: number }
>;

type SuggestionResolution = {
  itemId: string;
  remaining: AnnotationSuggestion[];
};

const MAX_HISTORY = 50;

/** Offset (image pixels) applied to a duplicated box so it does not hide its source. */
const DUPLICATE_OFFSET = 12;

/** Keys handled by the workspace keydown effect below — keep the two in sync. */
const KEYBOARD_SHORTCUTS: Array<{ combos: string[][]; description: string }> = [
  {
    combos: [["Delete"], ["Backspace"]],
    description: "Delete the selected box (rejects an AI suggestion)",
  },
  { combos: [["Ctrl / ⌘", "Z"]], description: "Undo" },
  { combos: [["Ctrl / ⌘", "Shift", "Z"]], description: "Redo" },
  { combos: [["A"]], description: "Accept the selected AI suggestion" },
  { combos: [["Shift", "A"]], description: "Accept all AI suggestions on this image" },
];

// Full screen targets the whole document rather than the workspace element:
// Radix menus, selects, dialogs and sheets portal into <body>, so they would
// be hidden behind a fullscreen workspace element. The workspace instead
// covers the viewport with a fixed overlay while the document is fullscreen.
function subscribeToFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function getIsDocumentFullscreen() {
  return document.fullscreenElement === document.documentElement;
}

function getIsDocumentFullscreenOnServer() {
  return false;
}

/**
 * Bulk AI run started from this workspace, per project. Next keeps recently
 * visited image pages alive (hidden), so each image has its own workspace
 * instance: the run is tracked here, outside any one instance, so whichever
 * image is open keeps polling it (polling also restarts the server worker).
 * Mirrored to sessionStorage so tracking survives a reload.
 */
const TRACKED_JOB_KEY_PREFIX = "sat:annotate:ai-job:";
const trackedJobMemory = new Map<string, string | null>();
const trackedJobListeners = new Set<() => void>();

function readTrackedJobRaw(projectId: string) {
  if (!trackedJobMemory.has(projectId)) {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(TRACKED_JOB_KEY_PREFIX + projectId);
    } catch {
      // Storage unavailable: track for this page session only.
    }
    trackedJobMemory.set(projectId, stored);
  }
  return trackedJobMemory.get(projectId) ?? null;
}

function writeTrackedJob(projectId: string, job: AnnotationJobProgress | null) {
  const raw = job ? JSON.stringify(job) : null;
  if (readTrackedJobRaw(projectId) === raw) return;
  trackedJobMemory.set(projectId, raw);
  try {
    if (raw) {
      window.sessionStorage.setItem(TRACKED_JOB_KEY_PREFIX + projectId, raw);
    } else {
      window.sessionStorage.removeItem(TRACKED_JOB_KEY_PREFIX + projectId);
    }
  } catch {
    // Storage unavailable: the in-memory copy still drives this page.
  }
  trackedJobListeners.forEach((listener) => listener());
}

function subscribeToTrackedJob(listener: () => void) {
  trackedJobListeners.add(listener);
  return () => {
    trackedJobListeners.delete(listener);
  };
}

function parseTrackedJob(raw: string | null): AnnotationJobProgress | null {
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as AnnotationJobProgress;
    return typeof job?.id === "string" && job.counts ? job : null;
  } catch {
    return null;
  }
}

/** Stable empty map: useAnnotationJob resets its states when this identity changes. */
const NO_AI_STATES: Record<string, ImageAiState> = {};

/**
 * Position for a duplicated box along one axis: offset forward, or backward
 * when that would leave the image (`limit` is unknown until it loads).
 */
function duplicateOffset(start: number, size: number, limit: number | null) {
  const forward = start + DUPLICATE_OFFSET;
  if (limit === null || forward + size <= limit) return forward;
  return Math.min(Math.max(start - DUPLICATE_OFFSET, 0), Math.max(limit - size, 0));
}

/**
 * Compact progress chip for a bulk AI run queued from this workspace.
 * Mounted (keyed by job ID) while the run is tracked; polling also keeps the
 * server worker going.
 */
function AiJobStatusChip({
  job,
  onProgress,
  onUpdates,
  onFinished,
  onDismiss,
}: {
  job: AnnotationJobProgress;
  onProgress: (job: AnnotationJobProgress) => void;
  /** Per-image AI states whose status or pending count changed. */
  onUpdates: (jobId: string, updates: Array<[string, ImageAiState]>) => void;
  onFinished: () => void;
  onDismiss: () => void;
}) {
  const { job: progress, states, isActive, cancel } = useAnnotationJob({
    initialJob: job,
    initialStates: NO_AI_STATES,
    onFinished,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const callbacksRef = useRef({ onProgress, onUpdates });
  const previousStatesRef = useRef(states);

  useEffect(() => {
    callbacksRef.current = { onProgress, onUpdates };
  });

  useEffect(() => {
    if (progress) callbacksRef.current.onProgress(progress);
  }, [progress]);

  // Compare values: polls replay a few seconds of updates as new objects.
  useEffect(() => {
    const previous = previousStatesRef.current;
    previousStatesRef.current = states;
    const updates = Object.entries(states).filter(
      ([imageId, state]) =>
        previous[imageId]?.status !== state.status ||
        previous[imageId]?.pendingSuggestions !== state.pendingSuggestions,
    );
    if (updates.length > 0) callbacksRef.current.onUpdates(job.id, updates);
  }, [job.id, states]);

  if (!progress) return null;

  const { succeeded, failed, cancelled } = progress.counts;
  const processed = succeeded + failed + cancelled;
  const summary = isActive
    ? `AI labelling ${processed}/${progress.total} images`
    : progress.status === "cancelled"
      ? `AI run cancelled · ${succeeded}/${progress.total} labelled`
      : `AI labelling done · ${succeeded}/${progress.total} images${failed > 0 ? ` · ${failed} failed` : ""}`;

  const handleCancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancel();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Could not cancel the AI run.");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-2.5 pr-1 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
      {isActive ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
      <span className="tabular-nums">{summary}</span>
      {cancelError ? (
        <span className="text-destructive" role="alert">{cancelError}</span>
      ) : null}
      {isActive ? (
        <Button type="button" variant="ghost" size="sm" className="h-6 rounded-full px-2 text-xs" disabled={isCancelling} onClick={() => void handleCancel()}>
          {isCancelling ? "Cancelling..." : "Cancel"}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="icon" className="size-6 rounded-full" aria-label="Dismiss AI run status" onClick={onDismiss}>
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function sameGeometry(first: BoundingBox, second: BoundingBox) {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function withoutSuggestion(meta: SuggestionMeta, boxId: string) {
  if (!meta[boxId]) return meta;
  const next = { ...meta };
  delete next[boxId];
  return next;
}

/** Still-pending suggestions per bulk job item, for `resolveSuggestions`. */
function buildResolutions(
  boxes: BoundingBox[],
  meta: SuggestionMeta,
  sets: ImageSuggestionSet[],
): SuggestionResolution[] {
  return sets.map((set) => ({
    itemId: set.itemId,
    remaining: boxes
      .filter((box) => meta[box.id]?.itemId === set.itemId)
      .map((box) => ({ ...box, confidence: meta[box.id].confidence })),
  }));
}

export function AnnotationWorkspace({
  project,
  images,
  imageId,
  labels: initialLabels,
  suggestionSets,
  reviewImageIds,
}: AnnotationWorkspaceProps) {
  const router = useRouter();
  const [labels, setLabels] = useState<AnnotationLabel[]>(initialLabels);

  const imageIndex = Math.max(
    0,
    images.findIndex((image) => image.id === imageId),
  );
  const currentImage = images[imageIndex] ?? images[0];

  const [tool, setTool] = useState<AnnotationTool>("select");
  const [zoom, setZoom] = useState(100);
  const [fitToken, setFitToken] = useState(0);
  const [selectedLabelId, setSelectedLabelId] = useState(labels[0]?.id ?? "");
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
  const [past, setPast] = useState<BoundingBox[][]>([]);
  const [future, setFuture] = useState<BoundingBox[][]>([]);
  const [saveFlash, setSaveFlash] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aiAnnotateOpen, setAiAnnotateOpen] = useState(false);
  // Chosen from the toolbar's AI Annotate split button.
  const [aiAnnotateScope, setAiAnnotateScope] =
    useState<AiAnnotateScope>("current");
  /** Natural size of the current image, once the canvas has loaded it. */
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  // Only while "Add & review next" / "Save & review next" saves and navigates;
  // routine auto-saves must not disable the review card.
  const [isAdvancingReview, startAdvancingReview] = useTransition();
  const trackedJobRaw = useSyncExternalStore(
    subscribeToTrackedJob,
    () => readTrackedJobRaw(project.id),
    () => null,
  );
  const trackedJob = useMemo(() => parseTrackedJob(trackedJobRaw), [trackedJobRaw]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const isDocumentFullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    getIsDocumentFullscreen,
    getIsDocumentFullscreenOnServer,
  );
  // Used when the Fullscreen API is unavailable or refused: the workspace
  // still fills the browser viewport.
  const [isOverlayFullscreen, setIsOverlayFullscreen] = useState(false);
  const isFullscreen = isDocumentFullscreen || isOverlayFullscreen;
  const wasFullscreenRef = useRef(isFullscreen);
  const [suggestionMeta, setSuggestionMeta] = useState<SuggestionMeta>({});
  const [reviewQueue, setReviewQueue] = useState(reviewImageIds);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const lastSavedSignatureRef = useRef("");
  const lastResolvedSignatureRef = useRef("");
  const activeImageIdRef = useRef<string | null>(currentImage?.id ?? null);
  // Latest committed values for callbacks that run after an await and for the
  // refresh merge (which must not re-run on every edit).
  const boxesRef = useRef(boxes);
  const suggestionMetaRef = useRef(suggestionMeta);
  const labelsRef = useRef(labels);
  /** Image whose server data has been fully hydrated into this instance. */
  const hydratedImageIdRef = useRef<string | null>(null);
  /** Every server suggestion ID already shown here (kept, accepted or rejected). */
  const seenSuggestionIdsRef = useRef(new Set<string>());
  /** Bulk run whose results for this image were already fetched mid-run. */
  const liveSyncedJobIdRef = useRef<string | null>(null);

  activeImageIdRef.current = currentImage?.id ?? null;
  boxesRef.current = boxes;
  suggestionMetaRef.current = suggestionMeta;
  labelsRef.current = labels;

  useEffect(() => {
    setReviewQueue(reviewImageIds);
  }, [reviewImageIds]);

  // Only accepted boxes are real annotations: they are what gets auto-saved,
  // exported, and backed up. Pending suggestions stay dashed on the canvas.
  const acceptedBoxes = useMemo(
    () => boxes.filter((box) => !suggestionMeta[box.id]),
    [boxes, suggestionMeta],
  );
  const suggestionConfidence = useMemo(() => {
    const confidence: Record<string, number> = {};
    for (const box of boxes) {
      const meta = suggestionMeta[box.id];
      if (meta) confidence[box.id] = meta.confidence;
    }
    return confidence;
  }, [boxes, suggestionMeta]);
  const pendingCount = Object.keys(suggestionConfidence).length;

  useEffect(() => {
    if (!selectedLabelId && labels[0]) {
      setSelectedLabelId(labels[0].id);
    }
  }, [labels, selectedLabelId]);

  const handleCreateLabel = useCallback(
    async (name: string) => {
      const label = await createLabel(project.id, name);
      setLabels((current) => [...current, label]);
      return label;
    },
    [project.id],
  );

  const handleDeleteLabel = useCallback(
    async (labelId: string) => {
      await deleteLabel(project.id, labelId);
      setLabels((current) => current.filter((label) => label.id !== labelId));
      setSelectedLabelId((current) => (current === labelId ? "" : current));
    },
    [project.id],
  );

  useEffect(() => {
    if (!currentImage) {
      return;
    }

    if (hydratedImageIdRef.current === currentImage.id) {
      // Same image, fresh server props (router.refresh, a server action that
      // refreshed the route, or this cached page shown again). Local state is
      // authoritative: keep boxes, history and review state, and only sync
      // server suggestions. Saves are flushed before our own refreshes.
      const seen = seenSuggestionIdsRef.current;
      const knownLabelIds = new Set(labelsRef.current.map((label) => label.id));
      const serverIds = new Set<string>();
      const additions: BoundingBox[] = [];
      const additionMeta: SuggestionMeta = {};
      for (const set of suggestionSets) {
        for (const { confidence, ...box } of set.suggestions) {
          serverIds.add(box.id);
          // Never re-add one already shown: it is still here, or was accepted
          // or rejected locally (possibly not saved yet).
          if (seen.has(box.id) || !knownLabelIds.has(box.labelId)) continue;
          seen.add(box.id);
          additionMeta[box.id] = { itemId: set.itemId, confidence };
          additions.push(box);
        }
      }
      // Bulk suggestions the server no longer has (e.g. cleared by a newer
      // run) are dropped. Single-image results (itemId null) are local only.
      const currentMeta = suggestionMetaRef.current;
      const dropped = new Set(
        Object.keys(currentMeta).filter(
          (id) => currentMeta[id].itemId !== null && !serverIds.has(id),
        ),
      );
      if (additions.length === 0 && dropped.size === 0) {
        return;
      }

      // Patch undo/redo snapshots too, so undo never removes a new suggestion
      // (which auto-save would persist as a rejection) or restores a dropped one.
      const patch = (list: BoundingBox[]) => {
        const kept = dropped.size > 0 ? list.filter((box) => !dropped.has(box.id)) : list;
        const ids = new Set(kept.map((box) => box.id));
        return [...kept, ...additions.filter((box) => !ids.has(box.id))];
      };
      setBoxes(patch);
      setPast((history) => history.map(patch));
      setFuture((redoStack) => redoStack.map(patch));
      setSuggestionMeta((current) => {
        const next = { ...current, ...additionMeta };
        for (const id of dropped) delete next[id];
        return next;
      });
      setSelectedBoxId((current) => (current && dropped.has(current) ? null : current));
      return;
    }

    hydratedImageIdRef.current = currentImage.id;
    setHydrated(false);
    const loaded = loadAnnotations(
      project.id,
      currentImage.id,
      currentImage.annotations,
    );
    lastSavedSignatureRef.current = JSON.stringify(currentImage.annotations);

    // Overlay unreviewed bulk-AI suggestions, skipping any already accepted
    // (same box ID) and any whose label has since been deleted.
    const loadedIds = new Set(loaded.map((box) => box.id));
    const knownLabelIds = new Set(initialLabels.map((label) => label.id));
    const meta: SuggestionMeta = {};
    const suggestionBoxes: BoundingBox[] = [];
    const seen = new Set<string>();
    for (const set of suggestionSets) {
      for (const { confidence, ...box } of set.suggestions) {
        seen.add(box.id);
        if (loadedIds.has(box.id) || !knownLabelIds.has(box.labelId)) continue;
        meta[box.id] = { itemId: set.itemId, confidence };
        suggestionBoxes.push(box);
      }
    }
    seenSuggestionIdsRef.current = seen;
    const initialBoxes = [...loaded, ...suggestionBoxes];
    lastResolvedSignatureRef.current = JSON.stringify(
      buildResolutions(initialBoxes, meta, suggestionSets),
    );

    setBoxes(initialBoxes);
    setSuggestionMeta(meta);
    setPast([]);
    setFuture([]);
    setSelectedBoxId(null);
    setLastSavedAt(null);
    setSaveError(null);
    setImageSize(null);
    setHydrated(true);
  }, [currentImage, initialLabels, project.id, suggestionSets]);

  const commitBoxes = useCallback((next: BoundingBox[]) => {
    setBoxes((current) => {
      setPast((history) => [...history, current].slice(-MAX_HISTORY));
      setFuture([]);
      return next;
    });
  }, []);

  const acceptSuggestion = useCallback((boxId: string) => {
    setSuggestionMeta((current) => withoutSuggestion(current, boxId));
  }, []);

  // Review card relabel: unlike other edits this keeps the box a pending
  // suggestion; auto-save persists the new label into its job item. Reads the
  // latest boxes because the card may call it after awaiting label creation.
  const handleRelabelSuggestion = useCallback(
    (boxId: string, labelId: string) => {
      const current = boxesRef.current;
      const target = current.find((box) => box.id === boxId);
      if (!target || target.labelId === labelId) return;
      commitBoxes(
        current.map((box) => (box.id === boxId ? { ...box, labelId } : box)),
      );
      setSelectedLabelId(labelId);
    },
    [commitBoxes],
  );

  const handleAssignBoxLabel = useCallback(
    async (boxId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("Label name is required.");
      }

      let assignedLabel = labels.find(
        (candidate) => candidate.name.toLowerCase() === trimmed.toLowerCase(),
      );

      if (!assignedLabel) {
        assignedLabel = await createLabel(project.id, trimmed);
        const createdLabel = assignedLabel;
        setLabels((current) => [...current, createdLabel]);
      }

      const assignedLabelId = assignedLabel.id;
      const nextBoxes = boxes.map((box) =>
        box.id === boxId ? { ...box, labelId: assignedLabelId } : box,
      );
      // Relabelling a suggestion counts as accepting it.
      const nextMeta = withoutSuggestion(suggestionMeta, boxId);
      commitBoxes(nextBoxes);
      setSuggestionMeta(nextMeta);
      if (currentImage) {
        saveAnnotations(
          project.id,
          currentImage.id,
          nextBoxes.filter((box) => !nextMeta[box.id]),
        );
      }
      setSelectedLabelId(assignedLabelId);
    },
    [boxes, commitBoxes, currentImage, labels, project.id, suggestionMeta],
  );

  const handleRenameLabel = useCallback(
    async (labelId: string, name: string) => {
      const currentLabel = labels.find((label) => label.id === labelId);
      const trimmed = name.trim();
      if (!currentLabel || currentLabel.name === trimmed) {
        return;
      }

      const updated = await renameLabel(project.id, labelId, trimmed);
      setLabels((current) =>
        current.map((label) => (label.id === labelId ? updated : label)),
      );
    },
    [labels, project.id],
  );

  const handleBoxesChange = useCallback(
    (next: BoundingBox[]) => {
      // Moving or resizing a suggestion counts as accepting it.
      const previousById = new Map(boxes.map((box) => [box.id, box]));
      for (const box of next) {
        const previous = previousById.get(box.id);
        if (previous && suggestionMeta[box.id] && !sameGeometry(previous, box)) {
          acceptSuggestion(box.id);
        }
      }
      commitBoxes(next);
    },
    [acceptSuggestion, boxes, commitBoxes, suggestionMeta],
  );

  const handleUndo = useCallback(() => {
    setPast((history) => {
      if (history.length === 0) {
        return history;
      }
      const previous = history[history.length - 1];
      setFuture((redoStack) => [boxes, ...redoStack].slice(0, MAX_HISTORY));
      setBoxes(previous);
      setSelectedBoxId(null);
      return history.slice(0, -1);
    });
  }, [boxes]);

  const handleRedo = useCallback(() => {
    setFuture((redoStack) => {
      if (redoStack.length === 0) {
        return redoStack;
      }
      const [next, ...rest] = redoStack;
      setPast((history) => [...history, boxes].slice(-MAX_HISTORY));
      setBoxes(next);
      setSelectedBoxId(null);
      return rest;
    });
  }, [boxes]);

  // Deleting a suggestion rejects it; undo brings it back as a suggestion.
  const handleDelete = useCallback(() => {
    if (!selectedBoxId) {
      return;
    }
    commitBoxes(boxes.filter((box) => box.id !== selectedBoxId));
    setSelectedBoxId(null);
  }, [boxes, commitBoxes, selectedBoxId]);

  const handleDeleteBox = useCallback(
    (boxId: string) => {
      commitBoxes(boxes.filter((box) => box.id !== boxId));
      if (selectedBoxId === boxId) setSelectedBoxId(null);
    },
    [boxes, commitBoxes, selectedBoxId],
  );

  const handleAcceptAll = useCallback(() => setSuggestionMeta({}), []);

  const handleRejectAll = useCallback(() => {
    commitBoxes(boxes.filter((box) => !suggestionMeta[box.id]));
    setSelectedBoxId(null);
  }, [boxes, commitBoxes, suggestionMeta]);

  const handleMoveBox = useCallback(
    (
      boxId: string,
      action: "front" | "forward" | "back" | "backward",
    ) => {
      const currentIndex = boxes.findIndex((box) => box.id === boxId);
      if (currentIndex < 0) return;
      const next = [...boxes];
      const [box] = next.splice(currentIndex, 1);
      const nextIndex =
        action === "front"
          ? next.length
          : action === "back"
            ? 0
            : action === "forward"
              ? Math.min(currentIndex + 1, next.length)
              : Math.max(currentIndex - 1, 0);
      next.splice(nextIndex, 0, box);
      commitBoxes(next);
    },
    [boxes, commitBoxes],
  );

  /** Drag-and-drop from the Layers list: move a box to `toIndex` (later = on top). */
  const handleReorderBox = useCallback(
    (boxId: string, toIndex: number) => {
      const currentIndex = boxes.findIndex((box) => box.id === boxId);
      if (currentIndex < 0) return;
      const next = [...boxes];
      const [box] = next.splice(currentIndex, 1);
      const targetIndex = Math.min(Math.max(toIndex, 0), next.length);
      if (targetIndex === currentIndex) return;
      next.splice(targetIndex, 0, box);
      commitBoxes(next);
    },
    [boxes, commitBoxes],
  );

  // The copy is a new accepted box (never in suggestionMeta), placed directly
  // above its source so it is drawn on top of it, and kept inside the image.
  const handleDuplicateBox = useCallback(
    (boxId: string) => {
      const index = boxes.findIndex((box) => box.id === boxId);
      if (index < 0) return;
      const source = boxes[index];
      const copy: BoundingBox = {
        ...source,
        id: `box-${crypto.randomUUID()}`,
        x: duplicateOffset(source.x, source.width, imageSize?.width ?? null),
        y: duplicateOffset(source.y, source.height, imageSize?.height ?? null),
      };
      const next = [...boxes];
      next.splice(index + 1, 0, copy);
      commitBoxes(next);
      setSelectedBoxId(copy.id);
      setTool("select");
    },
    [boxes, commitBoxes, imageSize],
  );

  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      setIsOverlayFullscreen(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    const root = document.documentElement;
    if (!document.fullscreenEnabled || typeof root.requestFullscreen !== "function") {
      setIsOverlayFullscreen(true);
      return;
    }
    root.requestFullscreen().catch(() => setIsOverlayFullscreen(true));
  }, [isFullscreen]);

  // Re-fit the image once the canvas has been resized for the new mode. Two
  // frames let the canvas's ResizeObserver report the new size first.
  useEffect(() => {
    if (wasFullscreenRef.current === isFullscreen) return;
    wasFullscreenRef.current = isFullscreen;
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() =>
        setFitToken((value) => value + 1),
      );
    });
    return () => {
      window.cancelAnimationFrame(outerFrame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [isFullscreen]);

  const handleUpdateBox = useCallback(
    (
      boxId: string,
      patch: Partial<
        Pick<BoundingBox, "labelId" | "x" | "y" | "width" | "height">
      >,
    ) => {
      // Editing a suggestion's label or coordinates counts as accepting it.
      acceptSuggestion(boxId);
      commitBoxes(
        boxes.map((box) => (box.id === boxId ? { ...box, ...patch } : box)),
      );
    },
    [acceptSuggestion, boxes, commitBoxes],
  );

  /**
   * Serialized save: persists accepted boxes to `images.annotation` and, when
   * review decisions changed, the still-pending suggestions per job item.
   * Returns whether everything was saved.
   */
  const persistAnnotations = useCallback(
    async (
      targetImageId: string,
      snapshot: BoundingBox[],
      resolutions: SuggestionResolution[],
      flash: boolean,
    ) => {
      const signature = JSON.stringify(snapshot);
      const resolutionSignature = JSON.stringify(resolutions);
      const saveBoxes = signature !== lastSavedSignatureRef.current || flash;
      const saveResolutions =
        resolutionSignature !== lastResolvedSignatureRef.current;
      pendingSavesRef.current += 1;
      setIsSaving(true);
      setSaveError(null);

      // Accepted boxes are saved before their suggestions are cleared, so a
      // failure in between can only leave a suggestion that is already
      // accepted — which the loader skips by box ID.
      const operation = saveQueueRef.current.then(async () => {
        const result = saveBoxes
          ? await saveImageAnnotations(project.id, targetImageId, snapshot)
          : null;
        if (saveResolutions) {
          await resolveSuggestions(project.id, resolutions);
        }
        return result;
      });
      saveQueueRef.current = operation.then(
        () => undefined,
        () => undefined,
      );

      try {
        const result = await operation;
        if (activeImageIdRef.current === targetImageId) {
          lastSavedSignatureRef.current = signature;
          lastResolvedSignatureRef.current = resolutionSignature;
          if (result) setLastSavedAt(new Date(result.savedAt));
          if (flash) {
            setSaveFlash(true);
            window.setTimeout(() => setSaveFlash(false), 1600);
          }
        }
        if (resolutions.every((resolution) => resolution.remaining.length === 0)) {
          setReviewQueue((queue) => queue.filter((id) => id !== targetImageId));
        }
        return true;
      } catch (error) {
        if (activeImageIdRef.current === targetImageId) {
          setSaveError(
            error instanceof Error
              ? error.message
              : "Could not save annotations.",
          );
        }
        return false;
      } finally {
        pendingSavesRef.current -= 1;
        if (pendingSavesRef.current === 0) {
          setIsSaving(false);
        }
      }
    },
    [project.id],
  );

  /** Save now (skipping the auto-save debounce) with explicit review state. */
  const flushSave = useCallback(
    async (nextBoxes: BoundingBox[], nextMeta: SuggestionMeta, flash: boolean) => {
      if (!currentImage) return false;
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      const accepted = nextBoxes.filter((box) => !nextMeta[box.id]);
      saveAnnotations(project.id, currentImage.id, accepted);
      return persistAnnotations(
        currentImage.id,
        accepted,
        buildResolutions(nextBoxes, nextMeta, suggestionSets),
        flash,
      );
    },
    [currentImage, persistAnnotations, project.id, suggestionSets],
  );

  const handleSave = useCallback(async () => {
    await flushSave(boxes, suggestionMeta, true);
  }, [boxes, flushSave, suggestionMeta]);

  const navigateToImage = useCallback(
    (nextIndex: number) => {
      const nextImage = images[nextIndex];
      if (!nextImage) {
        return;
      }
      // This page is kept alive but hidden after navigating, which cancels the
      // auto-save timer; start a pending save now (it completes in the
      // background through the serialized save queue).
      if (hydrated && autoSaveTimerRef.current !== null) {
        void flushSave(boxes, suggestionMeta, false);
      }
      router.push(`/projects/${project.id}/annotate/${nextImage.id}`);
    },
    [boxes, flushSave, hydrated, images, project.id, router, suggestionMeta],
  );

  useEffect(() => {
    if (!hydrated || !currentImage) return;
    saveAnnotations(project.id, currentImage.id, acceptedBoxes);

    const resolutions = buildResolutions(boxes, suggestionMeta, suggestionSets);
    if (
      JSON.stringify(acceptedBoxes) === lastSavedSignatureRef.current &&
      JSON.stringify(resolutions) === lastResolvedSignatureRef.current
    ) {
      return;
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void persistAnnotations(currentImage.id, acceptedBoxes, resolutions, false);
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    acceptedBoxes,
    boxes,
    currentImage,
    hydrated,
    persistAnnotations,
    project.id,
    suggestionMeta,
    suggestionSets,
  ]);

  const nextReviewImageId = useMemo(() => {
    const waiting = new Set(reviewQueue.filter((id) => id !== currentImage?.id));
    const ordered = [
      ...images.slice(imageIndex + 1),
      ...images.slice(0, imageIndex),
    ];
    return ordered.find((image) => waiting.has(image.id))?.id ?? null;
  }, [currentImage?.id, imageIndex, images, reviewQueue]);

  const otherImagesToReview = useMemo(() => {
    const imageIds = new Set(images.map((image) => image.id));
    return reviewQueue.filter(
      (id) => id !== currentImage?.id && imageIds.has(id),
    ).length;
  }, [currentImage?.id, images, reviewQueue]);

  /**
   * Save this image's review with `nextMeta`, then open the next image to
   * review. Runs as a transition so `isAdvancingReview` covers the save and
   * the navigation it starts.
   */
  const saveAndReviewNext = useCallback(
    (nextMeta: SuggestionMeta) => {
      setSuggestionMeta(nextMeta);
      startAdvancingReview(async () => {
        if (!(await flushSave(boxes, nextMeta, !nextReviewImageId))) return;
        if (nextReviewImageId) {
          router.push(`/projects/${project.id}/annotate/${nextReviewImageId}`);
        }
      });
    },
    [boxes, flushSave, nextReviewImageId, project.id, router],
  );

  /**
   * Flush any pending save, then re-fetch server data. The hydrate effect
   * merges it into this image without resetting local edits.
   */
  const syncWithServer = useCallback(async () => {
    if (hydrated && autoSaveTimerRef.current !== null) {
      await flushSave(boxes, suggestionMeta, false);
    }
    await saveQueueRef.current;
    router.refresh();
  }, [boxes, flushSave, hydrated, router, suggestionMeta]);

  const handleJobQueued = useCallback(
    (job: AnnotationJobProgress) => writeTrackedJob(project.id, job),
    [project.id],
  );

  const handleJobProgress = useCallback(
    (job: AnnotationJobProgress) => {
      // Ignore a late update from a run that is no longer the tracked one.
      if (parseTrackedJob(readTrackedJobRaw(project.id))?.id === job.id) {
        writeTrackedJob(project.id, job);
      }
    },
    [project.id],
  );

  const handleJobUpdates = useCallback(
    (jobId: string, updates: Array<[string, ImageAiState]>) => {
      const ready = updates
        .filter(([, state]) => state.pendingSuggestions > 0)
        .map(([imageId]) => imageId);
      if (ready.length === 0) return;
      // "k more" grows live as images get suggestions.
      setReviewQueue((queue) => {
        const known = new Set(queue);
        const added = ready.filter((id) => !known.has(id));
        return added.length > 0 ? [...queue, ...added] : queue;
      });
      // Results for the open image: load them now (once per run) rather than
      // at the end of the run.
      if (
        currentImage &&
        ready.includes(currentImage.id) &&
        liveSyncedJobIdRef.current !== jobId
      ) {
        liveSyncedJobIdRef.current = jobId;
        void syncWithServer();
      }
    },
    [currentImage, syncWithServer],
  );

  const handleJobDismiss = useCallback(
    () => writeTrackedJob(project.id, null),
    [project.id],
  );

  const reviewSuggestions = useMemo(
    () =>
      boxes
        .filter((box) => suggestionMeta[box.id])
        .map((box) => ({
          id: box.id,
          labelId: box.labelId,
          confidence: suggestionMeta[box.id].confidence,
        })),
    [boxes, suggestionMeta],
  );
  // "1. car" tags on the canvas match the card's "Detection 1 of n".
  const suggestionNumbers = useMemo(
    () =>
      Object.fromEntries(
        reviewSuggestions.map((suggestion, index) => [suggestion.id, index + 1]),
      ),
    [reviewSuggestions],
  );

  const selectedIsSuggestion = Boolean(
    selectedBoxId && suggestionMeta[selectedBoxId],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isEditing) return;
      // Keys pressed inside an open dialog, sheet, menu or select belong to
      // it, not to the canvas (e.g. Delete while reading the Shortcuts dialog).
      if (target?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        handleDelete();
        return;
      }
      if (
        event.key.toLowerCase() === "a" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (event.shiftKey && pendingCount > 0) {
          event.preventDefault();
          handleAcceptAll();
        } else if (!event.shiftKey && selectedBoxId && selectedIsSuggestion) {
          event.preventDefault();
          acceptSuggestion(selectedBoxId);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    acceptSuggestion,
    handleAcceptAll,
    handleDelete,
    handleRedo,
    handleUndo,
    pendingCount,
    selectedBoxId,
    selectedIsSuggestion,
  ]);

  // Single-image AI results join the canvas as suggestions to accept, so
  // auto-save never persists unreviewed predictions.
  const handleAiDetected = useCallback(
    (detected: AnnotationSuggestion[]) => {
      if (detected.length === 0) {
        return;
      }
      const meta: SuggestionMeta = {};
      const detectedBoxes = detected.map(({ confidence, ...box }) => {
        meta[box.id] = { itemId: null, confidence };
        return box;
      });
      setSuggestionMeta((current) => ({ ...current, ...meta }));
      // Latest boxes: the dialog calls this after awaiting the detector.
      commitBoxes([...boxesRef.current, ...detectedBoxes]);
    },
    [commitBoxes],
  );

  if (!currentImage) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No images available to annotate.
      </div>
    );
  }

  const reviewSet = new Set(reviewQueue);
  // Full screen: the canvas grows to fill the viewport left after the
  // toolbar, thumbnail strip and footer (about 17.5rem).
  const canvasHeightClass = isFullscreen
    ? "h-[max(420px,calc(100dvh_-_17.5rem))]"
    : "h-[510px]";

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        isFullscreen &&
          "fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-background p-4 md:p-6",
      )}
    >
      <AnnotationToolbar
        imageIndex={imageIndex}
        imageCount={images.length}
        tool={tool}
        zoom={zoom}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        canDelete={Boolean(selectedBoxId)}
        isFullscreen={isFullscreen}
        onPrev={() => navigateToImage(imageIndex - 1)}
        onNext={() => navigateToImage(imageIndex + 1)}
        onToolChange={setTool}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDelete={handleDelete}
        onZoomOut={() => setZoom((value) => Math.max(10, value - 10))}
        onZoomIn={() => setZoom((value) => Math.min(400, value + 10))}
        onResetView={() => setFitToken((value) => value + 1)}
        onToggleFullscreen={handleToggleFullscreen}
        onAiAnnotate={(scope) => {
          setAiAnnotateScope(scope);
          setAiAnnotateOpen(true);
        }}
      />

      <AiAnnotateDialog
        open={aiAnnotateOpen}
        onOpenChange={setAiAnnotateOpen}
        projectId={project.id}
        currentImageId={currentImage.id}
        images={images}
        labels={labels}
        initialScope={aiAnnotateScope}
        onCreateLabel={handleCreateLabel}
        onDetected={handleAiDetected}
        onJobQueued={handleJobQueued}
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
        {/* Review card: from xl it shares the right column's grid cell and
            floats over Save/Export and the Labels panel (Figma); below xl it
            sits in normal flow above the canvas. Only the card (or its
            minimised pill) takes pointer events, not the empty wrapper. */}
        {pendingCount > 0 || otherImagesToReview > 0 ? (
          <div className="pointer-events-none relative z-20 min-w-0 xl:col-start-2 xl:row-start-1 [&>*]:pointer-events-auto">
            <SuggestionReviewCard
              suggestions={reviewSuggestions}
              labels={labels}
              selectedBoxId={selectedBoxId}
              otherImagesToReview={otherImagesToReview}
              isSaving={isAdvancingReview}
              error={saveError}
              onSelect={(boxId) => {
                setSelectedBoxId(boxId);
                setTool("select");
              }}
              onChangeLabel={handleRelabelSuggestion}
              onCreateLabel={handleCreateLabel}
              onDeleteSelected={handleDeleteBox}
              onAcceptAll={handleAcceptAll}
              onRejectAll={handleRejectAll}
              onAcceptAllAndNext={() => saveAndReviewNext({})}
              onNextToReview={() => saveAndReviewNext(suggestionMeta)}
            />
          </div>
        ) : null}

        <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
          <div
            className={cn(
              "overflow-hidden rounded-xl border bg-muted/30 shadow-sm",
              !isFullscreen && "min-h-[510px]",
            )}
          >
            {hydrated ? (
              <AnnotationCanvas
                key={currentImage.id}
                imageUrl={currentImage.imageUrl ?? currentImage.thumbnailUrl}
                fileName={currentImage.fileName}
                tool={tool}
                zoom={zoom}
                boxes={boxes}
                labels={labels}
                selectedBoxId={selectedBoxId}
                selectedLabelId={selectedLabelId}
                onSelectBox={(id) => {
                  setSelectedBoxId(id);
                  if (id) setTool("select");
                }}
                onBoxesChange={handleBoxesChange}
                onAssignBoxLabel={handleAssignBoxLabel}
                onRenameLabel={handleRenameLabel}
                onZoomChange={setZoom}
                suggestionConfidence={suggestionConfidence}
                suggestionNumbers={suggestionNumbers}
                fitNonce={fitToken}
                onImageSizeChange={setImageSize}
                className={canvasHeightClass}
              />
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center text-sm text-muted-foreground",
                  canvasHeightClass,
                )}
              >
                Loading annotations...
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
            <Button type="button" variant="ghost" size="icon" onClick={() => navigateToImage(imageIndex - 1)} disabled={imageIndex <= 0} aria-label="Previous thumbnails">
              <ChevronLeft className="size-4" />
            </Button>
            <div className="grid min-w-0 flex-1 auto-cols-[110px] grid-flow-col gap-3 overflow-x-auto py-1">
              {images.map((image, index) => (
                <button
                  type="button"
                  key={image.id}
                  onClick={() => navigateToImage(index)}
                  className="min-w-0 text-left"
                  aria-current={image.id === currentImage.id ? "true" : undefined}
                >
                  <span
                    className={`relative block h-16 rounded-md border bg-muted bg-cover bg-center transition ${image.id === currentImage.id ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"}`}
                    style={image.thumbnailUrl ? { backgroundImage: `url(${image.thumbnailUrl})` } : undefined}
                  >
                    {reviewSet.has(image.id) ? (
                      <span
                        className="absolute right-1 top-1 size-2.5 rounded-full bg-violet-600 ring-2 ring-background"
                        title="AI suggestions to review"
                      />
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-[10px]">{image.fileName}</span>
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => navigateToImage(imageIndex + 1)} disabled={imageIndex >= images.length - 1} aria-label="Next thumbnails">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4 xl:col-start-2 xl:row-start-1">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={handleSave} disabled={isSaving} className="rounded-lg">
              {saveFlash ? <CheckCircle2 className="size-4" /> : null}
              {isSaving ? "Saving..." : saveFlash ? "Saved" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                saveAnnotations(project.id, currentImage.id, acceptedBoxes);
                setExportOpen(true);
              }}
              className="rounded-lg"
            >
              <Download className="size-4" /> Export
            </Button>
          </div>
          {saveError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </p>
          ) : null}
          <AnnotationSidePanel
            labels={labels}
            boxes={boxes}
            selectedLabelId={selectedLabelId}
            selectedBoxId={selectedBoxId}
            onSelectLabel={setSelectedLabelId}
            onCreateLabel={handleCreateLabel}
            onRenameLabel={handleRenameLabel}
            onDeleteLabel={handleDeleteLabel}
            onSelectBox={(id) => {
              setSelectedBoxId(id);
              if (id) setTool("select");
            }}
            onUpdateBox={handleUpdateBox}
            onMoveBox={handleMoveBox}
            onReorderBox={handleReorderBox}
            onDuplicateBox={handleDuplicateBox}
            onRenameBox={handleAssignBoxLabel}
            onDeleteBox={handleDeleteBox}
            suggestionConfidence={suggestionConfidence}
            onAcceptSuggestion={acceptSuggestion}
            onRejectSuggestion={handleDeleteBox}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", saveError ? "bg-destructive" : isSaving ? "bg-amber-500" : "bg-emerald-500")} />
            {saveError ? "Auto-save failed" : isSaving ? "Saving…" : "Auto-save: On"}
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
          {trackedJob ? (
            <AiJobStatusChip
              key={trackedJob.id}
              job={trackedJob}
              onProgress={handleJobProgress}
              onUpdates={handleJobUpdates}
              onFinished={syncWithServer}
              onDismiss={handleJobDismiss}
            />
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={() => setShortcutsOpen(true)} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
            Shortcuts <Keyboard className="size-3.5" />
          </Button>
        </div>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Shortcuts are paused while you type in a text field or have a
              dialog or menu open.
            </DialogDescription>
          </DialogHeader>
          <dl className="divide-y rounded-lg border">
            {KEYBOARD_SHORTCUTS.map((shortcut) => (
              <div key={shortcut.description} className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
                <dt>{shortcut.description}</dt>
                <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-xs text-muted-foreground">
                  {shortcut.combos.map((combo, index) => (
                    <Fragment key={combo.join("+")}>
                      {index > 0 ? <span>or</span> : null}
                      <span className="flex items-center gap-0.5">
                        {combo.map((key) => (
                          <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      <AnnotationExportSheet
        open={exportOpen}
        onOpenChange={setExportOpen}
        projectId={project.id}
        projectName={project.name}
        images={images}
        labels={labels}
      />
    </div>
  );
}
