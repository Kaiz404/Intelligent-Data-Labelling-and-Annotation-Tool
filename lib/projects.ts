import "server-only";

import { fetchProjectImages } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import type { Project, ProjectExportData } from "@/lib/types/projects";

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
