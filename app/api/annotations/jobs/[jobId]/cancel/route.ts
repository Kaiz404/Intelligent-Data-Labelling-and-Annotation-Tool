import {
  annotationJobErrorResponse,
  cancelAnnotationJob,
  requireSignedIn,
} from "@/lib/annotations/jobs";

/** Cancel an active run. Images already processed keep their suggestions. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const supabase = await requireSignedIn();
    await cancelAnnotationJob(supabase, jobId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
