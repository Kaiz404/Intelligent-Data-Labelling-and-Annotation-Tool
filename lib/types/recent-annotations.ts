import type { ProjectImage } from "@/lib/types/projects";

/**
 * An annotated image shown on the cross-project Recent Annotations page. The
 * boxes themselves stay on the server: the page only shows their count.
 */
export type RecentAnnotatedImage = Omit<ProjectImage, "annotations"> & {
  projectId: string;
  projectName: string;
  /** Number of saved bounding boxes (may be 0 when every box was removed). */
  annotationCount: number;
  /** ISO timestamp of the last annotation save; falls back to the upload time. */
  lastAnnotatedAt: string;
};

export type RecentAnnotationsResult = {
  images: RecentAnnotatedImage[];
  /** The query cap; more annotated images exist when `isCapped` is true. */
  limit: number;
  isCapped: boolean;
};
