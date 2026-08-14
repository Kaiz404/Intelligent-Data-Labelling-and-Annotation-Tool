import {
  createMultipartUpload,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return Response.json(await createMultipartUpload(await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
