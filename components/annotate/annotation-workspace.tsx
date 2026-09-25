"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Keyboard } from "lucide-react";
import { AiAnnotateDialog } from "@/components/annotate/ai-annotate-dialog";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import { AnnotationToolbar } from "@/components/annotate/annotation-toolbar";
import { SuggestionReviewBar } from "@/components/annotate/suggestion-review-bar";
import { Button } from "@/components/ui/button";
import { saveImageAnnotations } from "@/lib/actions/annotations";
import {
  createLabel,
  deleteLabel,
  renameLabel,
} from "@/lib/actions/labels";
import { resolveSuggestions } from "@/lib/actions/suggestions";
import {
  loadAnnotations,
  saveAnnotations,
} from "@/lib/annotations/storage";
import type {
  AnnotationLabel,
  AnnotationSuggestion,
  AnnotationTool,
  BoundingBox,
  ImageSuggestionSet,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

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
  const [suggestionMeta, setSuggestionMeta] = useState<SuggestionMeta>({});
  const [reviewQueue, setReviewQueue] = useState(reviewImageIds);
  const autoSaveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const lastSavedSignatureRef = useRef("");
  const lastResolvedSignatureRef = useRef("");
  const activeImageIdRef = useRef<string | null>(currentImage?.id ?? null);

  activeImageIdRef.current = currentImage?.id ?? null;

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
    for (const set of suggestionSets) {
      for (const { confidence, ...box } of set.suggestions) {
        if (loadedIds.has(box.id) || !knownLabelIds.has(box.labelId)) continue;
        meta[box.id] = { itemId: set.itemId, confidence };
        suggestionBoxes.push(box);
      }
    }
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

  const navigateToImage = useCallback(
    (nextIndex: number) => {
      const nextImage = images[nextIndex];
      if (!nextImage) {
        return;
      }
      router.push(`/projects/${project.id}/annotate/${nextImage.id}`);
    },
    [images, project.id, router],
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

  /** Save this image's review with `nextMeta`, then open the next image to review. */
  const saveAndReviewNext = useCallback(
    async (nextMeta: SuggestionMeta) => {
      setSuggestionMeta(nextMeta);
      if (!(await flushSave(boxes, nextMeta, !nextReviewImageId))) return;
      if (nextReviewImageId) {
        router.push(`/projects/${project.id}/annotate/${nextReviewImageId}`);
      }
    },
    [boxes, flushSave, nextReviewImageId, project.id, router],
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
      commitBoxes([...boxes, ...detectedBoxes]);
    },
    [boxes, commitBoxes],
  );

  if (!currentImage) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No images available to annotate.
      </div>
    );
  }

  const reviewSet = new Set(reviewQueue);

  return (
    <div className="flex flex-col gap-4">
      <AnnotationToolbar
        imageIndex={imageIndex}
        imageCount={images.length}
        tool={tool}
        zoom={zoom}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        canDelete={Boolean(selectedBoxId)}
        onPrev={() => navigateToImage(imageIndex - 1)}
        onNext={() => navigateToImage(imageIndex + 1)}
        onToolChange={setTool}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDelete={handleDelete}
        onZoomOut={() => setZoom((value) => Math.max(10, value - 10))}
        onZoomIn={() => setZoom((value) => Math.min(400, value + 10))}
        onFit={() => setFitToken((value) => value + 1)}
        onAiAnnotate={() => setAiAnnotateOpen(true)}
      />

      <AiAnnotateDialog
        open={aiAnnotateOpen}
        onOpenChange={setAiAnnotateOpen}
        projectId={project.id}
        imageId={currentImage.id}
        labels={labels}
        onDetected={handleAiDetected}
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
        <div className="min-w-0 space-y-4">
          <SuggestionReviewBar
            pendingCount={pendingCount}
            otherImagesToReview={otherImagesToReview}
            selectedIsSuggestion={selectedIsSuggestion}
            isSaving={isSaving}
            error={saveError}
            onAcceptSelected={() => {
              if (selectedBoxId) acceptSuggestion(selectedBoxId);
            }}
            onRejectSelected={() => {
              if (selectedBoxId) handleDeleteBox(selectedBoxId);
            }}
            onAcceptAll={handleAcceptAll}
            onRejectAll={handleRejectAll}
            onAcceptAllAndNext={() => void saveAndReviewNext({})}
            onNextToReview={() => void saveAndReviewNext(suggestionMeta)}
          />

          <div className="min-h-[510px] overflow-hidden rounded-xl border bg-muted/30 shadow-sm">
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
                fitNonce={fitToken}
                className="h-[510px]"
              />
            ) : (
              <div className="flex h-[510px] items-center justify-center text-sm text-muted-foreground">
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

        <div className="space-y-4">
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
            onDeleteLabel={handleDeleteLabel}
            onSelectBox={(id) => {
              setSelectedBoxId(id);
              if (id) setTool("select");
            }}
            onUpdateBox={handleUpdateBox}
            onMoveBox={handleMoveBox}
            onDeleteBox={handleDeleteBox}
            suggestionConfidence={suggestionConfidence}
            onAcceptSuggestion={acceptSuggestion}
            onRejectSuggestion={handleDeleteBox}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${saveError ? "bg-destructive" : isSaving ? "bg-amber-500" : "bg-emerald-500"}`} />
          <span>{saveError ? "Auto-save failed" : isSaving ? "Saving..." : "Auto-save enabled"}</span>
          {lastSavedAt ? (
            <><span aria-hidden>·</span><span>Last saved {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></>
          ) : null}
        </div>
        <span className="flex items-center gap-1">
          <Keyboard className="size-3.5" /> Shortcuts: Delete, undo and redo
          {pendingCount > 0 ? " · A accept suggestion · Shift+A accept all" : ""}
        </span>
      </div>

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
