import {
  rgbaToThumbHash,
  thumbHashToAverageRGBA,
  thumbHashToDataURL,
  thumbHashToRGBA,
} from "thumbhash";

/**
 * ThumbHash placeholders for project images (`images.thumbhash`): a ~25-byte
 * base64 hash shown instantly while the S3 image loads. Decoding is pure, so
 * it renders identically on the server and the client.
 */

/** ThumbHash encodes at most 100×100 pixels. */
const MAX_HASH_SOURCE_SIZE = 100;

/** Base64 of a ThumbHash (at most ~25 bytes, so well under 64 characters). */
const THUMBHASH_PATTERN = /^[A-Za-z0-9+/]{4,64}={0,2}$/;

export function isThumbhash(value: unknown): value is string {
  return typeof value === "string" && THUMBHASH_PATTERN.test(value);
}

function decode(hash: string) {
  return Uint8Array.from(atob(hash), (character) => character.charCodeAt(0));
}

/** Average colour of the image: a tiny placeholder for thumbnails. */
export function thumbhashColor(hash: string | null) {
  if (!hash) return undefined;
  const { r, g, b } = thumbHashToAverageRGBA(decode(hash));
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/**
 * Blurred preview as raw pixels (at most 32×32), for drawing into a canvas
 * in the browser: grids get the preview without a data URL per card.
 */
export function thumbhashPixels(hash: string) {
  return thumbHashToRGBA(decode(hash));
}

// A decoded preview is a ~4 KB PNG data URL, so keep it to one large image
// per page (the annotation canvas) and cache it per hash.
const dataUrlCache = new Map<string, string>();
const MAX_CACHED_DATA_URLS = 200;

/** Blurred preview of the whole image, as a PNG data URL. */
export function thumbhashDataUrl(hash: string | null) {
  if (!hash) return undefined;
  let url = dataUrlCache.get(hash);
  if (!url) {
    if (dataUrlCache.size >= MAX_CACHED_DATA_URLS) dataUrlCache.clear();
    url = thumbHashToDataURL(decode(hash));
    dataUrlCache.set(hash, url);
  }
  return url;
}

/** Hashes an image file or blob in the browser (downscaled while decoding). */
export async function createThumbhash(image: Blob) {
  const bitmap = await createImageBitmap(image, {
    resizeWidth: MAX_HASH_SOURCE_SIZE,
    resizeQuality: "medium",
  });
  try {
    // resizeWidth keeps the aspect ratio, so tall images still need scaling.
    const scale = Math.min(
      1,
      MAX_HASH_SOURCE_SIZE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return btoa(String.fromCharCode(...rgbaToThumbHash(width, height, data)));
  } finally {
    bitmap.close();
  }
}
