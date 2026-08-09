import {
  resolveChunkSizeForFile,
  sliceChunk,
  splitFileIntoChunks,
} from "@/lib/uploads/chunk";
import type {
  UploadProvider,
  UploadQueueItem,
  UploadResult,
  UploadStartContext,
} from "@/lib/uploads/types";
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  DEFAULT_MAX_CONCURRENT_CHUNKS,
} from "@/lib/uploads/types";

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Simulates chunked uploads for UI/dev. Mirrors the concurrency + progress
 * shape an S3 multipart client should expose.
 */
export function createMockUploader(options?: {
  chunkSizeBytes?: number;
  maxConcurrentChunks?: number;
  bytesPerSecond?: number;
}): UploadProvider {
  const chunkSizeBytes = options?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const maxConcurrentChunks =
    options?.maxConcurrentChunks ?? DEFAULT_MAX_CONCURRENT_CHUNKS;
  const bytesPerSecond = options?.bytesPerSecond ?? 2.5 * 1024 * 1024;

  return {
    async upload(
      item: UploadQueueItem,
      context: UploadStartContext,
    ): Promise<UploadResult> {
      const file = item.file;
      if (!file) {
        throw new Error(`Missing File handle for ${item.fileName}`);
      }

      const uploadId = item.uploadId ?? `mock-upload-${item.id}`;
      const key =
        item.key ??
        `projects/${context.projectId}/images/${item.id}-${file.name}`;

      const size = resolveChunkSizeForFile(file.size, chunkSizeBytes);
      const chunks = splitFileIntoChunks(file, size);
      const completed = new Set(item.completedParts ?? []);
      let bytesUploaded = [...completed].reduce((sum, partNumber) => {
        const chunk = chunks[partNumber - 1];
        return sum + (chunk?.size ?? 0);
      }, 0);

      context.onProgress({
        fileId: item.id,
        bytesUploaded,
        totalBytes: file.size,
        progress: file.size ? Math.round((bytesUploaded / file.size) * 100) : 0,
        completedParts: [...completed],
        uploadId,
        key,
      });

      const pending = chunks.filter((c) => !completed.has(c.index + 1));
      let cursor = 0;

      async function uploadOne(chunkIndex: number) {
        const chunk = pending[chunkIndex];
        if (!chunk) return;

        // Touch the slice so the API shape matches real S3 PUT of a Blob body.
        void sliceChunk(file!, chunk);

        const durationMs = Math.max(
          120,
          Math.round((chunk.size / bytesPerSecond) * 1000),
        );
        await sleep(durationMs, context.signal);

        // Random soft failure (~8%) so Failed/retry UI can be exercised.
        if (Math.random() < 0.08) {
          throw new Error("Simulated chunk upload failure");
        }

        completed.add(chunk.index + 1);
        bytesUploaded += chunk.size;

        context.onProgress({
          fileId: item.id,
          bytesUploaded: Math.min(bytesUploaded, file!.size),
          totalBytes: file!.size,
          progress: Math.min(
            100,
            Math.round((bytesUploaded / file!.size) * 100),
          ),
          completedParts: [...completed].sort((a, b) => a - b),
          uploadId,
          key,
        });
      }

      async function worker() {
        while (cursor < pending.length) {
          const next = cursor;
          cursor += 1;
          await uploadOne(next);
        }
      }

      try {
        const workers = Array.from(
          { length: Math.min(maxConcurrentChunks, pending.length || 1) },
          () => worker(),
        );
        await Promise.all(workers);
      } catch (error) {
        if (context.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw error;
      }

      return { fileId: item.id, key, uploadId };
    },

    async abort() {
      // No server state for mock.
    },
  };
}
