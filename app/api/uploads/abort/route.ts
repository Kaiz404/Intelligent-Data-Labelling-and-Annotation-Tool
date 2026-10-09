import {
  abortMultipartUpload,
  discardUploadedObject,
  errorResponse,
  readJson,
} from "@/lib/uploads/s3-server";

/** Multipart uploads are aborted; a single-request upload's object is deleted. */
export async function POST(request: Request) {
  try {
    const input = await readJson(request);
    if (input.uploadId === undefined) await discardUploadedObject(input);
    else await abortMultipartUpload(input);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
