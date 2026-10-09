import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isThumbhash } from "@/lib/image-placeholder";
import { createClient } from "@/lib/supabase/server";
import { objectKeyFileName } from "@/lib/uploads/object-key";
import {
  MAX_COMMIT_IMAGES,
  SINGLE_REQUEST_UPLOAD_MAX_BYTES,
} from "@/lib/uploads/types";

const MAX_PART_NUMBER = 10_000;
const MAX_PRESIGNED_PARTS = 50;
const UPLOAD_POLICY_SECONDS = 60 * 60;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_FILE_NAME_LENGTH = 255;
// Keeps each lookup's URL well under the request-line limits in front of PostgREST.
const KEY_LOOKUP_CHUNK_SIZE = 25;

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

/**
 * True when `key` is a well-formed image key under `projects/{projectId}/images/`.
 * The database does not constrain `object_key`, so callers that act on a row's
 * key (signing, deleting) should check it against the row's own project.
 */
export function objectKeyBelongsToProject(key: unknown, projectId: string) {
  try {
    return projectIdFromObjectKey(key).projectId === projectId;
  } catch {
    return false;
  }
}

export function createObjectKey(projectId: string, fileName: string) {
  const name = objectKeyFileName(fileName);

  if (!name) {
    throw new UploadApiError("fileName is invalid.", 400);
  }

  return `projects/${projectId}/images/${crypto.randomUUID()}/${name}`;
}

/**
 * One signed S3 POST policy that lets the browser upload any number of small
 * images straight into the project's image folder for an hour, so an image
 * costs a single S3 request and no app request of its own. POST with form
 * data also skips the CORS preflight a presigned PUT needs.
 */
export async function createUploadPolicy(input: Record<string, unknown>) {
  const { projectId } = await requireOwnedProject(input.projectId);
  const { bucket } = getS3Config();
  const keyPrefix = `projects/${projectId}/images/`;
  const { url, fields } = await createPresignedPost(getS3Client(), {
    Bucket: bucket,
    Key: `${keyPrefix}\${filename}`,
    Conditions: [
      ["starts-with", "$Content-Type", "image/"],
      ["content-length-range", 1, SINGLE_REQUEST_UPLOAD_MAX_BYTES],
    ],
    Expires: UPLOAD_POLICY_SECONDS,
  });

  return { url, fields, keyPrefix, expiresInSeconds: UPLOAD_POLICY_SECONDS };
}

type CommitResult = { key: string; imageId: string } | { key: string; error: string };

/**
 * Saves image rows for objects the browser uploaded with the upload policy.
 * Size and type come from S3, not the request, and a key that already has a
 * row returns that row, so a retried request is safe.
 */
export async function commitUploadedImages(input: Record<string, unknown>) {
  const { projectId, supabase } = await requireOwnedProject(input.projectId);

  if (
    !Array.isArray(input.images) ||
    !input.images.length ||
    input.images.length > MAX_COMMIT_IMAGES
  ) {
    throw new UploadApiError(
      `images must list between 1 and ${MAX_COMMIT_IMAGES} uploads.`,
      400,
    );
  }

  const requested = input.images.map((image) => {
    const record = (image ?? {}) as Record<string, unknown>;
    if (typeof record.key !== "string") {
      throw new UploadApiError("Each image needs a key.", 400);
    }
    const name = typeof record.fileName === "string" ? record.fileName.trim() : "";
    return {
      key: record.key,
      name,
      thumbhash: isThumbhash(record.thumbhash) ? record.thumbhash : null,
      error: !objectKeyBelongsToProject(record.key, projectId)
        ? "Invalid upload object key."
        : !name || name.length > MAX_FILE_NAME_LENGTH
          ? "The file name is invalid."
          : null,
    };
  });
  const keys = requested.map((image) => image.key);
  if (new Set(keys).size !== keys.length) {
    throw new UploadApiError("images must not repeat a key.", 400);
  }

  const { bucket } = getS3Config();
  const client = getS3Client();
  const stored = await Promise.all(
    requested.map(async (image): Promise<
      { contentType: string; sizeBytes: number } | { error: string }
    > => {
      if (image.error) return { error: image.error };
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: image.key }),
        );
        const error =
          !head.ContentType || !ALLOWED_CONTENT_TYPES.has(head.ContentType)
            ? "Only JPEG and PNG files are supported."
            : !head.ContentLength
              ? "The uploaded file is empty."
              : null;
        if (error) {
          // Saved images are always JPEG or PNG with bytes, so no row uses this object.
          await client
            .send(new DeleteObjectCommand({ Bucket: bucket, Key: image.key }))
            .catch(() => {});
          return { error };
        }
        return { contentType: head.ContentType!, sizeBytes: head.ContentLength! };
      } catch (error) {
        return {
          error:
            error instanceof Error && error.name === "NotFound"
              ? "The uploaded file was not found."
              : "Could not check the uploaded file.",
        };
      }
    }),
  );

  const rows = requested.flatMap((image, index) => {
    const object = stored[index];
    return "error" in object
      ? []
      : [{
          project_id: projectId,
          name: image.name,
          object_key: image.key,
          content_type: object.contentType,
          size_bytes: object.sizeBytes,
          thumbhash: image.thumbhash,
        }];
  });
  const imageIds = new Map<string, string>();

  if (rows.length) {
    const { data: inserted, error } = await supabase
      .from("images")
      .upsert(rows, { onConflict: "object_key", ignoreDuplicates: true })
      .select("id, object_key");
    if (error) {
      throw new UploadApiError("The uploaded images could not be saved.", 500);
    }
    for (const row of inserted ?? []) imageIds.set(row.object_key, row.id);

    // Rows a previous attempt of this request already saved.
    const existingKeys = rows
      .map((row) => row.object_key)
      .filter((key) => !imageIds.has(key));
    const lookups: string[][] = [];
    for (let start = 0; start < existingKeys.length; start += KEY_LOOKUP_CHUNK_SIZE) {
      lookups.push(existingKeys.slice(start, start + KEY_LOOKUP_CHUNK_SIZE));
    }
    const found = await Promise.all(
      lookups.map((chunk) =>
        supabase
          .from("images")
          .select("id, object_key")
          .eq("project_id", projectId)
          .in("object_key", chunk),
      ),
    );
    for (const { data: existing, error: existingError } of found) {
      if (existingError) {
        throw new UploadApiError("The uploaded images could not be saved.", 500);
      }
      for (const row of existing ?? []) imageIds.set(row.object_key, row.id);
    }
  }

  const images: CommitResult[] = requested.map((image, index) => {
    const object = stored[index];
    if ("error" in object) return { key: image.key, error: object.error };
    const imageId = imageIds.get(image.key);
    return imageId
      ? { key: image.key, imageId }
      : { key: image.key, error: "The uploaded image could not be saved." };
  });

  return { projectId, images };
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
  // Cosmetic and computed by the browser: an invalid hash is dropped, not fatal.
  const thumbhash = isThumbhash(input.thumbhash) ? input.thumbhash : null;

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
      thumbhash,
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

/** Image read URLs are signed per hour-long window (see createImageReadUrl). */
const READ_URL_WINDOW_SECONDS = 60 * 60;

/**
 * Signed GET URL for an image object. Every render within the same hour gets
 * the same URL (signed from the window start), so browsers reuse cached image
 * bytes across navigations and refreshes instead of downloading again. Each
 * URL stays valid for at least an hour; image keys are immutable, so the
 * response may be cached for that long.
 */
export async function createImageReadUrl(key: string) {
  projectIdFromObjectKey(key);
  return signHourlyReadUrl(getS3Client(), key, "inline");
}

function signHourlyReadUrl(client: S3Client, key: string, disposition: string) {
  const { bucket } = getS3Config();
  const windowMs = READ_URL_WINDOW_SECONDS * 1000;

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: disposition,
      ResponseCacheControl: `private, max-age=${READ_URL_WINDOW_SECONDS}, immutable`,
    }),
    {
      expiresIn: 2 * READ_URL_WINDOW_SECONDS,
      signingDate: new Date(Math.floor(Date.now() / windowMs) * windowMs),
    },
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

function projectThumbnailKey(projectId: string) {
  return `projects/${projectId}/thumbnail`;
}

export async function uploadProjectThumbnail(projectId: string, file: File) {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new UploadApiError("Only JPEG and PNG thumbnails are supported.", 400);
  }
  if (file.size <= 0 || file.size > MAX_THUMBNAIL_SIZE_BYTES) {
    throw new UploadApiError("The thumbnail must be between 1 byte and 5 MB.", 400);
  }

  const { bucket } = getS3Config();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: projectThumbnailKey(projectId),
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
    }),
  );

  return createProjectThumbnailReadUrl(projectId);
}

/**
 * Signed URL of the project's thumbnail, or null without one. Hour-stable like
 * image URLs; the thumbnail can be replaced at the same key, so its ETag goes
 * into the signed URL and a new thumbnail gets a new URL.
 */
export async function createProjectThumbnailReadUrl(projectId: string) {
  try {
    const { bucket } = getS3Config();
    const client = getS3Client();
    const key = projectThumbnailKey(projectId);
    const { ETag } = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const version = (ETag ?? "").replace(/\W/g, "");

    return signHourlyReadUrl(client, key, `inline; filename="thumbnail-${version}"`);
  } catch {
    return null;
  }
}

export async function deleteProjectThumbnail(projectId: string) {
  const { bucket } = getS3Config();
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: projectThumbnailKey(projectId) }),
  );
}

export async function copyImageObject(
  sourceKey: string,
  targetProjectId: string,
  fileName: string,
) {
  projectIdFromObjectKey(sourceKey);
  const { bucket } = getS3Config();
  const targetKey = createObjectKey(targetProjectId, fileName);
  const encodedSource = `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`;

  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: targetKey,
      CopySource: encodedSource,
    }),
  );

  return targetKey;
}

export async function deleteImageObjects(keys: string[]) {
  await Promise.all(keys.map((key) => deleteImageObject(key)));
}

const STORAGE_LIST_CONCURRENCY = 4;
const STORAGE_LIST_PAGE_SIZE = 1000;
const STORAGE_LIST_TIMEOUT_MS = 10_000;
const STORAGE_PROJECT_ID_PATTERN = /^[\w-]+$/;

export type ProjectStorageMeasurement = {
  bytes: number;
  objectCount: number;
};

/**
 * Sums the size of every S3 object under `projects/{projectId}/` (images and
 * the optional project thumbnail) for each project ID. Each prefix is listed
 * with paginated ListObjectsV2 calls (1000 keys per page), at most
 * `STORAGE_LIST_CONCURRENCY` prefixes at a time, within an overall timeout.
 * Requires `s3:ListBucket` on the bucket for the `projects/` prefix.
 *
 * Callers must only pass project IDs the signed-in user owns. The first
 * failure aborts every in-flight listing and rejects, so a result is never
 * partial. Parts of incomplete multipart uploads are not counted.
 */
export async function measureProjectStorage(
  projectIds: string[],
): Promise<ProjectStorageMeasurement> {
  const { bucket } = getS3Config();
  const prefixes = [...new Set(projectIds)].map((projectId) => {
    if (!STORAGE_PROJECT_ID_PATTERN.test(projectId)) {
      throw new UploadApiError("Invalid project ID.", 400);
    }
    return `projects/${projectId}/`;
  });
  if (!prefixes.length) return { bytes: 0, objectCount: 0 };

  const client = getS3Client();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, STORAGE_LIST_TIMEOUT_MS);

  let bytes = 0;
  let objectCount = 0;
  let nextPrefix = 0;

  async function listPrefix(prefix: string) {
    let continuationToken: string | undefined;
    do {
      controller.signal.throwIfAborted();
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: STORAGE_LIST_PAGE_SIZE,
          ContinuationToken: continuationToken,
        }),
        { abortSignal: controller.signal },
      );
      for (const object of page.Contents ?? []) {
        bytes += object.Size ?? 0;
        objectCount += 1;
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  async function worker() {
    while (nextPrefix < prefixes.length) {
      controller.signal.throwIfAborted();
      await listPrefix(prefixes[nextPrefix++]);
    }
  }

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(STORAGE_LIST_CONCURRENCY, prefixes.length) },
        worker,
      ),
    );
  } catch (error) {
    controller.abort();
    throw timedOut
      ? new UploadApiError("S3 storage listing timed out.", 504)
      : error;
  } finally {
    clearTimeout(timeout);
  }

  return { bytes, objectCount };
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

/**
 * Deletes an object the browser POSTed but never asked to save, such as a
 * removed or cancelled upload. A key that has a row is a saved image and stays.
 */
export async function discardUploadedObject(input: Record<string, unknown>) {
  const { key, projectId } = projectIdFromObjectKey(input.key);
  const { supabase } = await requireOwnedProject(projectId);
  const { data, error } = await supabase
    .from("images")
    .select("id")
    .eq("object_key", key)
    .limit(1);

  if (error) {
    throw new UploadApiError("Could not check the upload.", 500);
  }
  if (data.length) return;
  await deleteImageObject(key);
}

export function errorResponse(error: unknown) {
  if (error instanceof UploadApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("S3 multipart upload API error", error);
  return Response.json({ error: "Upload operation failed." }, { status: 500 });
}
