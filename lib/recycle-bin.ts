import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  createImageReadUrl,
  createProjectThumbnailReadUrl,
  deleteImageObjects,
  deleteProjectThumbnail,
  projectIdFromObjectKey,
  UploadApiError,
} from "@/lib/uploads/s3-server";
import type {
  RecycleBinContents,
  RecycleBinImage,
  RecycleBinItemKind,
  RecycleBinPermanentDeleteResult,
  RecycleBinProject,
  RecycleBinProjectState,
} from "@/lib/types/recycle-bin";

/*
 * Recycle bin data access. Moving to / restoring from the bin happens in SQL
 * (supabase/migrations/20261004120000_add_recycle_bin.sql); permanent
 * deletion lives here because it must remove S3 objects first.
 *
 * Nothing in this module calls revalidatePath, so the read/purge helpers are
 * safe to call while rendering a Server Component.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message: string };
type QueryResult<T> = { data: T[] | null; error: DbError | null };

export const RECYCLE_BIN_RETENTION_DAYS = 30;

/** SQLSTATEs raised by the recycle bin SQL functions (see the migration header). */
export const RECYCLE_BIN_SQLSTATE = {
  notAuthenticated: "RB001",
  projectNotFound: "RB002",
  imagesNotFound: "RB003",
  itemNotFound: "RB004",
  projectInRecycleBin: "RB005",
  restoreConflict: "RB006",
  snapshotInvalid: "RB007",
} as const;

export const RECYCLE_BIN_SETUP_MESSAGE =
  "The recycle bin is not set up yet. Apply the Supabase migration 20261004120000_add_recycle_bin.sql.";

/** Thrown when the recycle bin table or functions do not exist yet. */
export class RecycleBinUnavailableError extends Error {
  constructor() {
    super(RECYCLE_BIN_SETUP_MESSAGE);
    this.name = "RecycleBinUnavailableError";
  }
}

// PostgREST reports objects missing from its schema cache as PGRST205 (table)
// and PGRST202 (function); Postgres itself uses 42P01 / 42883.
const MISSING_SCHEMA_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

export function isRecycleBinSchemaMissing(error: DbError | null | undefined) {
  return (
    !!error &&
    MISSING_SCHEMA_CODES.has(error.code ?? "") &&
    /recycle_bin/i.test(error.message)
  );
}

function queryError(context: string, error: DbError) {
  return isRecycleBinSchemaMissing(error)
    ? new RecycleBinUnavailableError()
    : new Error(`${context}: ${error.message}`);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Dedupes string ids (keeping order); non-string entries are dropped. */
export function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

export async function requireRecycleBinUser(
  supabase: SupabaseServerClient,
  message = "You must be signed in.",
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error(message);
  return user;
}

const PAGE_SIZE = 1000;
// Keeps `.in(...)` filters well inside PostgREST URL limits.
const ID_CHUNK_SIZE = 100;
// Concurrent single-object S3 deletes per round, and image rows per DB delete.
const S3_DELETE_BATCH_SIZE = 50;

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/** Reads every page of a query (Supabase caps a single response at 1000 rows). */
async function selectAllPages<T>(
  context: string,
  page: (from: number, to: number) => PromiseLike<QueryResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw queryError(context, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/** The subset of `ids` that currently exist in `table` (RLS-filtered). */
async function findExistingIds(
  supabase: SupabaseServerClient,
  table: "projects" | "images",
  ids: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const batch of chunk([...new Set(ids)], ID_CHUNK_SIZE)) {
    const { data, error } = await supabase.from(table).select("id").in("id", batch);
    if (error) throw new Error(`Could not check ${table}: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string }>) existing.add(row.id);
  }
  return existing;
}

/** True when `key` is a well-formed image key under `projects/{projectId}/images/`. */
function keyBelongsToProject(key: string, projectId: string) {
  try {
    return projectIdFromObjectKey(key).projectId === projectId;
  } catch {
    return false;
  }
}

async function signObjectKey(key: string | null, projectId: string) {
  if (!key || !keyBelongsToProject(key, projectId)) return null;
  try {
    return await createImageReadUrl(key);
  } catch {
    return null;
  }
}

function toIsoString(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

const LIST_COLUMNS =
  "id, kind, project_id, image_id, name, project_name, description, image_count, size_bytes, cover_object_key, deleted_at, expires_at";

type RecycleBinListRow = {
  id: string;
  kind: RecycleBinItemKind;
  project_id: string;
  image_id: string | null;
  name: string;
  project_name: string;
  description: string | null;
  image_count: number;
  size_bytes: number | string;
  cover_object_key: string | null;
  deleted_at: string;
  expires_at: string;
};

/**
 * The signed-in user's recycle bin, newest deletion first. Expired items are
 * hidden even before {@link purgeExpiredRecycleBinItems} removes them.
 * Throws {@link RecycleBinUnavailableError} if the migration is not applied.
 */
export async function fetchRecycleBin(): Promise<RecycleBinContents> {
  const supabase = await createClient();
  const user = await requireRecycleBinUser(supabase);
  const serverNow = new Date().toISOString();

  const rows = await selectAllPages<RecycleBinListRow>(
    "Could not load the recycle bin",
    (from, to) =>
      supabase
        .from("recycle_bin_items")
        .select(LIST_COLUMNS)
        .eq("user_id", user.id)
        .gt("expires_at", serverNow)
        .order("deleted_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
  );

  const projectRows = rows.filter((row) => row.kind === "project");
  const imageRows = rows.filter((row) => row.kind === "image");
  const binnedProjectIds = new Set(projectRows.map((row) => row.project_id));
  const activeProjectIds = await findExistingIds(
    supabase,
    "projects",
    imageRows
      .map((row) => row.project_id)
      .filter((projectId) => !binnedProjectIds.has(projectId)),
  );

  function projectState(projectId: string): RecycleBinProjectState {
    if (activeProjectIds.has(projectId)) return "active";
    if (binnedProjectIds.has(projectId)) return "in_bin";
    return "gone";
  }

  const [projects, images] = await Promise.all([
    Promise.all(
      projectRows.map(
        async (row): Promise<RecycleBinProject> => ({
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          description: row.description,
          imageCount: Number(row.image_count),
          sizeBytes: Number(row.size_bytes),
          deletedAt: toIsoString(row.deleted_at),
          expiresAt: toIsoString(row.expires_at),
          thumbnailUrl:
            (await createProjectThumbnailReadUrl(row.project_id)) ??
            (await signObjectKey(row.cover_object_key, row.project_id)),
        }),
      ),
    ),
    Promise.all(
      imageRows.map(
        async (row): Promise<RecycleBinImage> => ({
          id: row.id,
          imageId: row.image_id ?? "",
          projectId: row.project_id,
          projectName: row.project_name,
          projectState: projectState(row.project_id),
          fileName: row.name,
          sizeBytes: Number(row.size_bytes),
          deletedAt: toIsoString(row.deleted_at),
          expiresAt: toIsoString(row.expires_at),
          thumbnailUrl: await signObjectKey(row.cover_object_key, row.project_id),
        }),
      ),
    ),
  ]);

  return { projects, images, serverNow };
}

// ---------------------------------------------------------------------------
// Row lookup shared with lib/actions/recycle-bin.ts
// ---------------------------------------------------------------------------

/** Loads the user's recycle bin rows with the given ids; unknown ids are skipped. */
export async function selectRecycleBinRowsById<T>(
  supabase: SupabaseServerClient,
  userId: string,
  itemIds: string[],
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (const ids of chunk(itemIds.filter(isUuid), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("recycle_bin_items")
      .select(columns)
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw queryError("Could not load recycle bin items", error);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Permanent deletion
// ---------------------------------------------------------------------------

export const RECYCLE_BIN_DELETION_COLUMNS = "id, kind, project_id, image_id, object_keys";

export type RecycleBinDeletionRow = {
  id: string;
  kind: RecycleBinItemKind;
  project_id: string;
  image_id: string | null;
  object_keys: string[] | null;
};

/**
 * Only keys under the item's own project prefix are deleted. Every app-created
 * key has that shape; anything else is left alone rather than risk removing
 * another project's object.
 */
function ownedObjectKeys(row: RecycleBinDeletionRow) {
  const keys = row.object_keys ?? [];
  const owned = keys.filter((key) => keyBelongsToProject(key, row.project_id));
  if (owned.length !== keys.length) {
    console.warn(
      `Recycle bin item ${row.id}: skipped ${keys.length - owned.length} S3 key(s) outside projects/${row.project_id}/images/.`,
    );
  }
  return owned;
}

async function deleteObjectsInBatches(keys: string[]) {
  for (const batch of chunk(keys, S3_DELETE_BATCH_SIZE)) {
    await deleteImageObjects(batch);
  }
}

async function deleteRows(
  supabase: SupabaseServerClient,
  userId: string,
  itemIds: string[],
) {
  let deleted = 0;
  for (const ids of chunk(itemIds, ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("recycle_bin_items")
      .delete()
      .eq("user_id", userId)
      .in("id", ids)
      .select("id");
    if (error) throw queryError("Could not remove recycle bin items", error);
    deleted += data?.length ?? 0;
  }
  return deleted;
}

/** Image rows left behind by projects that no longer exist anywhere. */
async function selectOrphanedImageRows(
  supabase: SupabaseServerClient,
  userId: string,
  projectIds: string[],
) {
  const rows: RecycleBinDeletionRow[] = [];
  for (const ids of chunk(projectIds, ID_CHUNK_SIZE)) {
    rows.push(
      ...(await selectAllPages<RecycleBinDeletionRow>(
        "Could not load recycle bin images",
        (from, to) =>
          supabase
            .from("recycle_bin_items")
            .select(RECYCLE_BIN_DELETION_COLUMNS)
            .eq("user_id", userId)
            .eq("kind", "image")
            .in("project_id", ids)
            .order("id", { ascending: true })
            .range(from, to),
      )),
    );
  }
  return rows;
}

function storageErrorMessage(error: unknown) {
  if (error instanceof UploadApiError || error instanceof RecycleBinUnavailableError) {
    return error.message;
  }
  console.error("Recycle bin permanent deletion failed", error);
  return "Could not delete the stored files. The item is still in the recycle bin; try again.";
}

/**
 * Permanently deletes recycle bin rows: S3 objects first (so a failure leaves
 * a retryable row), then the rows. Deleting a project also deletes any image
 * rows from that project, since their files share its S3 prefix and they can
 * never be restored. Rows whose project/image is live again (a concurrent
 * restore) are skipped and their files kept.
 *
 * Failures are reported per item instead of thrown; items whose files were
 * partly removed stay in the bin so the deletion can be retried.
 */
export async function deleteRecycleBinRowsPermanently(
  supabase: SupabaseServerClient,
  userId: string,
  rows: RecycleBinDeletionRow[],
): Promise<RecycleBinPermanentDeleteResult> {
  const failed: RecycleBinPermanentDeleteResult["failed"] = [];
  let deleted = 0;
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];

  const projectRows = unique.filter((row) => row.kind === "project");
  const liveProjectIds = await findExistingIds(
    supabase,
    "projects",
    projectRows.map((row) => row.project_id),
  );
  const deletedProjectIds: string[] = [];
  for (const row of projectRows) {
    if (liveProjectIds.has(row.project_id)) continue;
    try {
      await deleteObjectsInBatches(ownedObjectKeys(row));
      await deleteProjectThumbnail(row.project_id);
      deleted += await deleteRows(supabase, userId, [row.id]);
      deletedProjectIds.push(row.project_id);
    } catch (error) {
      failed.push({ id: row.id, error: storageErrorMessage(error) });
    }
  }

  const imageRowsById = new Map<string, RecycleBinDeletionRow>();
  for (const row of unique) {
    if (row.kind === "image") imageRowsById.set(row.id, row);
  }
  for (const row of await selectOrphanedImageRows(supabase, userId, deletedProjectIds)) {
    imageRowsById.set(row.id, row);
  }
  const imageRows = [...imageRowsById.values()];
  const liveImageIds = await findExistingIds(
    supabase,
    "images",
    imageRows.flatMap((row) => (row.image_id ? [row.image_id] : [])),
  );

  for (const batch of chunk(
    imageRows.filter((row) => !row.image_id || !liveImageIds.has(row.image_id)),
    S3_DELETE_BATCH_SIZE,
  )) {
    try {
      await deleteObjectsInBatches(batch.flatMap(ownedObjectKeys));
      deleted += await deleteRows(supabase, userId, batch.map((row) => row.id));
    } catch (error) {
      const message = storageErrorMessage(error);
      for (const row of batch) failed.push({ id: row.id, error: message });
    }
  }

  return { deleted, failed };
}

/**
 * Permanently deletes the signed-in user's items past their 30-day retention.
 * Returns how many recycle bin rows were removed; per-item storage failures
 * are logged and retried on the next purge. Throws
 * {@link RecycleBinUnavailableError} if the migration is not applied.
 */
export async function purgeExpiredRecycleBinItems(): Promise<number> {
  const supabase = await createClient();
  const user = await requireRecycleBinUser(supabase);
  const now = new Date().toISOString();

  const rows = await selectAllPages<RecycleBinDeletionRow>(
    "Could not load expired recycle bin items",
    (from, to) =>
      supabase
        .from("recycle_bin_items")
        .select(RECYCLE_BIN_DELETION_COLUMNS)
        .eq("user_id", user.id)
        .lt("expires_at", now)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (rows.length === 0) return 0;

  const { deleted, failed } = await deleteRecycleBinRowsPermanently(
    supabase,
    user.id,
    rows,
  );
  if (failed.length > 0) {
    console.error(
      `Recycle bin purge: ${failed.length} expired item(s) could not be deleted`,
      failed,
    );
  }
  return deleted;
}
