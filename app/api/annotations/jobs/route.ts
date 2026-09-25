import { after } from "next/server";
import {
  AnnotationJobError,
  annotationJobErrorResponse,
  createAnnotationJob,
  drainProjectQueue,
} from "@/lib/annotations/jobs";
import { readJson, requireOwnedProject } from "@/lib/uploads/s3-server";

// The worker drain started with after() keeps running after the response.
export const maxDuration = 300;

/** Queue a bulk AI annotation run: `{ projectId, imageIds, labelIds, confidence }`. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const { imageIds, labelIds, confidence } = body;

    if (
      !Array.isArray(imageIds) ||
      !imageIds.every((id) => typeof id === "string" && id)
    ) {
      throw new AnnotationJobError("imageIds must be a list of image IDs.", 400);
    }
    if (
      !Array.isArray(labelIds) ||
      labelIds.length === 0 ||
      !labelIds.every((id) => typeof id === "string" && id)
    ) {
      throw new AnnotationJobError("Select at least one label.", 400);
    }
    if (
      typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1
    ) {
      throw new AnnotationJobError(
        "confidence must be a number between 0 and 1.",
        400,
      );
    }

    const { projectId, supabase } = await requireOwnedProject(body.projectId);
    const jobId = await createAnnotationJob(supabase, {
      projectId,
      imageIds: imageIds as string[],
      labelIds: labelIds as string[],
      confidence,
    });

    after(() => drainProjectQueue(supabase, projectId));

    return Response.json({ jobId }, { status: 202 });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
