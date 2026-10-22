import { connection } from "next/server";
import {
  annotationJobErrorResponse,
  requireSignedIn,
} from "@/lib/annotations/jobs";
import { fetchProjectImagesSlice } from "@/lib/images";
import { isUuid } from "@/lib/ids";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await connection();
    const { id } = await params;
    if (!isUuid(id)) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    await requireSignedIn();
    const { searchParams } = new URL(request.url);
    const offset = Number.parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = Number.parseInt(searchParams.get("limit") ?? "32", 10);
    const slice = await fetchProjectImagesSlice(id, offset, limit);
    return Response.json(slice);
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
