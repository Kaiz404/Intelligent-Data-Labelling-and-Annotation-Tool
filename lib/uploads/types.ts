/**
 * Upload domain types — UI + provider contract.
 *
 * S3 handoff: keep this surface stable. The S3 uploader should map multipart
 * state onto these fields (especially `uploadId`, `key`, `completedParts`).
 */

export type UploadStatus =
  | "Queued"
  | "Uploading"
  | "Paused"
  | "Completed"
  | "Failed";

export type UploadTab = "All" | "Uploading" | "Completed" | "Failed";

/** One byte-range slice of a file (multipart-friendly). */
export type FileChunk = {
  index: number;
  start: number;
  end: number;
  size: number;
};

/**
 * Queue item shown in the upload modal.
 *
 * When wiring S3:
 * - `uploadId` ← CreateMultipartUpload
 * - `key` ← object key in the bucket
 * - `completedParts` ← [{ PartNumber, ETag }, ...] for CompleteMultipartUpload
 */
export type UploadQueueItem = {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  status: UploadStatus;
  /** 0–100 overall file progress (sum of completed + in-flight chunks). */
  progress: number;
  error?: string;
  /** Local File handle — required for chunk reads. Cleared after success optional. */
  file?: File;
  previewUrl?: string;
  /** S3 multipart upload id (set by provider once CreateMultipartUpload returns). */
  uploadId?: string;
  /** Destination object key (e.g. `projects/{projectId}/images/{uuid}.jpg`). */
  key?: string;
  /** 1-based part numbers already uploaded successfully (resume support). */
  completedParts?: number[];
};

export type UploadProgressEvent = {
  fileId: string;
  bytesUploaded: number;
  totalBytes: number;
  progress: number;
  completedParts?: number[];
  uploadId?: string;
  key?: string;
};

export type UploadResult = {
  fileId: string;
  key: string;
  uploadId?: string;
};

export type UploadStartContext = {
  projectId: string;
  /** Abort in-flight HTTP when pausing/cancelling. */
  signal: AbortSignal;
  onProgress: (event: UploadProgressEvent) => void;
};

/**
 * Pluggable upload backend.
 *
 * Swap `createMockUploader()` for `createS3Uploader()` in `createUploadProvider()`.
 * Implementations must upload in chunks (see `lib/uploads/chunk.ts`) so large
 * batches (multi-GB) stay memory-safe and resumable.
 */
export type UploadProvider = {
  /**
   * Upload one file end-to-end (chunked internally).
   * Resolve on success; reject on hard failure (network after retries, abort, etc.).
   */
  upload(
    item: UploadQueueItem,
    context: UploadStartContext,
  ): Promise<UploadResult>;

  /** Best-effort cancel of server-side multipart state (AbortMultipartUpload). */
  abort?(item: UploadQueueItem): Promise<void>;
};

export const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB — typical S3 part size
export const DEFAULT_MAX_CONCURRENT_FILES = 3;
export const DEFAULT_MAX_CONCURRENT_CHUNKS = 4;
export const MAX_TOTAL_UPLOAD_BYTES = 15 * 1024 * 1024 * 1024; // 15 GB (matches UI copy)
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
