import { after } from "next/server";
import {
  annotationJobErrorResponse,
  drainProjectQueue,
  getAnnotationJobProgress,
  requireSignedIn,
} from "@/lib/annotations/jobs";

// A poll may restart the worker drain via after(); give it room to run.
export const maxDuration = 300;

/** Replay window so updates written near the poll boundary are never missed. */
const SINCE_OVERLAP_MS = 5_000;

/**
 * Job progress, plus per-image updates since `?since=`. If the job still has
 * work but no worker holds a live lease (e.g. the previous drain hit its time
 * budget), this poll restarts the drain — progress continues while the
 * project page is open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const since = new URL(request.url).searchParams.get("since");
    const serverTime = new Date(Date.now() - SINCE_OVERLAP_MS).toISOString();

    const supabase = await requireSignedIn();
    const { job, updates, hasLiveWorker, projectId } =
      await getAnnotationJobProgress(
        supabase,
        jobId,
        since && !Number.isNaN(Date.parse(since)) ? since : null,
      );

    const isActive = job.status === "queued" || job.status === "running";
    if (isActive && !hasLiveWorker) {
      after(() => drainProjectQueue(supabase, projectId));
    }

    return Response.json({ job, updates, serverTime });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
