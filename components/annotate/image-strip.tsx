"use client";

import { memo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { thumbhashColor } from "@/lib/image-placeholder";
import type { ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

type ImageStripProps = {
  images: ProjectImage[];
  activeImageId: string;
  /** Images with AI suggestions to review (marked with a dot). */
  reviewImageIds: ReadonlySet<string>;
  onSelect: (imageId: string) => void;
  /** Pointer or focus is on a thumbnail: get that image ready to open. */
  onPrefetch: (imageId: string) => void;
};

/**
 * The workspace's image filmstrip. It stays mounted while images switch, so
 * it keeps its scroll position and only moves to keep the open image in view.
 * Memoised: workspace edits re-render the canvas, not hundreds of thumbnails.
 */
export const ImageStrip = memo(function ImageStrip({
  images,
  activeImageId,
  reviewImageIds,
  onSelect,
  onPrefetch,
}: ImageStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeIndex = images.findIndex((image) => image.id === activeImageId);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const thumb = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !thumb) return;
    const bounds = scroller.getBoundingClientRect();
    const target = thumb.getBoundingClientRect();
    const overflow =
      target.left < bounds.left
        ? target.left - bounds.left
        : target.right > bounds.right
          ? target.right - bounds.right
          : 0;
    if (overflow !== 0) scroller.scrollBy({ left: overflow, behavior: "smooth" });
  }, [activeImageId]);

  const selectAt = (index: number) => {
    const image = images[index];
    if (image) onSelect(image.id);
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
      <Button type="button" variant="ghost" size="icon" onClick={() => selectAt(activeIndex - 1)} disabled={activeIndex <= 0} aria-label="Previous thumbnails">
        <ChevronLeft className="size-4" />
      </Button>
      <div ref={scrollerRef} className="grid min-w-0 flex-1 auto-cols-[110px] grid-flow-col gap-3 overflow-x-auto py-1">
        {images.map((image) => {
          const isActive = image.id === activeImageId;
          return (
            <button
              type="button"
              key={image.id}
              onClick={() => onSelect(image.id)}
              onPointerEnter={() => onPrefetch(image.id)}
              onFocus={() => onPrefetch(image.id)}
              className="min-w-0 text-left"
              aria-current={isActive ? "true" : undefined}
            >
              <span
                className={cn(
                  "relative block h-16 overflow-hidden rounded-md border bg-muted transition",
                  isActive ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/50",
                )}
                style={{ backgroundColor: thumbhashColor(image.thumbhash) }}
              >
                {image.url ? (
                  // Signed S3 URLs are not configured for next/image optimisation.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                ) : null}
                {reviewImageIds.has(image.id) ? (
                  <span
                    className="absolute right-1 top-1 size-2.5 rounded-full bg-violet-600 ring-2 ring-background"
                    title="AI suggestions to review"
                  />
                ) : null}
              </span>
              <span className="mt-1 block truncate text-[10px]">{image.fileName}</span>
            </button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="icon" onClick={() => selectAt(activeIndex + 1)} disabled={activeIndex >= images.length - 1} aria-label="Next thumbnails">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
});
