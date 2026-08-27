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
};

export type ImageStatus = "In Progress" | "Annotated" | "Unannotated";

export type ProjectImage = {
  id: string;
  fileName: string;
  sizeBytes: number;
  capturedAt: string;
  status: ImageStatus;
  progress: number;
  thumbnailUrl: string | null;
  /** Higher-res URL for the annotation canvas when available. */
  imageUrl: string | null;
};

export type ProjectDraft = {
  name: string;
  description: string;
};
