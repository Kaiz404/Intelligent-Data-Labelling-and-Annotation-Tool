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
