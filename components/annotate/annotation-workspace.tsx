"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Download, Keyboard } from "lucide-react";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import { AnnotationToolbar } from "@/components/annotate/annotation-toolbar";
import { Button } from "@/components/ui/button";
import {
  loadAnnotations,
  saveAnnotations,
} from "@/lib/annotations/storage";
import { MOCK_ANNOTATION_LABELS } from "@/lib/mock/annotation-labels";
import type {
  AnnotationTool,
  BoundingBox,
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
};

const MAX_HISTORY = 50;

export function AnnotationWorkspace({
  project,
  images,
  imageId,
}: AnnotationWorkspaceProps) {
  const router = useRouter();
  const labels = MOCK_ANNOTATION_LABELS;

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
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!currentImage) {
      return;
    }
    const loaded = loadAnnotations(project.id, currentImage.id);
    setBoxes(loaded);
    setPast([]);
    setFuture([]);
    setSelectedBoxId(null);
    setHydrated(true);
  }, [currentImage, project.id]);

  const commitBoxes = useCallback((next: BoundingBox[]) => {
    setBoxes((current) => {
      setPast((history) => [...history, current].slice(-MAX_HISTORY));
      setFuture([]);
      return next;
    });
  }, []);

  const handleBoxesChange = useCallback(
    (next: BoundingBox[]) => {
      commitBoxes(next);
    },
    [commitBoxes],
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
      commitBoxes(
        boxes.map((box) => (box.id === boxId ? { ...box, ...patch } : box)),
      );
    },
    [boxes, commitBoxes],
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

  const handleSave = useCallback(() => {
    if (!currentImage) {
      return;
    }
    saveAnnotations(project.id, currentImage.id, boxes);
    setLastSavedAt(new Date());
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 1600);
  }, [boxes, currentImage, project.id]);

  useEffect(() => {
    if (!hydrated || !currentImage) return;
    const timer = window.setTimeout(() => {
      saveAnnotations(project.id, currentImage.id, boxes);
      setLastSavedAt(new Date());
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [boxes, currentImage, hydrated, project.id]);

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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDelete, handleRedo, handleUndo]);

  if (!currentImage) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No images available to annotate.
      </div>
    );
  }

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
      />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
        <div className="min-w-0 space-y-4">
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
                onZoomChange={setZoom}
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
                    className={`block h-16 rounded-md border bg-muted bg-cover bg-center transition ${image.id === currentImage.id ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50"}`}
                    style={image.thumbnailUrl ? { backgroundImage: `url(${image.thumbnailUrl})` } : undefined}
                  />
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
            <Button type="button" onClick={handleSave} className="rounded-lg">
              {saveFlash ? <CheckCircle2 className="size-4" /> : null}
              {saveFlash ? "Saved" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                saveAnnotations(project.id, currentImage.id, boxes);
                setExportOpen(true);
              }}
              className="rounded-lg"
            >
              <Download className="size-4" /> Export
            </Button>
          </div>
          <AnnotationSidePanel
            labels={labels}
            boxes={boxes}
            selectedLabelId={selectedLabelId}
            selectedBoxId={selectedBoxId}
            onSelectLabel={setSelectedLabelId}
            onSelectBox={(id) => {
              setSelectedBoxId(id);
              if (id) setTool("select");
            }}
            onUpdateBox={handleUpdateBox}
            onMoveBox={handleMoveBox}
            onDeleteBox={handleDeleteBox}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span>Auto-save enabled</span>
          {lastSavedAt ? (
            <><span aria-hidden>·</span><span>Last saved {lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></>
          ) : null}
        </div>
        <span className="flex items-center gap-1"><Keyboard className="size-3.5" /> Shortcuts: Delete, undo and redo</span>
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
