import { connection } from "next/server";
import {
  annotationJobErrorResponse,
  requireSignedIn,
} from "@/lib/annotations/jobs";
import { fetchProjectImage } from "@/lib/images";
import { isUuid } from "@/lib/ids";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  try {
    await connection();
    const { id, imageId } = await params;
    if (!isUuid(id) || !isUuid(imageId)) {
      return Response.json({ error: "Image not found." }, { status: 404 });
    }
    await requireSignedIn();
    const image = await fetchProjectImage(id, imageId);
    if (!image) {
      return Response.json({ error: "Image not found." }, { status: 404 });
    }
    return Response.json({ image });
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
