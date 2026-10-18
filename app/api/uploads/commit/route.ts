import {
  commitUploadedImages,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  try {
    const { projectId, images } = await commitUploadedImages(await readJson(request));
    revalidatePath(`/projects/${projectId}`);
    return Response.json({ images });
  } catch (error) {
    return errorResponse(error);
  }
}
