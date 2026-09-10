import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AnnotationLabel } from "@/lib/types/annotations";

export async function fetchProjectLabels(
  projectId: string,
): Promise<AnnotationLabel[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_labels")
    .select("id, name, color")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load project labels: ${error.message}`);
  }

  return data ?? [];
}
