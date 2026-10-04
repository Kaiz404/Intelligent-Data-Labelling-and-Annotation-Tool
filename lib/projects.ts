import "server-only";

import { cache } from "react";
import { fetchImageStats, fetchProjectImages, type ImageStats } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { createProjectThumbnailReadUrl } from "@/lib/uploads/s3-server";
import type { Project, ProjectExportData } from "@/lib/types/projects";

/** The user's projects (RLS-filtered), most recently edited first. */
const loadProjectRows = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return (data ?? []) as Project[];
});

export type ProjectSummaries = {
  /** Most recently edited first, with image and annotated counts. */
  projects: Project[];
  stats: ImageStats;
};

/**
 * Every project with its image counts, plus the totals. Projects and stats
 * load in parallel, once per request for every page that lists projects.
 */
export const loadProjectSummaries = cache(async (): Promise<ProjectSummaries> => {
  const [rows, stats] = await Promise.all([loadProjectRows(), fetchImageStats()]);
  return {
    projects: rows.map((project) => ({
      ...project,
      image_count: stats.byProject[project.id]?.total ?? 0,
      annotated_count: stats.byProject[project.id]?.annotated ?? 0,
    })),
    stats,
  };
});

/**
 * Thumbnail URLs of the `limit` most recently edited projects (null when a
 * project has none). Starts once the rows arrive, alongside the stats.
 */
export const loadProjectThumbnails = cache(async (limit: number) => {
  const rows = await loadProjectRows();
  return new Map(
    await Promise.all(
      rows
        .slice(0, limit)
        .map(async (project) =>
          [project.id, await createProjectThumbnailReadUrl(project.id)] as const,
        ),
    ),
  );
});

/**
 * A project's export data, or null when it is missing or not the user's (RLS
 * returns nothing, so every query runs in parallel with the project lookup).
 */
export async function loadProjectExport(
  projectId: string,
): Promise<ProjectExportData | null> {
  const supabase = await createClient();
  const [projectResult, images, labels] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    fetchProjectImages(projectId),
    fetchProjectLabels(projectId),
  ]);
  if (projectResult.error) {
    throw new Error(`Could not load the project: ${projectResult.error.message}`);
  }
  if (!projectResult.data) return null;
  return { project: projectResult.data as Project, images, labels };
}
