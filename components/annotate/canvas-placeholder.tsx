import { thumbhashDataUrl } from "@/lib/image-placeholder";

/**
 * Fills the canvas frame until the canvas has drawn the image: the image's
 * ThumbHash as a blurred preview, inset like the canvas fits images (32px).
 * It renders on the server too, so the preview is part of the first paint.
 * Images without a hash yet get a pulse instead.
 */
export function CanvasPlaceholder({ thumbhash }: { thumbhash: string | null }) {
  const preview = thumbhashDataUrl(thumbhash);
  return (
    <div aria-hidden className="absolute inset-0 rounded-[10px] bg-accent p-8">
      {preview ? (
        // A data URL: nothing for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="size-full object-contain" />
      ) : (
        <div className="size-full animate-pulse rounded-md bg-muted/60" />
      )}
    </div>
  );
}
