"use server";

import { pickLabelColor, pickLeastUsedLabelColor } from "@/lib/annotations/label-colors";
import { createClient } from "@/lib/supabase/server";
import type { AnnotationLabel } from "@/lib/types/annotations";
import type { DatasetCategory } from "@/lib/types/dataset-import";

/** Resolve source-local category IDs without changing existing label names/colors. */
export async function resolveDatasetLabels(
  projectId: string,
  categories: DatasetCategory[],
): Promise<Array<{ categoryId: string; labelId: string }>> {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("Project is required.");
  }
  if (!Array.isArray(categories)) {
    throw new Error("Dataset categories must be an array.");
  }
  const sourceIds = new Set<string>();
  // Validate the entire batch before creating any labels (server actions are public inputs).
  const normalized = categories.map((category) => {
    if (!category || typeof category.id !== "string" || !category.id.trim() ||
        typeof category.name !== "string" || !category.name.trim()) {
      throw new Error("Each dataset category needs an ID and a non-empty name.");
    }
    if (sourceIds.has(category.id)) {
      throw new Error(`Duplicate dataset category ID: ${category.id}`);
    }
    sourceIds.add(category.id);
    return { id: category.id, name: category.name.trim() };
  });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to import labels.");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (projectError) throw new Error(`Could not verify project access: ${projectError.message}`);
  if (!project) throw new Error("Project not found or you do not have access.");
  if (normalized.length === 0) return [];

  async function loadLabels(): Promise<AnnotationLabel[]> {
    const labels: AnnotationLabel[] = [];
    // Avoid truncating projects with more labels than Supabase's default row limit.
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("project_labels")
        .select("id, name, color")
        .eq("project_id", projectId)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Could not load project labels: ${error.message}`);
      labels.push(...(data ?? []));
      if (!data || data.length < pageSize) return labels;
    }
  }

  const existing = await loadLabels();
  // Same name-to-label lookup and ID remapping pattern as projects.ts copyLabels().
  const byName = new Map(existing.map((label) => [label.name.trim().toLowerCase(), label]));
  let labelCount = existing.length;
  const resolutions: Array<{ categoryId: string; labelId: string }> = [];
  for (const category of normalized) {
    const key = category.name.toLowerCase();
    let label = byName.get(key);
    if (!label) {
      const { data, error } = await supabase.from("project_labels")
        .insert({ project_id: projectId, name: category.name, color: pickLabelColor(labelCount) })
        .select("id, name, color")
        .single();
      if (error?.code === "23505") {
        // Another request may have created the same name since the initial read.
        const refreshed = await loadLabels();
        for (const item of refreshed) byName.set(item.name.trim().toLowerCase(), item);
        labelCount = refreshed.length;
        label = byName.get(key);
      } else if (!error && data) {
        label = data;
        labelCount += 1;
      }
      if (!label) throw new Error(`Could not resolve label "${category.name}": ${error?.message ?? "No label returned."}`);
      byName.set(key, label);
    }
    resolutions.push({ categoryId: category.id, labelId: label.id });
  }
  return resolutions;
}

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

  const { data: existing } = await supabase
    .from("project_labels")
    .select("color")
    .eq("project_id", projectId);

  const { data, error } = await supabase
    .from("project_labels")
    .insert({
      project_id: projectId,
      name: trimmed,
      color: pickLeastUsedLabelColor((existing ?? []).map((label) => label.color)),
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

  return data;
}

export async function renameLabel(
  projectId: string,
  labelId: string,
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
    throw new Error("You must be signed in to rename a label.");
  }

  const { data, error } = await supabase
    .from("project_labels")
    .update({ name: trimmed })
    .eq("id", labelId)
    .eq("project_id", projectId)
    .select("id, name, color")
    .single();

  if (error) {
    throw new Error(
      error.code === "23505"
        ? "A label with this name already exists in this project."
        : error.message,
    );
  }

  return data;
}

/**
 * `ok: false` is an expected refusal (the label is still in use), returned
 * rather than thrown so its message also reaches the client in production.
 */
export type DeleteLabelResult = { ok: true } | { ok: false; error: string };

function countLabel(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export async function deleteLabel(
  projectId: string,
  labelId: string,
): Promise<DeleteLabelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to delete a label.");
  }

  const { data: label, error: labelError } = await supabase
    .from("project_labels")
    .select("id, name")
    .eq("id", labelId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (labelError) {
    throw new Error(`Could not load the label: ${labelError.message}`);
  }
  if (!label) {
    throw new Error("Label not found or you do not have access.");
  }

  // Saved boxes reference labels by ID, and saveImageAnnotations rejects
  // unknown labels: deleting a label in use would break every later save of
  // those images. Find images whose annotation array contains the label.
  const { data: usedImages, error: usageError } = await supabase
    .from("images")
    .select("annotation")
    .eq("project_id", projectId)
    .contains("annotation", JSON.stringify([{ labelId }]));

  if (usageError) {
    throw new Error(`Could not check where the label is used: ${usageError.message}`);
  }

  if (usedImages && usedImages.length > 0) {
    const boxCount = usedImages.reduce((total, image) => {
      const annotation: unknown = image.annotation;
      return (
        total +
        (Array.isArray(annotation)
          ? annotation.filter(
              (box) =>
                typeof box === "object" &&
                box !== null &&
                (box as { labelId?: unknown }).labelId === labelId,
            ).length
          : 0)
      );
    }, 0);
    return {
      ok: false,
      error: `“${label.name}” is used by ${countLabel(boxCount, "box", "boxes")} in ${countLabel(usedImages.length, "image", "images")}. Relabel or delete them first.`,
    };
  }

  const { error } = await supabase
    .from("project_labels")
    .delete()
    .eq("id", labelId)
    .eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  return { ok: true };
}
