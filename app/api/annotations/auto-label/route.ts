import {
  canonicalToBoundingBox,
  clampCanonicalToImage,
  fromCenterPixelBox,
} from "@/lib/annotations/formats";
import { detectImage } from "@/lib/roboflow/client";
import { RoboflowError } from "@/lib/roboflow/config";
import {
  createImageReadUrl,
  requireOwnedProject,
  UploadApiError,
} from "@/lib/uploads/s3-server";
import type { BoundingBox } from "@/lib/types/annotations";

class AutoLabelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function errorResponse(error: unknown) {
  if (
    error instanceof UploadApiError ||
    error instanceof RoboflowError ||
    error instanceof AutoLabelError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("AI auto-label API error", error);
  return Response.json({ error: "AI annotation failed." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AutoLabelError("Request body must be a JSON object.", 400);
    }

    const { projectId, imageId, labelIds, confidence } =
      body as Record<string, unknown>;

    if (typeof projectId !== "string" || !projectId) {
      throw new AutoLabelError("projectId is required.", 400);
    }
    if (typeof imageId !== "string" || !imageId) {
      throw new AutoLabelError("imageId is required.", 400);
    }
    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      throw new AutoLabelError("Select at least one label.", 400);
    }
    if (
      confidence !== undefined &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)
    ) {
      throw new AutoLabelError("confidence must be a number between 0 and 1.", 400);
    }

    const { supabase } = await requireOwnedProject(projectId);

    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("id, object_key")
      .eq("id", imageId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (imageError) {
      throw new AutoLabelError("Could not load the image.", 500);
    }
    if (!image) {
      throw new AutoLabelError("Image not found in this project.", 404);
    }

    const { data: labels, error: labelsError } = await supabase
      .from("project_labels")
      .select("id, name")
      .eq("project_id", projectId)
      .in("id", labelIds);

    if (labelsError) {
      throw new AutoLabelError("Could not load labels.", 500);
    }
    if (!labels || labels.length === 0) {
      throw new AutoLabelError(
        "None of the selected labels belong to this project.",
        400,
      );
    }

    const labelIdByName = new Map(
      labels.map((label) => [label.name.trim().toLowerCase(), label.id as string]),
    );

    const imageUrl = await createImageReadUrl(image.object_key);
    const result = await detectImage({
      imageUrl,
      classNames: labels.map((label) => label.name),
      confidence: confidence as number | undefined,
    });

    const boxes: BoundingBox[] = [];
    for (const detection of result.detections) {
      const labelId = labelIdByName.get(detection.className.trim().toLowerCase());
      if (!labelId) {
        // Zero-shot model returned a class we didn't request/recognize — skip it.
        continue;
      }

      const canonical = clampCanonicalToImage(
        fromCenterPixelBox(detection),
        result.image,
      );
      boxes.push(canonicalToBoundingBox(canonical, labelId));
    }

    return Response.json({ boxes });
  } catch (error) {
    return errorResponse(error);
  }
}
