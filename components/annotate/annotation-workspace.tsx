"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
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
  const [hydrated, setHydrated] = useState(false);

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
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 1600);
  }, [boxes, currentImage, project.id]);

  if (!currentImage) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
        No images available to annotate.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
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

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-h-[550px] flex-1 overflow-hidden rounded-[10px] border border-zinc-100 shadow-sm">
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
              onSelectBox={setSelectedBoxId}
              onBoxesChange={handleBoxesChange}
              onZoomChange={setZoom}
              fitNonce={fitToken}
              className="h-[550px]"
            />
          ) : (
            <div className="flex h-[550px] items-center justify-center text-sm text-muted-foreground">
              Loading annotations...
            </div>
          )}
        </div>

        <AnnotationSidePanel
          labels={labels}
          boxes={boxes}
          selectedLabelId={selectedLabelId}
          selectedBoxId={selectedBoxId}
          onSelectLabel={setSelectedLabelId}
          onSelectBox={(id) => {
            setSelectedBoxId(id);
            if (id) {
              setTool("select");
            }
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} className="rounded-[10px]">
          Save changes
        </Button>
        {saveFlash ? (
          <p className="text-sm text-muted-foreground">Saved for this session.</p>
        ) : null}
      </div>
    </div>
  );
}
