import {
  abortMultipartUpload,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";

export async function POST(request: Request) {
  try {
    await abortMultipartUpload(await readJson(request));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
