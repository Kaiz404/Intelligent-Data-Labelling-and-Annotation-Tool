import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";

export type Project = {
  id: string;
  name: string;
  description: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  image_count?: number;
  annotated_count?: number;
  /** Short-lived signed URL for the optional deterministic S3 thumbnail. */
  thumbnailUrl?: string | null;
};

export type ImageStatus = "In Progress" | "Annotated" | "Unannotated";

export type ProjectImage = {
  id: string;
  fileName: string;
  sizeBytes: number;
  capturedAt: string;
  status: ImageStatus;
  progress: number;
  /** Signed S3 URL of the original image (stable within the hour, so cacheable). */
  url: string | null;
  /** ThumbHash placeholder (base64), shown while `url` loads; null for older images until backfilled. */
  thumbhash: string | null;
  /** Last annotation version saved permanently in Supabase. */
  annotations: BoundingBox[];
};

export type ProjectDraft = {
  name: string;
  description: string;
};

/** What the export sheet needs: signed image URLs, saved annotations, labels. */
export type ProjectExportData = {
  project: Project;
  images: ProjectImage[];
  labels: AnnotationLabel[];
};
