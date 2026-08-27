import {
  completeMultipartUpload,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";
import { revalidatePath } from "next/cache";

export async function POST(request: Request) {
  try {
    const result = await completeMultipartUpload(await readJson(request));
    revalidatePath(`/projects/${result.projectId}`);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
