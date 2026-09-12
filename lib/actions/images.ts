"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteImageObject } from "@/lib/uploads/s3-server";

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
