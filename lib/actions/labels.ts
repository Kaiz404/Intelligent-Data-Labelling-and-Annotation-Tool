"use server";

import { revalidatePath } from "next/cache";
import { pickLabelColor } from "@/lib/annotations/label-colors";
import { createClient } from "@/lib/supabase/server";
import type { AnnotationLabel } from "@/lib/types/annotations";

export async function createLabel(
  projectId: string,
  name: string,
): Promise<AnnotationLabel> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Label name is required.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to add a label.");
  }

  const { count } = await supabase
    .from("project_labels")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data, error } = await supabase
    .from("project_labels")
    .insert({
      project_id: projectId,
      name: trimmed,
      color: pickLabelColor(count ?? 0),
    })
    .select("id, name, color")
    .single();

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "A label with this name already exists in this project."
        : error.message,
    );
  }

  revalidatePath(`/projects/${projectId}`);
  return data;
}

export async function deleteLabel(projectId: string, labelId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to delete a label.");
  }

  const { error } = await supabase
    .from("project_labels")
    .delete()
    .eq("id", labelId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}`);
}
