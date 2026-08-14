import type { UploadProvider } from "@/lib/uploads/types";
import { createS3Uploader } from "@/lib/uploads/s3-uploader";

/**
 * Factory for the active upload backend.
 *
 * The browser uploads file bytes directly to S3 through short-lived presigned
 * URLs. The application server only authorizes and orchestrates the multipart
 * lifecycle.
 */
export function createUploadProvider(): UploadProvider {
  return createS3Uploader();
}
