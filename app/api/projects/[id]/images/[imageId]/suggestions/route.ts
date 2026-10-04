import {
  annotationJobErrorResponse,
  fetchPendingSuggestions,
  requireSignedIn,
} from "@/lib/annotations/jobs";

/**
 * Unreviewed bulk-AI suggestions for one image. The annotation workspace
 * loads (and prefetches) these per image as the user switches images, so a
 * switch never re-renders the workspace on the server. RLS scopes the rows to
 * the user's own projects.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  try {
    const { id, imageId } = await params;
    await requireSignedIn();
    const suggestionSets = await fetchPendingSuggestions(id, imageId);
    return Response.json({ suggestionSets });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
