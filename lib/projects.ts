import "server-only";

import { cache } from "react";
import { fetchImageStats, fetchProjectImages, type ImageStats } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import { fetchAllRows } from "@/lib/supabase/rows";
import { createClient } from "@/lib/supabase/server";
import { createProjectThumbnailReadUrl } from "@/lib/uploads/s3-server";
import type { Project, ProjectExportData } from "@/lib/types/projects";

/** The user's projects (RLS-filtered), most recently updated row first. */
const loadProjectRows = cache(async (): Promise<Project[]> => {
  const supabase = await createClient();
  return fetchAllRows<Project>("projects", (count) =>
    supabase
      .from("projects")
      .select("*", count)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true }),
  );
});

export type ProjectSummaries = {
  /** Most recently active first, with image counts and `last_activity_at`. */
  projects: Project[];
  stats: ImageStats;
};

/**
 * Every project with its image counts and latest activity, plus the totals.
 * Uploads and annotation saves never touch `projects.updated_at`, so a
 * project's "Edited" time is the latest of that and its images' `created_at`
 * and `modified_at`. Projects and stats load in parallel, once per request
 * for every page that lists projects.
 */
export const loadProjectSummaries = cache(async (): Promise<ProjectSummaries> => {
  const [rows, stats] = await Promise.all([loadProjectRows(), fetchImageStats()]);
  const projects = rows.map((project) => {
    const projectStats = stats.byProject[project.id];
    const lastActivityMs = Math.max(
      Date.parse(project.updated_at),
      projectStats?.lastActivityMs ?? 0,
    );
    return {
      ...project,
      image_count: projectStats?.total ?? 0,
      annotated_count: projectStats?.annotated ?? 0,
      last_activity_at: Number.isFinite(lastActivityMs)
        ? new Date(lastActivityMs).toISOString()
        : project.updated_at,
    };
  });
  return {
    projects: projects.sort(
      (a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at),
    ),
    stats,
  };
});

/**
 * Thumbnail URLs of the `limit` most recently active projects (null when a
 * project has none). Covering every project starts once the rows arrive,
 * alongside the stats; a shorter list needs the activity order, so it waits
 * for them.
 */
export const loadProjectThumbnails = cache(async (limit: number) => {
  const rows = await loadProjectRows();
  const projects =
    limit >= rows.length
      ? rows
      : (await loadProjectSummaries()).projects.slice(0, limit);
  return new Map(
    await Promise.all(
      projects.map(async (project) =>
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
