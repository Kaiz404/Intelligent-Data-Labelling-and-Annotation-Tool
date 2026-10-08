"use client";

import { useCallback, useState } from "react";
import { thumbhashColor, thumbhashPixels } from "@/lib/image-placeholder";
import { cn } from "@/lib/utils";

/**
 * An image's ThumbHash as a blurred preview filling its frame. The server
 * renders only the average colour; the pixels are drawn after mount into a
 * canvas the size of the hash (at most 32×32), so a grid of hundreds of cards
 * adds no image data to the HTML.
 */
export function ThumbhashPreview({
  thumbhash,
  className,
}: {
  thumbhash: string | null;
  className?: string;
}) {
  const draw = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || !thumbhash) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const { w, h, rgba } = thumbhashPixels(thumbhash);
      canvas.width = w;
      canvas.height = h;
      const pixels = context.createImageData(w, h);
      pixels.data.set(rgba);
      context.putImageData(pixels, 0, 0);
    },
    [thumbhash],
  );

  if (!thumbhash) return null;
  return (
    <canvas
      ref={draw}
      aria-hidden
      className={cn("size-full object-cover", className)}
      style={{ backgroundColor: thumbhashColor(thumbhash) }}
    />
  );
}

/** A lazy image that fades in over its ThumbHash preview once loaded. */
export function ThumbhashImage({
  src,
  alt,
  thumbhash,
  className,
}: {
  src: string;
  alt: string;
  thumbhash: string | null;
  className?: string;
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // Images can finish loading before hydration attaches onLoad.
  const checkLoaded = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
    },
    [src],
  );

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <ThumbhashPreview thumbhash={thumbhash} className="absolute inset-0" />
      {/* Signed S3 and blob: URLs are not configured for next/image optimisation. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={checkLoaded}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        className={cn(
          "relative size-full object-cover transition-opacity duration-300 motion-reduce:transition-none",
          loadedSrc === src ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
