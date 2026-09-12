import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";

const MAX_PART_NUMBER = 10_000;
const MAX_PRESIGNED_PARTS = 50;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

export class UploadApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function getS3Config() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new UploadApiError(
      "S3 uploads are not configured. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.",
      503,
    );
  }

  return { region, bucket, accessKeyId, secretAccessKey };
}

function getS3Client() {
  const { region, accessKeyId, secretAccessKey } = getS3Config();
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new UploadApiError(`${name} is required.`, 400);
  }

  return value.trim();
}

function validatePartNumber(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_PART_NUMBER) {
    throw new UploadApiError(
      `Part numbers must be integers between 1 and ${MAX_PART_NUMBER}.`,
      400,
    );
  }

  return value as number;
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UploadApiError("Request body must be a JSON object.", 400);
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UploadApiError) throw error;
    throw new UploadApiError("Request body must be valid JSON.", 400);
  }
}

export async function requireOwnedProject(projectId: unknown) {
  const id = requireString(projectId, "projectId");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new UploadApiError("You must be signed in.", 401);
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new UploadApiError("Could not verify project access.", 500);
  }
  if (!project) {
    throw new UploadApiError("Project not found.", 404);
  }

  return { projectId: id, userId: user.id, supabase };
}

export function projectIdFromObjectKey(key: unknown) {
  const value = requireString(key, "key");
  const match = /^projects\/([^/]+)\/images\/[0-9a-f-]{36}\/[\w. -]+$/i.exec(value);

  if (!match) {
    throw new UploadApiError("Invalid upload object key.", 400);
  }

  return { key: value, projectId: match[1] };
}

export function createObjectKey(projectId: string, fileName: string) {
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitizedName || sanitizedName === "." || sanitizedName === "..") {
    throw new UploadApiError("fileName is invalid.", 400);
  }

  return `projects/${projectId}/images/${crypto.randomUUID()}/${sanitizedName}`;
}

export async function createMultipartUpload(input: Record<string, unknown>) {
  const { projectId } = await requireOwnedProject(input.projectId);
  const fileName = requireString(input.fileName, "fileName");
  const contentType = requireString(input.contentType, "contentType");
  const sizeBytes = input.sizeBytes;

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new UploadApiError("Only JPEG and PNG files are supported.", 400);
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    throw new UploadApiError("sizeBytes must be between 1 byte and 15 GB.", 400);
  }

  const { bucket } = getS3Config();
  const key = createObjectKey(projectId, fileName);
  const result = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
  );

  if (!result.UploadId) {
    throw new UploadApiError("S3 did not return an upload ID.", 502);
  }

  return { uploadId: result.UploadId, key };
}

export async function presignParts(input: Record<string, unknown>) {
  const { key, projectId } = projectIdFromObjectKey(input.key);
  await requireOwnedProject(projectId);
  const uploadId = requireString(input.uploadId, "uploadId");

  if (!Array.isArray(input.partNumbers) || !input.partNumbers.length) {
    throw new UploadApiError("partNumbers must be a non-empty array.", 400);
  }
  if (input.partNumbers.length > MAX_PRESIGNED_PARTS) {
    throw new UploadApiError(
      `A maximum of ${MAX_PRESIGNED_PARTS} parts can be presigned at once.`,
      400,
    );
  }

  const partNumbers = input.partNumbers.map(validatePartNumber);
  if (new Set(partNumbers).size !== partNumbers.length) {
    throw new UploadApiError("partNumbers must not contain duplicates.", 400);
  }

  const { bucket } = getS3Config();
  const client = getS3Client();
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: 15 * 60 },
      ),
    })),
  );

  return { parts };
}

export async function completeMultipartUpload(input: Record<string, unknown>) {
  const { key, projectId } = projectIdFromObjectKey(input.key);
  const { supabase } = await requireOwnedProject(projectId);
  const uploadId = requireString(input.uploadId, "uploadId");
  const fileName = requireString(input.fileName, "fileName");
  const contentType = requireString(input.contentType, "contentType");
  const sizeBytes = input.sizeBytes;

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new UploadApiError("Only JPEG and PNG files are supported.", 400);
  }
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    throw new UploadApiError("sizeBytes must be between 1 byte and 15 GB.", 400);
  }
  if (!Array.isArray(input.parts) || !input.parts.length) {
    throw new UploadApiError("parts must be a non-empty array.", 400);
  }

  const parts = input.parts.map((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      throw new UploadApiError("Each part must be an object.", 400);
    }
    const record = part as Record<string, unknown>;
    return {
      PartNumber: validatePartNumber(record.partNumber),
      ETag: requireString(record.eTag, "eTag"),
    };
  });

  if (
    parts.length > MAX_PART_NUMBER ||
    new Set(parts.map((part) => part.PartNumber)).size !== parts.length
  ) {
    throw new UploadApiError("parts must have unique part numbers.", 400);
  }

  parts.sort((a, b) => a.PartNumber - b.PartNumber);
  const { bucket } = getS3Config();
  const client = getS3Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );

  const { data: image, error } = await supabase
    .from("images")
    .insert({
      project_id: projectId,
      name: fileName,
      object_key: key,
      content_type: contentType,
      size_bytes: sizeBytes,
    })
    .select("id")
    .single();

  if (error || !image) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (cleanupError) {
      console.error("Could not remove orphaned S3 object", cleanupError);
    }
    throw new UploadApiError(
      "The upload completed, but its image record could not be saved.",
      500,
    );
  }

  return { key, imageId: image.id, projectId };
}

export async function createImageReadUrl(key: string) {
  projectIdFromObjectKey(key);
  const { bucket } = getS3Config();

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: 60 * 60 },
  );
}

export async function deleteImageObject(key: string) {
  projectIdFromObjectKey(key);
  const { bucket } = getS3Config();

  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function abortMultipartUpload(input: Record<string, unknown>) {
  const { key, projectId } = projectIdFromObjectKey(input.key);
  await requireOwnedProject(projectId);
  const uploadId = requireString(input.uploadId, "uploadId");
  const { bucket } = getS3Config();

  await getS3Client().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    }),
  );
}

export function errorResponse(error: unknown) {
  if (error instanceof UploadApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("S3 multipart upload API error", error);
  return Response.json({ error: "Upload operation failed." }, { status: 500 });
}
