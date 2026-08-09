import type { FileChunk } from "@/lib/uploads/types";
import { DEFAULT_CHUNK_SIZE_BYTES } from "@/lib/uploads/types";

/**
 * Split a File into ordered byte-range chunks for multipart upload.
 *
 * S3 notes for the implementer:
 * - Part size must be ≥ 5 MiB (except the last part) for S3 multipart.
 * - Cap part count at 10,000 (S3 hard limit) — raise chunk size if needed.
 * - Prefer 8–16 MiB parts for throughput vs. request overhead.
 */
export function splitFileIntoChunks(
  file: File | { size: number },
  chunkSizeBytes: number = DEFAULT_CHUNK_SIZE_BYTES,
): FileChunk[] {
  if (chunkSizeBytes <= 0) {
    throw new Error("chunkSizeBytes must be > 0");
  }

  const chunks: FileChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < file.size) {
    const end = Math.min(start + chunkSizeBytes, file.size);
    chunks.push({
      index,
      start,
      end,
      size: end - start,
    });
    start = end;
    index += 1;
  }

  return chunks;
}

/** Slice a Blob/File for a given chunk descriptor (browser-side PUT body). */
export function sliceChunk(file: Blob, chunk: FileChunk): Blob {
  return file.slice(chunk.start, chunk.end);
}

/**
 * Ensure part count stays within S3's 10,000-part limit by growing chunk size.
 * Call this when choosing part size for very large files.
 */
export function resolveChunkSizeForFile(
  fileSizeBytes: number,
  preferredChunkSize: number = DEFAULT_CHUNK_SIZE_BYTES,
  maxParts = 10_000,
): number {
  const minSizeForLimit = Math.ceil(fileSizeBytes / maxParts);
  return Math.max(preferredChunkSize, minSizeForLimit);
}
