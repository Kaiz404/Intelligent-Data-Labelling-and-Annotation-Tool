import { createThumbhash } from "@/lib/image-placeholder";
import { objectKeyFileName } from "@/lib/uploads/object-key";
import { openUploadSource } from "@/lib/uploads/zip-source";
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
  MAX_COMMIT_IMAGES,
  SINGLE_REQUEST_UPLOAD_MAX_BYTES,
} from "@/lib/uploads/types";

const PRESIGN_BATCH_SIZE = 50;
const MAX_PUT_ATTEMPTS = 3;
const MAX_COMMIT_ATTEMPTS = 3;
/** How long a save waits for more finished images to share its request. */
const COMMIT_BATCH_WAIT_MS = 250;
/** A policy this close to expiry is replaced before use. */
const POLICY_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Decoding is the costly part of hashing, so few images decode at once. */
const MAX_CONCURRENT_THUMBHASHES = 4;

type CreateResponse = { uploadId: string; key: string };
type PresignResponse = { parts: Array<{ partNumber: number; url: string }> };
type CompleteResponse = { key: string; imageId: string };
type UploadPolicy = {
  url: string;
  fields: Record<string, string>;
  keyPrefix: string;
  expiresInSeconds: number;
};
type CommitRequest = { key: string; fileName: string; thumbhash: string | null };
type CommitResult = { key: string; imageId?: string; error?: string };

class UploadRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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
    throw new UploadRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function progressEvent(
  item: UploadQueueItem,
  file: Blob,
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
  file: Blob;
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

/** Runs at most `limit` calls of `task` at once. */
function limitConcurrency<In, Out>(
  limit: number,
  task: (input: In) => Promise<Out>,
) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async (input: In) => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task(input);
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

/**
 * Collects calls into one `send` of up to `maxSize` inputs, sent when full or
 * `waitMs` after the first. A call aborted before its batch is sent leaves the
 * batch; once sent, its result is returned regardless.
 */
function createBatcher<In, Out>(
  send: (inputs: In[]) => Promise<Out[]>,
  maxSize: number,
  waitMs: number,
) {
  type Entry = {
    input: In;
    resolve: (output: Out) => void;
    reject: (error: unknown) => void;
    detach: () => void;
  };
  let pending: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    for (const entry of batch) entry.detach();
    send(batch.map((entry) => entry.input)).then(
      (outputs) => batch.forEach((entry, index) => entry.resolve(outputs[index])),
      (error) => batch.forEach((entry) => entry.reject(error)),
    );
  }

  return (input: In, signal: AbortSignal) =>
    new Promise<Out>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        pending = pending.filter((other) => other !== entry);
        reject(abortError());
      };
      const entry: Entry = {
        input,
        resolve,
        reject,
        detach: () => signal.removeEventListener("abort", onAbort),
      };
      signal.addEventListener("abort", onAbort, { once: true });
      pending.push(entry);
      if (pending.length >= maxSize) flush();
      else timer ??= setTimeout(flush, waitMs);
    });
}

/** Retries a request that failed on the network or with a server error. */
async function withRequestRetry<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const retryable =
        !(error instanceof UploadRequestError) || error.status >= 500;
      if (!retryable || attempt >= MAX_COMMIT_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

async function postObject(
  policy: UploadPolicy,
  key: string,
  file: Blob,
  contentType: string,
  signal: AbortSignal,
) {
  const form = new FormData();
  for (const [name, value] of Object.entries(policy.fields)) {
    form.append(name, value);
  }
  form.set("key", key);
  form.append("Content-Type", contentType);
  // S3 ignores every field after the file.
  form.append("file", file);
  const response = await fetch(policy.url, { method: "POST", body: form, signal });
  if (!response.ok) {
    throw new UploadRequestError(
      `S3 upload failed (${response.status}).`,
      response.status,
    );
  }
}

/**
 * Browser-side S3 uploader. File bytes never pass through Next.js: files up to
 * SINGLE_REQUEST_UPLOAD_MAX_BYTES go in one POST under a shared upload policy
 * and are saved in batches; larger files use multipart PUTs, each step
 * authorized by the app API.
 */
export function createS3Uploader(options?: {
  chunkSizeBytes?: number;
  maxConcurrentChunks?: number;
}): UploadProvider {
  const preferredChunkSize =
    options?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const maxConcurrentChunks =
    options?.maxConcurrentChunks ?? DEFAULT_MAX_CONCURRENT_CHUNKS;
  const hashImage = limitConcurrency(MAX_CONCURRENT_THUMBHASHES, createThumbhash);
  const policies = new Map<
    string,
    { policy: Promise<UploadPolicy>; expiresAt: number }
  >();
  const commitBatchers = new Map<
    string,
    (input: CommitRequest, signal: AbortSignal) => Promise<CommitResult>
  >();
  /** Keys whose save was sent, so their image may exist even if never confirmed. */
  const sentKeys = new Set<string>();

  function uploadPolicy(projectId: string) {
    const cached = policies.get(projectId);
    if (cached && cached.expiresAt - Date.now() > POLICY_REFRESH_MARGIN_MS) {
      return cached.policy;
    }
    const requestedAt = Date.now();
    const entry = {
      policy: requestApi<UploadPolicy>("/api/uploads/policy", { projectId }),
      expiresAt: Infinity,
    };
    policies.set(projectId, entry);
    entry.policy.then(
      (policy) => {
        entry.expiresAt = requestedAt + policy.expiresInSeconds * 1000;
      },
      () => {
        if (policies.get(projectId) === entry) policies.delete(projectId);
      },
    );
    return entry.policy;
  }

  function commitImage(
    projectId: string,
    input: CommitRequest,
    signal: AbortSignal,
  ) {
    let commit = commitBatchers.get(projectId);
    if (!commit) {
      commit = createBatcher<CommitRequest, CommitResult>(
        async (images) => {
          for (const image of images) sentKeys.add(image.key);
          const { images: results } = await withRequestRetry(() =>
            requestApi<{ images: CommitResult[] }>("/api/uploads/commit", {
              projectId,
              images,
            }),
          );
          return results;
        },
        MAX_COMMIT_IMAGES,
        COMMIT_BATCH_WAIT_MS,
      );
      commitBatchers.set(projectId, commit);
    }
    return commit(input, signal);
  }

  /** Small files: one S3 POST, then a save batched with other images. */
  async function uploadSingle(
    item: UploadQueueItem,
    file: Blob,
    context: UploadStartContext,
  ): Promise<UploadResult> {
    const thumbhash = hashImage(file).catch(() => null);
    // A key without an uploadId means an earlier attempt already stored the bytes.
    let key = item.key;
    if (!key) {
      const name = objectKeyFileName(item.fileName);
      if (!name) throw new Error("The file name is invalid.");
      let policy = await uploadPolicy(context.projectId);
      throwIfAborted(context.signal);
      key = `${policy.keyPrefix}${crypto.randomUUID()}/${name}`;
      for (let attempt = 1; ; attempt += 1) {
        try {
          await postObject(policy, key, file, item.mimeType, context.signal);
          break;
        } catch (error) {
          if (context.signal.aborted) throw abortError();
          if (attempt >= MAX_PUT_ATTEMPTS) throw error;
          // An expired or rejected policy answers 403; a fresh one may work.
          if (error instanceof UploadRequestError && error.status === 403) {
            policies.delete(context.projectId);
          }
          await wait(250 * 2 ** (attempt - 1), context.signal);
          policy = await uploadPolicy(context.projectId);
        }
      }
      context.onProgress({
        fileId: item.id,
        bytesUploaded: file.size,
        totalBytes: file.size,
        progress: 100,
        key,
      });
    }

    const hash = await thumbhash;
    const committed = await commitImage(
      context.projectId,
      { key, fileName: item.fileName, thumbhash: hash },
      context.signal,
    );
    if (!committed.imageId) {
      // The server refused these bytes, so a retry uploads them again.
      context.onProgress({
        fileId: item.id,
        bytesUploaded: 0,
        totalBytes: file.size,
        progress: 0,
        key: undefined,
      });
      throw new Error(committed.error ?? "The uploaded image could not be saved.");
    }
    return { fileId: item.id, key, imageId: committed.imageId, thumbhash: hash };
  }

  return {
    async upload(
      item: UploadQueueItem,
      context: UploadStartContext,
    ): Promise<UploadResult> {
      if (maxConcurrentChunks < 1) {
        throw new Error("maxConcurrentChunks must be at least 1.");
      }

      throwIfAborted(context.signal);
      // Opened per attempt so a ZIP entry's bytes live only while it uploads.
      const file = await openUploadSource(item.source);
      throwIfAborted(context.signal);
      if (!item.uploadId && file.size <= SINGLE_REQUEST_UPLOAD_MAX_BYTES) {
        return uploadSingle(item, file, context);
      }
      // Hashed while the bytes upload; a failure only means no placeholder.
      const thumbhash = hashImage(file).catch(() => null);
      let uploadId = item.uploadId;
      let key = item.key;

      if (!uploadId || !key) {
        const created = await requestApi<CreateResponse>(
          "/api/uploads/create",
          {
            projectId: context.projectId,
            fileName: item.fileName,
            contentType: item.mimeType,
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
      const hash = await thumbhash;
      const completed = await requestApi<CompleteResponse>(
        "/api/uploads/complete",
        {
          key,
          uploadId,
          parts,
          fileName: item.fileName,
          contentType: item.mimeType,
          sizeBytes: file.size,
          thumbhash: hash,
        },
        context.signal,
      );

      return {
        fileId: item.id,
        key: completed.key,
        imageId: completed.imageId,
        uploadId,
        thumbhash: hash,
      };
    },

    async abort(item: UploadQueueItem) {
      if (!item.key) return;
      if (!item.uploadId) {
        // Without a sent save, the POSTed object would stay in S3 with no row.
        if (sentKeys.has(item.key)) return;
        await requestApi<undefined>("/api/uploads/abort", { key: item.key });
        return;
      }
      await requestApi<undefined>("/api/uploads/abort", {
        key: item.key,
        uploadId: item.uploadId,
      });
    },
  };
}
