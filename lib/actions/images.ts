"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
