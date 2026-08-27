import {
  resolveChunkSizeForFile,
  sliceChunk,
  splitFileIntoChunks,
} from "@/lib/uploads/chunk";
import type {
  CompletedUploadPart,
  UploadProvider,
  UploadProgressEvent,
  UploadQueueItem,
  UploadResult,
  UploadStartContext,
} from "@/lib/uploads/types";
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  DEFAULT_MAX_CONCURRENT_CHUNKS,
} from "@/lib/uploads/types";

const PRESIGN_BATCH_SIZE = 50;
const MAX_PUT_ATTEMPTS = 3;

type CreateResponse = { uploadId: string; key: string };
type PresignResponse = { parts: Array<{ partNumber: number; url: string }> };
type CompleteResponse = { key: string; imageId: string };

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestApi<T>(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Upload API request failed (${response.status}).`;
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function progressEvent(
  item: UploadQueueItem,
  file: File,
  completedParts: Map<number, string>,
  chunksByPart: Map<number, { size: number }>,
  uploadId: string,
  key: string,
): UploadProgressEvent {
  const bytesUploaded = [...completedParts.keys()].reduce(
    (total, partNumber) => total + (chunksByPart.get(partNumber)?.size ?? 0),
    0,
  );
  const completedPartETags: CompletedUploadPart[] = [...completedParts]
    .map(([partNumber, eTag]) => ({ partNumber, eTag }))
    .sort((a, b) => a.partNumber - b.partNumber);

  return {
    fileId: item.id,
    bytesUploaded,
    totalBytes: file.size,
    progress: file.size ? Math.round((bytesUploaded / file.size) * 100) : 0,
    completedParts: completedPartETags.map((part) => part.partNumber),
    completedPartETags,
    uploadId,
    key,
  };
}

async function uploadPartWithRetry(
  url: string,
  body: Blob,
  signal: AbortSignal,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);
    try {
      const response = await fetch(url, { method: "PUT", body, signal });
      if (!response.ok) {
        throw new Error(`S3 part upload failed (${response.status}).`);
      }

      const eTag = response.headers.get("etag");
      if (!eTag) {
        throw new Error(
          "S3 did not expose an ETag header. Configure bucket CORS to expose ETag.",
        );
      }
      return eTag;
    } catch (error) {
      if (signal.aborted) throw abortError();
      lastError = error;
      if (attempt < MAX_PUT_ATTEMPTS) {
        await wait(250 * 2 ** (attempt - 1), signal);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("S3 part upload failed.");
}

async function uploadPresignedBatch({
  chunks,
  urls,
  file,
  signal,
  completedParts,
  onPartComplete,
  maxConcurrentChunks,
}: {
  chunks: Array<{ index: number; start: number; end: number; size: number }>;
  urls: Map<number, string>;
  file: File;
  signal: AbortSignal;
  completedParts: Map<number, string>;
  onPartComplete: () => void;
  maxConcurrentChunks: number;
}) {
  let cursor = 0;
  let failure: unknown;

  async function worker() {
    while (!failure && cursor < chunks.length) {
      const chunk = chunks[cursor++];
      const partNumber = chunk.index + 1;
      const url = urls.get(partNumber);
      if (!url) {
        failure = new Error(`Missing presigned URL for part ${partNumber}.`);
        return;
      }

      try {
        const eTag = await uploadPartWithRetry(
          url,
          sliceChunk(file, chunk),
          signal,
        );
        completedParts.set(partNumber, eTag);
        onPartComplete();
      } catch (error) {
        failure = error;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(maxConcurrentChunks, chunks.length) },
      () => worker(),
    ),
  );

  if (failure) throw failure;
}

/**
 * Browser-side S3 multipart uploader. File bytes never pass through Next.js:
 * the app API authorizes each lifecycle operation and S3 receives direct PUTs.
 */
export function createS3Uploader(options?: {
  chunkSizeBytes?: number;
  maxConcurrentChunks?: number;
}): UploadProvider {
  const preferredChunkSize =
    options?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const maxConcurrentChunks =
    options?.maxConcurrentChunks ?? DEFAULT_MAX_CONCURRENT_CHUNKS;

  return {
    async upload(
      item: UploadQueueItem,
      context: UploadStartContext,
    ): Promise<UploadResult> {
      const file = item.file;
      if (!file) throw new Error(`Missing File handle for ${item.fileName}.`);
      if (maxConcurrentChunks < 1) {
        throw new Error("maxConcurrentChunks must be at least 1.");
      }

      throwIfAborted(context.signal);
      let uploadId = item.uploadId;
      let key = item.key;

      if (!uploadId || !key) {
        const created = await requestApi<CreateResponse>(
          "/api/uploads/create",
          {
            projectId: context.projectId,
            fileName: file.name,
            contentType: file.type,
            sizeBytes: file.size,
          },
          context.signal,
        );
        uploadId = created.uploadId;
        key = created.key;
      }

      const chunkSize = resolveChunkSizeForFile(file.size, preferredChunkSize);
      const chunks = splitFileIntoChunks(file, chunkSize);
      const chunksByPart = new Map(
        chunks.map((chunk) => [chunk.index + 1, { size: chunk.size }]),
      );
      // A number without an ETag cannot be submitted to CompleteMultipartUpload,
      // so upload that part again to obtain a usable ETag.
      const completedParts = new Map(
        (item.completedPartETags ?? []).map((part) => [part.partNumber, part.eTag]),
      );
      const reportProgress = () =>
        context.onProgress(
          progressEvent(item, file, completedParts, chunksByPart, uploadId!, key!),
        );

      reportProgress();
      const pending = chunks.filter(
        (chunk) => !completedParts.has(chunk.index + 1),
      );

      for (let start = 0; start < pending.length; start += PRESIGN_BATCH_SIZE) {
        throwIfAborted(context.signal);
        const batch = pending.slice(start, start + PRESIGN_BATCH_SIZE);
        const presigned = await requestApi<PresignResponse>(
          "/api/uploads/presign-parts",
          {
            key,
            uploadId,
            partNumbers: batch.map((chunk) => chunk.index + 1),
          },
          context.signal,
        );
        const urls = new Map(
          presigned.parts.map((part) => [part.partNumber, part.url]),
        );

        await uploadPresignedBatch({
          chunks: batch,
          urls,
          file,
          signal: context.signal,
          completedParts,
          onPartComplete: reportProgress,
          maxConcurrentChunks,
        });
      }

      throwIfAborted(context.signal);
      const parts = [...completedParts]
        .map(([partNumber, eTag]) => ({ partNumber, eTag }))
        .sort((a, b) => a.partNumber - b.partNumber);
      const completed = await requestApi<CompleteResponse>(
        "/api/uploads/complete",
        {
          key,
          uploadId,
          parts,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        },
        context.signal,
      );

      return {
        fileId: item.id,
        key: completed.key,
        imageId: completed.imageId,
        uploadId,
      };
    },

    async abort(item: UploadQueueItem) {
      if (!item.uploadId || !item.key) return;
      await requestApi<undefined>("/api/uploads/abort", {
        key: item.key,
        uploadId: item.uploadId,
      });
    },
  };
}
