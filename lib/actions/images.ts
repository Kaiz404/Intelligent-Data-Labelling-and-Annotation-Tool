"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteImageObject } from "@/lib/uploads/s3-server";
import { deleteImageObjects } from "@/lib/uploads/s3-server";

async function requireOwnedImages(projectId: string, imageIds: string[]) {
  const uniqueIds = [...new Set(imageIds)];
  if (uniqueIds.length === 0) throw new Error("Select at least one image.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!project) throw new Error("Project not found or you do not have access.");

  const { data: images, error } = await supabase
    .from("images")
    .select("id, object_key")
    .eq("project_id", projectId)
    .in("id", uniqueIds);
  if (error || (images?.length ?? 0) !== uniqueIds.length) {
    throw new Error("One or more selected images could not be found.");
  }
  return { supabase, images: images ?? [], uniqueIds };
}

export async function renameProjectImage(
  imageId: string,
  projectId: string,
  fileName: string,
) {
  const name = fileName.trim();
  if (!name) throw new Error("Image name is required.");
  const { supabase } = await requireOwnedImages(projectId, [imageId]);
  const { error } = await supabase
    .from("images")
    .update({ name })
    .eq("id", imageId)
    .eq("project_id", projectId);
  if (error) throw new Error(`Could not rename the image: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/dashboard");
}

export async function deleteProjectImages(imageIds: string[], projectId: string) {
  const { supabase, images, uniqueIds } = await requireOwnedImages(
    projectId,
    imageIds,
  );
  await deleteImageObjects(images.map((image) => image.object_key));
  const { error } = await supabase
    .from("images")
    .delete()
    .eq("project_id", projectId)
    .in("id", uniqueIds);
  if (error) throw new Error(`Could not remove the image records: ${error.message}`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}

export async function deleteProjectImage(imageId: string, projectId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to delete an image.");
  }

  const { data: image, error: findError } = await supabase
    .from("images")
    .select("id, object_key, project_id")
    .eq("id", imageId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (findError) {
    throw new Error(`Could not verify the image: ${findError.message}`);
  }
  if (!image) {
    throw new Error("Image not found or you do not have access.");
  }

  await deleteImageObject(image.object_key);

  const { error: deleteError } = await supabase
    .from("images")
    .delete()
    .eq("id", imageId)
    .eq("project_id", projectId);

  if (deleteError) {
    throw new Error(`Could not remove the image record: ${deleteError.message}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/dashboard");
}
