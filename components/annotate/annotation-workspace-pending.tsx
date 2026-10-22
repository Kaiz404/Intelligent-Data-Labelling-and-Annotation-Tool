"use client";

import { AppHeader } from "@/components/app-shell/app-header";
import { AnnotationSidePanel } from "@/components/annotate/annotation-side-panel";
import { AnnotationToolbar } from "@/components/annotate/annotation-toolbar";
import { CanvasPlaceholder } from "@/components/annotate/canvas-placeholder";
import { ImageStrip } from "@/components/annotate/image-strip";
import { ImageStripSkeleton } from "@/components/annotate/image-strip-skeleton";
import { Button } from "@/components/ui/button";
import { StreamingLoadBanner } from "@/components/ui/streaming-load-banner";
import { Loader2 } from "lucide-react";
import type { AnnotationLabel } from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

const noop = () => undefined;
const noopAsync = async () => undefined;
const noIds: ReadonlySet<string> = new Set();

type AnnotationWorkspacePendingProps = {
  project: Project;
  labels: AnnotationLabel[];
  images: ProjectImage[];
  routeImageId: string | null;
  error: string | null;
};

/** Real workspace chrome while images stream in; the canvas stays on a placeholder. */
export function AnnotationWorkspacePending({
  project,
  labels,
  images,
  routeImageId,
  error,
}: AnnotationWorkspacePendingProps) {
  const activeImageId = routeImageId ?? images[0]?.id ?? "";

  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${project.id}` },
          { label: "Loading…" },
        ]}
      />
      <div className="flex-1 p-4 md:p-6">
        <div className="flex flex-col gap-4">
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : (
            <StreamingLoadBanner
              title="Loading annotation workspace…"
              description="Tools and labels appear first; your canvas and thumbnails follow."
            />
          )}
          <AnnotationToolbar
            imageIndex={0}
            imageCount={project.image_count ?? images.length}
            tool="select"
            zoom={100}
            canUndo={false}
            canRedo={false}
            canDelete={false}
            isFullscreen={false}
            onPrev={noop}
            onNext={noop}
            onToolChange={noop}
            onUndo={noop}
            onRedo={noop}
            onDelete={noop}
            onZoomOut={noop}
            onZoomIn={noop}
            onResetView={noop}
            onToggleFullscreen={noop}
            onAiAnnotate={noop}
            onOpenJobProgress={noop}
          />

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
            <div className="min-w-0 space-y-4">
              <div className="overflow-hidden rounded-xl border bg-muted/30 shadow-sm min-h-[500px]">
                <div className="relative h-[500px]">
                  <CanvasPlaceholder thumbhash={null} />
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/40 backdrop-blur-[1px]"
                    aria-hidden="true"
                  >
                    <Loader2 className="size-8 animate-spin text-primary" />
                    <p className="text-sm font-medium text-muted-foreground">
                      Preparing canvas…
                    </p>
                  </div>
                </div>
              </div>
              {images.length > 0 ? (
                <ImageStrip
                  images={images}
                  activeImageId={activeImageId}
                  reviewImageIds={noIds}
                  annotatedImageIds={noIds}
                  onSelect={noop}
                  onPrefetch={noop}
                />
              ) : (
                <ImageStripSkeleton />
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" disabled className="rounded-lg">
                  Save
                </Button>
                <Button type="button" variant="outline" disabled className="rounded-lg">
                  Export
                </Button>
              </div>
              <AnnotationSidePanel
                labels={labels}
                boxes={[]}
                selectedLabelId={labels[0]?.id ?? ""}
                selectedBoxId={null}
                imageSize={null}
                onSelectLabel={noop}
                onCreateLabel={noopAsync}
                onRenameLabel={noopAsync}
                onDeleteLabel={noopAsync}
                onSelectBox={noop}
                onUpdateBox={noop}
                onMoveBox={noop}
                onReorderBox={noop}
                onDuplicateBox={noop}
                onRenameBox={noopAsync}
                onDeleteBox={noop}
                onAcceptSuggestion={noop}
                onRejectSuggestion={noop}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
