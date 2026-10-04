"use server";

import { fetchAllRows } from "@/lib/supabase/rows";
import { createClient } from "@/lib/supabase/server";
import { copyImageObject, deleteImageObject } from "@/lib/uploads/s3-server";
import type { BoundingBox } from "@/lib/types/annotations";
import type { Project, ToggleProjectStarResult } from "@/lib/types/projects";
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

/**
 * Stars or unstars an owned project. Starring is not an edit, so
 * `updated_at` stays put. Failures are returned as `{ ok: false, error }`
 * because production builds mask thrown server-action messages.
 */
export async function toggleProjectStar(
  projectId: string,
  starred: boolean,
): Promise<ToggleProjectStarResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const { data, error } = await supabase
    .from("projects")
    .update({ starred })
    .eq("id", projectId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: `Could not update the favourite: ${error.message}` };
  }
  if (!data) {
    return { ok: false, error: "Project not found or you do not have access." };
  }

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return { ok: true };
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

/**
 * Image ids per `.in()` filter: the ids travel in the request URL, so a long
 * selection (e.g. "Select all") is split to keep URLs short and every
 * response under the PostgREST row cap.
 */
const ID_CHUNK_SIZE = 200;

function chunk<T>(items: T[], size = ID_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Deletes rows by id, chunk by chunk; true only when every chunk succeeded. */
async function deleteImageRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  imageIds: string[],
) {
  let ok = true;
  for (const ids of chunk(imageIds)) {
    const { error } = await supabase
      .from("images")
      .delete()
      .eq("project_id", projectId)
      .in("id", ids);
    if (error) ok = false;
  }
  return ok;
}

/** How many of `imageIds` exist in the project, or null if that could not be checked. */
async function countImageRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  imageIds: string[],
) {
  let total = 0;
  for (const ids of chunk(imageIds)) {
    const { data, error } = await supabase
      .from("images")
      .select("id")
      .eq("project_id", projectId)
      .in("id", ids);
    if (error) return null;
    total += data?.length ?? 0;
  }
  return total;
}

const IMAGE_COPY_COLUMNS =
  "id, created_at, name, object_key, content_type, size_bytes, annotation, thumbhash";

type ImageCopyRow = {
  id: string;
  created_at: string;
  name: string;
  object_key: string;
  content_type: string | null;
  size_bytes: number;
  annotation: unknown;
  thumbhash: string | null;
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

/**
 * Removes S3 objects that no image row references any more. Failures only
 * leave orphaned objects behind, so they are logged instead of thrown.
 */
async function deleteUnreferencedObjects(keys: string[]) {
  const results = await Promise.allSettled(keys.map((key) => deleteImageObject(key)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Could not delete orphaned S3 object ${keys[index]}`, result.reason);
    }
  });
}

/**
 * Copies image objects and inserts their destination rows. The source is never
 * modified, so on failure the partial copy is rolled back without risking data.
 */
async function copyImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceProjectId: string,
  targetProjectId: string,
  labelIds: Map<string, string>,
  keepAnnotations = true,
  imageIds?: string[],
) {
  // Every image (paged past the row cap), or the selected ones (chunked),
  // copied in upload order.
  let data: ImageCopyRow[];
  if (imageIds) {
    const results = await Promise.all(
      chunk([...new Set(imageIds)]).map((ids) =>
        supabase
          .from("images")
          .select(IMAGE_COPY_COLUMNS)
          .eq("project_id", sourceProjectId)
          .in("id", ids),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(`Could not load project images: ${failed.error.message}`);
    data = results
      .flatMap((result) => (result.data ?? []) as ImageCopyRow[])
      .sort(
        (a, b) =>
          Date.parse(a.created_at) - Date.parse(b.created_at) ||
          a.id.localeCompare(b.id),
      );
    if (data.length !== new Set(imageIds).size) {
      throw new Error("One or more selected images could not be found.");
    }
  } else {
    data = await fetchAllRows<ImageCopyRow>("project images", (count) =>
      supabase
        .from("images")
        .select(IMAGE_COPY_COLUMNS, count)
        .eq("project_id", sourceProjectId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    );
  }

  const createdKeys: string[] = [];
  const createdImageIds: string[] = [];
  try {
    for (const image of data) {
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
          thumbhash: image.thumbhash,
          // A raw copy is unannotated (null), not "annotated with zero boxes".
          annotation: keepAnnotations
            ? remapAnnotation(image.annotation, labelIds)
            : null,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      createdImageIds.push(createdImage.id);
    }
    return { createdKeys, createdImageIds };
  } catch (error) {
    let rowsRemoved = createdImageIds.length === 0;
    if (!rowsRemoved) {
      try {
        rowsRemoved = await deleteImageRows(supabase, targetProjectId, createdImageIds);
      } catch {
        // Preserve the original copy error.
      }
    }
    // createdKeys[i] belongs to createdImageIds[i]; a trailing key has no row.
    // Keep objects whose rows survived so those rows never point at nothing.
    await deleteUnreferencedObjects(
      rowsRemoved ? createdKeys : createdKeys.slice(createdImageIds.length),
    );
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
  const { createdKeys } = await copyImages(
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

/**
 * Second half of a move, after the destination copies exist: delete the source
 * rows, then their S3 objects. Destination copies are rolled back only when
 * the source is verifiably untouched; once any source row may be gone, every
 * copy is kept so an image can never be lost (a duplicate or an orphaned
 * object is the worst case).
 */
async function removeMovedSourceImages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceProjectId: string,
  targetProjectId: string,
  imageIds: string[],
  createdKeys: string[],
  createdImageIds: string[],
) {
  // In chunks (see ID_CHUNK_SIZE). Only a failure on the first chunk can
  // leave the source untouched, so only then can the copies be undone.
  const deletedRows: Array<{ object_key: string }> = [];
  for (const [index, ids] of chunk(imageIds).entries()) {
    const { data, error: deleteError } = await supabase
      .from("images")
      .delete()
      .eq("project_id", sourceProjectId)
      .in("id", ids)
      .select("id, object_key");

    if (deleteError) {
      // A failed response can still mean the delete committed, so look before undoing.
      if (
        index === 0 &&
        (await countImageRows(supabase, sourceProjectId, imageIds)) === imageIds.length &&
        (await deleteImageRows(supabase, targetProjectId, createdImageIds))
      ) {
        await deleteUnreferencedObjects(createdKeys);
        throw new Error(
          `Images could not be moved, so nothing was changed: ${deleteError.message}`,
        );
      }
      // Rows deleted by earlier chunks are gone: their objects are unreferenced.
      await deleteUnreferencedObjects(deletedRows.map((row) => row.object_key));
      throw new Error(
        `Images were copied, but removing them from the source project may not have finished (${deleteError.message}). No images were lost; check both projects before retrying.`,
      );
    }
    deletedRows.push(...((data ?? []) as Array<{ object_key: string }>));
  }

  // Rows are gone, so source objects are unreferenced: delete best-effort.
  await deleteUnreferencedObjects(deletedRows.map((row) => row.object_key));
}

export async function transferProjectImages(
  sourceProjectId: string,
  targetProjectId: string,
  imageIds: string[],
  mode: "copy" | "move",
  keepAnnotations = true,
) {
  const uniqueImageIds = [...new Set(imageIds)];
  if (uniqueImageIds.length === 0) throw new Error("Select at least one image.");
  if (mode === "move" && sourceProjectId === targetProjectId) {
    throw new Error("Choose a different destination project when moving images.");
  }

  const { supabase } = await requireOwnedProject(sourceProjectId);
  await requireOwnedProject(targetProjectId);

  if ((await countImageRows(supabase, sourceProjectId, uniqueImageIds)) !== uniqueImageIds.length) {
    throw new Error("One or more selected images could not be loaded.");
  }

  const labelIds = keepAnnotations
    ? await copyLabels(supabase, sourceProjectId, targetProjectId)
    : new Map<string, string>();
  // Step 1: copy objects and insert destination rows (rolled back on failure).
  const { createdKeys, createdImageIds } = await copyImages(
    supabase,
    sourceProjectId,
    targetProjectId,
    labelIds,
    keepAnnotations,
    uniqueImageIds,
  );

  if (mode === "move") {
    await removeMovedSourceImages(
      supabase,
      sourceProjectId,
      targetProjectId,
      uniqueImageIds,
      createdKeys,
      createdImageIds,
    );
  }

  await Promise.all([
    supabase
      .from("projects")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sourceProjectId),
    supabase
      .from("projects")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", targetProjectId),
  ]);
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath(`/projects/${sourceProjectId}`);
  revalidatePath(`/projects/${targetProjectId}`);
  return { transferred: createdKeys.length };
}
