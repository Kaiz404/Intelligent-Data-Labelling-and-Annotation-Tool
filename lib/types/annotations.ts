export type AnnotationTool = "select" | "bbox" | "pan";

export type AnnotationLabel = {
  id: string;
  name: string;
  color: string;
};

export type BoundingBox = {
  id: string;
  labelId: string;
  /** Image-space x (top-left) */
  x: number;
  /** Image-space y (top-left) */
  y: number;
  width: number;
  height: number;
};

export type AnnotationDocument = {
  boxes: BoundingBox[];
  updatedAt: string;
};

/** An AI-proposed box awaiting review. Same geometry as `BoundingBox`. */
export type AnnotationSuggestion = BoundingBox & {
  /** Model confidence, 0..1 */
  confidence: number;
};

export type AnnotationJobStatus = "queued" | "running" | "completed" | "cancelled";

export type AnnotationJobItemStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AnnotationJobProgress = {
  id: string;
  status: AnnotationJobStatus;
  total: number;
  counts: Record<AnnotationJobItemStatus, number>;
  /** Suggestions produced by this job that are still waiting for review. */
  pendingSuggestions: number;
  createdAt: string;
  finishedAt: string | null;
};

/** Latest AI state for one image, keyed by image ID on the project page. */
export type ImageAiState = {
  status: AnnotationJobItemStatus;
  pendingSuggestions: number;
};

/** Pending suggestions for one image in the annotation workspace. */
export type ImageSuggestionSet = {
  itemId: string;
  suggestions: AnnotationSuggestion[];
};
