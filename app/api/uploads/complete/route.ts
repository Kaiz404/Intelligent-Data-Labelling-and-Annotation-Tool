import {
  completeMultipartUpload,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";

export async function POST(request: Request) {
  try {
    return Response.json(await completeMultipartUpload(await readJson(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
