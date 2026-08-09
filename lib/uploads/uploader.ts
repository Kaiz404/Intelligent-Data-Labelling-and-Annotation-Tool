import type { UploadProvider } from "@/lib/uploads/types";
import { createMockUploader } from "@/lib/uploads/mock-uploader";

/**
 * Factory for the active upload backend.
 *
 * Handoff: replace the mock return with `createS3Uploader()` once AWS wiring
 * lands (see `lib/uploads/s3-uploader.ts` for the step-by-step checklist).
 */
export function createUploadProvider(): UploadProvider {
  // TODO(s3): return createS3Uploader() when backend routes + IAM are ready.
  return createMockUploader();
}
