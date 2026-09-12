"use server";

import { createClient } from "@/lib/supabase/server";
import type { BoundingBox } from "@/lib/types/annotations";

const MAX_BOXES_PER_IMAGE = 50_000;

function validateBoxes(value: unknown): BoundingBox[] {
  if (!Array.isArray(value) || value.length > MAX_BOXES_PER_IMAGE) {
    throw new Error("Annotations must be a valid bounding-box list.");
  }

  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("An annotation contains invalid data.");
    }
    const box = candidate as Record<string, unknown>;
    const coordinates = [box.x, box.y, box.width, box.height];
    if (
      typeof box.id !== "string" ||
      !box.id ||
      typeof box.labelId !== "string" ||
      !box.labelId ||
      coordinates.some(
        (coordinate) =>
          typeof coordinate !== "number" || !Number.isFinite(coordinate),
      ) ||
      (box.x as number) < 0 ||
      (box.y as number) < 0 ||
      (box.width as number) <= 0 ||
      (box.height as number) <= 0
    ) {
      throw new Error("An annotation contains invalid bounding-box values.");
    }

    return {
      id: box.id,
      labelId: box.labelId,
      x: box.x as number,
      y: box.y as number,
      width: box.width as number,
      height: box.height as number,
    };
  });
}

export async function saveImageAnnotations(
  projectId: string,
  imageId: string,
  boxesInput: BoundingBox[],
) {
  if (!projectId || !imageId) {
    throw new Error("Project and image are required.");
  }

  const boxes = validateBoxes(boxesInput);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to save annotations.");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Could not verify project access: ${projectError.message}`);
  }
  if (!project) {
    throw new Error("Project not found or you do not have access.");
  }

  const { data: image, error: updateError } = await supabase
    .from("images")
    .update({ annotation: boxes })
    .eq("id", imageId)
    .eq("project_id", projectId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Could not save annotations: ${updateError.message}`);
  }
  if (!image) {
    throw new Error("Image not found or you do not have access.");
  }

  return { savedAt: new Date().toISOString() };
}
