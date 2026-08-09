import type { UploadProvider } from "@/lib/uploads/types";

/**
 * S3 multipart uploader — STUB for teammate handoff.
 *
 * Do NOT implement AWS calls here yet. Replace this stub when ready, then
 * switch `createUploadProvider()` in `lib/uploads/uploader.ts`.
 *
 * ---------------------------------------------------------------------------
 * Recommended architecture (presigned multipart, browser → S3 direct)
 * ---------------------------------------------------------------------------
 *
 * Why direct-to-S3?
 * - Bulk image sets (multi-GB) must not stream through the Next.js server.
 * - Browser PUTs chunks to S3 using short-lived presigned URLs.
 * - App server only orchestrates multipart lifecycle + DB metadata.
 *
 * Server routes / actions to add (suggest under `lib/actions/uploads.ts`
 * or `app/api/uploads/...`):
 *
 * 1) `POST /api/uploads/create`
 *    Body: { projectId, fileName, contentType, sizeBytes }
 *    Auth: require session; verify project ownership (RLS / user_id).
 *    AWS: CreateMultipartUpload → { uploadId, key }
 *    Also insert a pending row in `images` (status=uploading).
 *
 * 2) `POST /api/uploads/presign-parts`
 *    Body: { key, uploadId, partNumbers: number[] }
 *    AWS: for each part → getSignedUrl(UploadPartCommand)
 *    Return: [{ partNumber, url }]
 *    Tip: batch ~20–50 parts per request to limit round-trips.
 *
 * 3) `POST /api/uploads/complete`
 *    Body: { key, uploadId, parts: [{ PartNumber, ETag }] }
 *    AWS: CompleteMultipartUpload
 *    Then: mark image row ready; optionally write CloudFront/CDN URL.
 *
 * 4) `POST /api/uploads/abort`
 *    Body: { key, uploadId }
 *    AWS: AbortMultipartUpload + cleanup pending DB row.
 *    Call from provider.abort() and on "Cancel All".
 *
 * Client flow (implement inside `upload()` below):
 *  a. Call create → store uploadId + key on the queue item (onProgress).
 *  b. `splitFileIntoChunks(file)` from `./chunk` (respect 5 MiB min part size).
 *  c. Skip parts in `item.completedParts` (resume after pause/failure).
 *  d. Presign a window of pending parts; PUT each Blob (`sliceChunk`) with
 *     concurrency = DEFAULT_MAX_CONCURRENT_CHUNKS; honor `context.signal`.
 *  e. Collect ETags from response headers (S3 returns ETag on each part PUT).
 *  f. onProgress after each part: bytes + completedParts for UI + resume.
 *  g. complete multipart when all parts succeed.
 *
 * Pause / resume:
 *  - Pause = AbortController.abort() for in-flight PUTs; KEEP uploadId +
 *    completedParts on the queue item (do not AbortMultipartUpload).
 *  - Resume = same uploadId; ListParts (optional server call) or trust local
 *    completedParts; continue from remaining parts.
 *
 * IAM / bucket checklist:
 *  - Bucket CORS: allow PUT/GET from app origin; expose ETag header.
 *  - IAM: s3:CreateMultipartUpload, UploadPart, CompleteMultipartUpload,
 *    AbortMultipartUpload, ListParts — scoped to `projects/{userId}/*`.
 *  - Prefer SSE-S3 or SSE-KMS; never ship long-lived AWS keys to the browser.
 *
 * Env vars to add later (document in AGENTS.md when real):
 *  - AWS_REGION, AWS_S3_BUCKET
 *  - Server-only credentials via IAM role / OIDC (Vercel) — not NEXT_PUBLIC_*
 *
 * DB follow-up:
 *  - Persist uploadId/key/completedParts if you need cross-refresh resume.
 *  - Wire `images` table (already in local migrations) to final object key.
 */
export function createS3Uploader(): UploadProvider {
  return {
    async upload() {
      throw new Error(
        "S3 uploader is not implemented yet. See lib/uploads/s3-uploader.ts.",
      );
    },
    async abort() {
      // TODO(s3): call AbortMultipartUpload via /api/uploads/abort
    },
  };
}
