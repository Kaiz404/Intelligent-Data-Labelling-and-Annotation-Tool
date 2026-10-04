import "server-only";

import { cache } from "react";
import {
  fetchImageAiStates,
  fetchLatestAnnotationJob,
} from "@/lib/annotations/jobs";
import { fetchProjectImages } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  ImageAiState,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

export type AnnotationWorkspaceData = {
  project: Project;
  images: ProjectImage[];
  labels: AnnotationLabel[];
  /** Most recent bulk AI run, so an active one keeps progressing here. */
  latestJob: AnnotationJobProgress | null;
  /** Latest AI state per image; pending suggestions put an image up for review. */
  aiStates: Record<string, ImageAiState>;
};

/**
 * Everything the annotation workspace needs for one project. The workspace
 * layout loads it once per project visit (image switches stay client-side),
 * and the image page reuses the same request-scoped result to validate its
 * image ID. Null when the project is missing or not the user's (RLS returns
 * nothing, so every query can run in parallel with the project lookup).
 */
export const loadAnnotationWorkspace = cache(
  async (projectId: string): Promise<AnnotationWorkspaceData | null> => {
    const supabase = await createClient();
    const [projectResult, images, labels, latestJob, aiStates] =
      await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
        fetchProjectImages(projectId),
        fetchProjectLabels(projectId),
        fetchLatestAnnotationJob(projectId),
        fetchImageAiStates(projectId),
      ]);

    if (projectResult.error) {
      throw new Error(`Could not load the project: ${projectResult.error.message}`);
    }
    if (!projectResult.data) return null;

    return {
      project: projectResult.data as Project,
      images,
      labels,
      latestJob,
      aiStates,
    };
  },
);
