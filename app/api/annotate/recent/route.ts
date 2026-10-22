import { connection } from "next/server";
import {
  annotationJobErrorResponse,
  requireSignedIn,
} from "@/lib/annotations/jobs";
import { fetchRecentlyAnnotatedImages } from "@/lib/images";

export async function GET() {
  try {
    await connection();
    await requireSignedIn();
    const recent = await fetchRecentlyAnnotatedImages();
    return Response.json(recent);
  } catch (error) {
    return annotationJobErrorResponse(error);
  }
}
