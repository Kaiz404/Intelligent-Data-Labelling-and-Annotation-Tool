"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchProjectImages } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import {
  copyImageObject,
  deleteImageObjects,
  deleteProjectThumbnail,
} from "@/lib/uploads/s3-server";
import type { BoundingBox } from "@/lib/types/annotations";
import type { Project } from "@/lib/types/projects";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createProject(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) {
    throw new Error("Project name is required.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to create a project.");
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      name,
      description,
      user_id: user.id,
      starred: false,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

export async function toggleProjectStar(projectId: string, starred: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ starred })
    .eq("id", projectId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  revalidatePath(`/projects/${projectId}`);
}

async function requireOwnedProject(projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("You must be signed in.");

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Could not load the project: ${error.message}`);
  if (!project) throw new Error("Project not found or you do not have access.");
  return { supabase, user, project: project as Project };
}

function cleanProjectDetails(name: string, description?: string | null) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Project name is required.");
  return {
    name: trimmedName,
    description: description?.trim() || null,
  };
}

export async function updateProject(
  projectId: string,
  name: string,
  description?: string | null,
) {
  const details = cleanProjectDetails(name, description);
  const { supabase } = await requireOwnedProject(projectId);
  const { data, error } = await supabase
    .from("projects")
    .update({ ...details, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("*")
    .single();

  if (error) throw new Error(`Could not update the project: ${error.message}`);
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return data as Project;
}

type ImageCopyRow = {
  name: string;
  object_key: string;
  content_type: string | null;
  size_bytes: number;
  annotation: unknown;
};

function remapAnnotation(
  annotation: unknown,
  labelIds: Map<string, string>,
) {
  if (!Array.isArray(annotation)) return annotation;
  return annotation.map((candidate) => {
    if (!candidate || typeof candidate !== "object") return candidate;
    const box = candidate as BoundingBox;
    return { ...box, labelId: labelIds.get(box.labelId) ?? box.labelId };
  });
}

async function copyImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceProjectId: string,
  targetProjectId: string,
  labelIds: Map<string, string>,
  keepAnnotations = true,
) {
  const { data, error } = await supabase
    .from("images")
    .select("name, object_key, content_type, size_bytes, annotation")
    .eq("project_id", sourceProjectId);
  if (error) throw new Error(`Could not load project images: ${error.message}`);

  const createdKeys: string[] = [];
  const createdImageIds: string[] = [];
  try {
    for (const image of (data ?? []) as ImageCopyRow[]) {
      const objectKey = await copyImageObject(
        image.object_key,
        targetProjectId,
        image.name,
      );
      createdKeys.push(objectKey);
      const { data: createdImage, error: insertError } = await supabase
        .from("images")
        .insert({
          project_id: targetProjectId,
          name: image.name,
          object_key: objectKey,
          content_type: image.content_type,
          size_bytes: image.size_bytes,
          annotation: keepAnnotations
            ? remapAnnotation(image.annotation, labelIds)
            : [],
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      createdImageIds.push(createdImage.id);
    }
    return createdKeys;
  } catch (error) {
    if (createdImageIds.length > 0) {
      try {
        await supabase.from("images").delete().in("id", createdImageIds);
      } catch {
        // Preserve the original copy error; S3 cleanup still runs below.
      }
    }
    await deleteImageObjects(createdKeys).catch(() => undefined);
    throw new Error(
      error instanceof Error
        ? `Could not copy project images: ${error.message}`
        : "Could not copy project images.",
    );
  }
}

async function copyLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceProjectId: string,
  targetProjectId: string,
) {
  const [{ data: sourceLabels, error: sourceError }, { data: targetLabels, error: targetError }] =
    await Promise.all([
      supabase
        .from("project_labels")
        .select("id, name, color")
        .eq("project_id", sourceProjectId),
      supabase
        .from("project_labels")
        .select("id, name, color")
        .eq("project_id", targetProjectId),
    ]);
  if (sourceError || targetError) {
    throw new Error("Could not load project labels.");
  }

  const targetByName = new Map(
    (targetLabels ?? []).map((label) => [label.name.toLowerCase(), label]),
  );
  const labelIds = new Map<string, string>();
  for (const label of sourceLabels ?? []) {
    let target = targetByName.get(label.name.toLowerCase());
    if (!target) {
      const { data: created, error } = await supabase
        .from("project_labels")
        .insert({ project_id: targetProjectId, name: label.name, color: label.color })
        .select("id, name, color")
        .single();
      if (error) throw new Error(`Could not copy label ${label.name}: ${error.message}`);
      target = created;
      targetByName.set(label.name.toLowerCase(), created);
    }
    labelIds.set(label.id, target.id);
  }
  return labelIds;
}

export async function duplicateProject(
  sourceProjectId: string,
  name: string,
  description?: string | null,
) {
  const details = cleanProjectDetails(name, description);
  const { supabase, user } = await requireOwnedProject(sourceProjectId);
  const { data: created, error } = await supabase
    .from("projects")
    .insert({ ...details, user_id: user.id, starred: false })
    .select("id")
    .single();
  if (error || !created) throw new Error(`Could not duplicate the project: ${error?.message ?? "Unknown error"}`);

  try {
    const labelIds = await copyLabels(supabase, sourceProjectId, created.id);
    await copyImages(supabase, sourceProjectId, created.id, labelIds);
  } catch (copyError) {
    await supabase.from("projects").delete().eq("id", created.id);
    throw copyError;
  }

  revalidatePath("/dashboard");
  revalidatePath("/projects");
  return { projectId: created.id };
}

export async function copyProjectImages(
  sourceProjectId: string,
  targetProjectId: string,
  keepAnnotations = true,
) {
  if (sourceProjectId === targetProjectId) {
    throw new Error("Choose a different destination project.");
  }
  const { supabase } = await requireOwnedProject(sourceProjectId);
  await requireOwnedProject(targetProjectId);
  const labelIds = keepAnnotations
    ? await copyLabels(supabase, sourceProjectId, targetProjectId)
    : new Map<string, string>();
  const createdKeys = await copyImages(
    supabase,
    sourceProjectId,
    targetProjectId,
    labelIds,
    keepAnnotations,
  );
  await supabase
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", targetProjectId);
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${targetProjectId}`);
  return { copied: createdKeys.length };
}

export async function deleteProject(projectId: string) {
  const { supabase } = await requireOwnedProject(projectId);
  const { data: images, error } = await supabase
    .from("images")
    .select("object_key")
    .eq("project_id", projectId);
  if (error) throw new Error(`Could not load project images: ${error.message}`);

  await deleteImageObjects((images ?? []).map((image) => image.object_key));
  await deleteProjectThumbnail(projectId);
  const { error: imageError } = await supabase
    .from("images")
    .delete()
    .eq("project_id", projectId);
  if (imageError) throw new Error(`Could not delete image records: ${imageError.message}`);
  await supabase.from("project_labels").delete().eq("project_id", projectId);
  const { error: projectError } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);
  if (projectError) throw new Error(`Could not delete the project: ${projectError.message}`);

  revalidatePath("/dashboard");
  revalidatePath("/projects");
}

export async function getProjectExportData(projectId: string) {
  const { project } = await requireOwnedProject(projectId);
  const [images, labels] = await Promise.all([
    fetchProjectImages(projectId),
    fetchProjectLabels(projectId),
  ]);
  return { project, images, labels };
}
