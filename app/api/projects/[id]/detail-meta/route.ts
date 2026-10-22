import { connection } from "next/server";
import {
  annotationJobErrorResponse,
  fetchImageAiStates,
  fetchLatestAnnotationJob,
  requireSignedIn,
} from "@/lib/annotations/jobs";
import { isUuid } from "@/lib/ids";
import { fetchProjectLabels } from "@/lib/labels";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connection();
    const { id } = await params;
    if (!isUuid(id)) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    await requireSignedIn();
    const [labels, latestJob, aiStates] = await Promise.all([
      fetchProjectLabels(id),
      fetchLatestAnnotationJob(id),
      fetchImageAiStates(id),
    ]);
    return Response.json({ labels, latestJob, aiStates });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
