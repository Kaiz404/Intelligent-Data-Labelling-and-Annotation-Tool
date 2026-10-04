import "server-only";

import { isUuid } from "@/lib/ids";
import { createClient } from "@/lib/supabase/server";
import {
  createImageReadUrl,
  createProjectThumbnailReadUrl,
  deleteImageObject,
  deleteProjectThumbnail,
  objectKeyBelongsToProject,
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
 * deletion lives here because it must remove S3 objects. It first claims rows
 * by setting `purge_started_at`, which makes them unrestorable, and only then
 * touches S3, so a partly deleted item can never be restored.
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
  itemDeleting: "RB008",
  itemExpired: "RB009",
} as const;

export const RECYCLE_BIN_MIGRATION = "20261004120000_add_recycle_bin.sql";

export const RECYCLE_BIN_SETUP_MESSAGE = `The Recycle Bin isn't set up yet, so nothing was changed. Apply the database migration ${RECYCLE_BIN_MIGRATION} (npx supabase db push) and try again.`;

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

export { isUuid };

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

/** A cookie-bound Supabase client plus the signed-in user's id. */
export type RecycleBinSession = {
  supabase: SupabaseServerClient;
  userId: string;
};

/**
 * Creates the session once so it can be reused, including inside `after()`
 * callbacks of Server Components, which cannot read cookies themselves.
 */
export async function getRecycleBinSession(): Promise<RecycleBinSession> {
  const supabase = await createClient();
  const user = await requireRecycleBinUser(supabase);
  return { supabase, userId: user.id };
}

const PAGE_SIZE = 1000;
// Keeps `.in(...)` filters well inside PostgREST URL limits, and bounds the
// rows a single claim (UPDATE ... RETURNING) hands back.
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

async function signObjectKey(key: string | null, projectId: string) {
  if (!key || !objectKeyBelongsToProject(key, projectId)) return null;
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

// The ThumbHashes come from the snapshot JSON: the image's own (kind = image)
// and the first image's (kind = project, whose cover is its first image).
const LIST_COLUMNS =
  "id, kind, project_id, image_id, name, project_name, description, image_count, size_bytes, cover_object_key, deleted_at, expires_at, purge_started_at, thumbhash:snapshot->image->>thumbhash, cover_thumbhash:snapshot->images->0->>thumbhash";

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
  purge_started_at: string | null;
  thumbhash?: string | null;
  cover_thumbhash?: string | null;
};

/**
 * The signed-in user's recycle bin, newest deletion first. Expired items are
 * hidden even before {@link purgeExpiredRecycleBinItems} removes them. RLS
 * scopes the rows, so callers can check the session alongside this.
 * Throws {@link RecycleBinUnavailableError} if the migration is not applied.
 */
export async function fetchRecycleBin(
  session?: Pick<RecycleBinSession, "supabase">,
): Promise<RecycleBinContents> {
  const supabase = session?.supabase ?? (await createClient());
  const serverNow = new Date().toISOString();

  const rows = await selectAllPages<RecycleBinListRow>(
    "Could not load the recycle bin",
    (from, to) =>
      supabase
        .from("recycle_bin_items")
        .select(LIST_COLUMNS)
        .gt("expires_at", serverNow)
        .order("deleted_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
  );

  const projectRows = rows.filter((row) => row.kind === "project");
  const imageRows = rows.filter((row) => row.kind === "image");
  // A project whose permanent deletion started can never come back, so its
  // images are treated like images of a deleted project.
  const restorableProjectIds = new Set(
    projectRows.filter((row) => !row.purge_started_at).map((row) => row.project_id),
  );
  const binnedProjectIds = new Set(projectRows.map((row) => row.project_id));

  const [activeProjectIds, projectCovers, imageUrls] = await Promise.all([
    findExistingIds(
      supabase,
      "projects",
      imageRows
        .map((row) => row.project_id)
        .filter((projectId) => !binnedProjectIds.has(projectId)),
    ),
    Promise.all(
      projectRows.map(async (row) => {
        const thumbnailUrl = await createProjectThumbnailReadUrl(row.project_id);
        return thumbnailUrl
          ? { thumbnailUrl, thumbhash: null }
          : {
              thumbnailUrl: await signObjectKey(row.cover_object_key, row.project_id),
              thumbhash: row.cover_thumbhash ?? null,
            };
      }),
    ),
    Promise.all(
      imageRows.map((row) => signObjectKey(row.cover_object_key, row.project_id)),
    ),
  ]);

  function projectState(projectId: string): RecycleBinProjectState {
    if (activeProjectIds.has(projectId)) return "active";
    if (restorableProjectIds.has(projectId)) return "in_bin";
    return "gone";
  }

  const projects = projectRows.map(
    (row, index): RecycleBinProject => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      imageCount: Number(row.image_count),
      sizeBytes: Number(row.size_bytes),
      deletedAt: toIsoString(row.deleted_at),
      expiresAt: toIsoString(row.expires_at),
      ...projectCovers[index],
      deletionPending: row.purge_started_at !== null,
    }),
  );
  const images = imageRows.map(
    (row, index): RecycleBinImage => ({
      id: row.id,
      imageId: row.image_id ?? "",
      projectId: row.project_id,
      projectName: row.project_name,
      projectState: projectState(row.project_id),
      fileName: row.name,
      sizeBytes: Number(row.size_bytes),
      deletedAt: toIsoString(row.deleted_at),
      expiresAt: toIsoString(row.expires_at),
      thumbnailUrl: imageUrls[index],
      thumbhash: row.thumbhash ?? null,
      deletionPending: row.purge_started_at !== null,
    }),
  );

  return { projects, images, serverNow };
}

/**
 * Distinct original project ids of the signed-in user's bin items (RLS
 * filtered). Their S3 objects still exist, so storage usage should include
 * them. Returns an empty list when the migration is not applied yet.
 */
export async function fetchRecycleBinProjectIds(): Promise<string[]> {
  const supabase = await createClient();
  let rows: Array<{ project_id: string }>;
  try {
    rows = await selectAllPages<{ project_id: string }>(
      "Could not load recycle bin projects",
      (from, to) =>
        supabase
          .from("recycle_bin_items")
          .select("project_id")
          .order("id", { ascending: true })
          .range(from, to),
    );
  } catch (error) {
    if (error instanceof RecycleBinUnavailableError) return [];
    throw error;
  }
  return [...new Set(rows.map((row) => row.project_id))];
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

const DELETION_COLUMNS = "id, kind, project_id, image_id, object_keys";

type DeletionRow = {
  id: string;
  kind: RecycleBinItemKind;
  project_id: string;
  image_id: string | null;
  object_keys: string[] | null;
};

/**
 * Marks rows as being permanently deleted (`purge_started_at`) and returns
 * the rows actually claimed. From here on `restore_recycle_bin_item` refuses
 * them, and a restore that won the race has already removed the row, so it is
 * simply not returned. Re-claiming a row whose earlier deletion failed is how
 * deletion is retried.
 */
async function claimForDeletion(
  supabase: SupabaseServerClient,
  userId: string,
  itemIds: string[],
): Promise<DeletionRow[]> {
  const claimedAt = new Date().toISOString();
  const claimed: DeletionRow[] = [];
  for (const ids of chunk(itemIds.filter(isUuid), ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("recycle_bin_items")
      .update({ purge_started_at: claimedAt })
      .eq("user_id", userId)
      .in("id", ids)
      .select(DELETION_COLUMNS);
    if (error) throw queryError("Could not prepare items for deletion", error);
    claimed.push(...((data ?? []) as DeletionRow[]));
  }
  return claimed;
}

/**
 * Only keys under the item's own project prefix are deleted. Every app-created
 * key has that shape; anything else is left alone rather than risk removing
 * another project's object.
 */
function ownedObjectKeys(row: DeletionRow) {
  const keys = row.object_keys ?? [];
  const owned = keys.filter((key) => objectKeyBelongsToProject(key, row.project_id));
  if (owned.length !== keys.length) {
    console.warn(
      `Recycle bin item ${row.id}: skipped ${keys.length - owned.length} S3 key(s) outside projects/${row.project_id}/images/.`,
    );
  }
  return owned;
}

/**
 * Deletes every owned key of `rows` (S3_DELETE_BATCH_SIZE at a time) and
 * returns the first failure per row id. One bad key fails only its own row.
 */
async function deleteObjectsByRow(rows: DeletionRow[]) {
  const tasks = rows.flatMap((row) =>
    ownedObjectKeys(row).map((key) => ({ rowId: row.id, key })),
  );
  const failures = new Map<string, unknown>();
  for (const batch of chunk(tasks, S3_DELETE_BATCH_SIZE)) {
    const results = await Promise.allSettled(
      batch.map((task) => deleteImageObject(task.key)),
    );
    results.forEach((result, index) => {
      const { rowId } = batch[index];
      if (result.status === "rejected" && !failures.has(rowId)) {
        failures.set(rowId, result.reason);
      }
    });
  }
  return failures;
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

/** Ids of image rows left behind by projects that no longer exist anywhere. */
async function selectOrphanedImageRowIds(
  supabase: SupabaseServerClient,
  userId: string,
  projectIds: string[],
) {
  const ids: string[] = [];
  for (const batch of chunk(projectIds, ID_CHUNK_SIZE)) {
    const rows = await selectAllPages<{ id: string }>(
      "Could not load recycle bin images",
      (from, to) =>
        supabase
          .from("recycle_bin_items")
          .select("id")
          .eq("user_id", userId)
          .eq("kind", "image")
          .in("project_id", batch)
          .order("id", { ascending: true })
          .range(from, to),
    );
    ids.push(...rows.map((row) => row.id));
  }
  return ids;
}

const RETRY_MESSAGE =
  "Permanent deletion didn't finish. The item can't be restored any more; delete it permanently again to retry.";

/**
 * Permanently deletes recycle bin items for `session`'s user:
 * 1. claim the rows (`purge_started_at`), so they can no longer be restored;
 * 2. delete their S3 objects, tracking success per row (and the thumbnail
 *    for projects);
 * 3. delete only the rows whose objects were all removed.
 * Rows that fail stay claimed (unrestorable) and are reported in `failed`;
 * deleting them again retries. Deleting a project also deletes its image
 * rows still in the bin, since they share its S3 prefix and can never be
 * restored. Requested ids that could not be claimed (restored or deleted
 * elsewhere, unknown) are returned in `skipped`.
 */
export async function permanentlyDeleteRecycleBinItems(
  session: RecycleBinSession,
  itemIds: string[],
): Promise<RecycleBinPermanentDeleteResult> {
  const { supabase, userId } = session;
  const requested = uniqueIds(itemIds);
  const claimed = await claimForDeletion(supabase, userId, requested);
  const claimedIds = new Set(claimed.map((row) => row.id));
  const skipped = requested.filter((id) => !claimedIds.has(id));

  const failed: RecycleBinPermanentDeleteResult["failed"] = [];
  let loggedUnexpected = false;
  function fail(id: string, error: unknown) {
    if (error instanceof UploadApiError || error instanceof RecycleBinUnavailableError) {
      failed.push({ id, error: error.message });
      return;
    }
    if (!loggedUnexpected) {
      loggedUnexpected = true;
      console.error("Recycle bin permanent deletion failed", error);
    }
    failed.push({ id, error: RETRY_MESSAGE });
  }

  let deleted = 0;
  const deletedProjectIds: string[] = [];
  for (const row of claimed.filter((item) => item.kind === "project")) {
    const failures = await deleteObjectsByRow([row]);
    if (failures.has(row.id)) {
      fail(row.id, failures.get(row.id));
      continue;
    }
    try {
      await deleteProjectThumbnail(row.project_id);
      deleted += await deleteRows(supabase, userId, [row.id]);
      deletedProjectIds.push(row.project_id);
    } catch (error) {
      fail(row.id, error);
    }
  }

  const dependentIds = (
    await selectOrphanedImageRowIds(supabase, userId, deletedProjectIds)
  ).filter((id) => !claimedIds.has(id));
  const imageRows = [
    ...claimed.filter((item) => item.kind === "image"),
    ...(await claimForDeletion(supabase, userId, dependentIds)),
  ];

  for (const batch of chunk(imageRows, S3_DELETE_BATCH_SIZE)) {
    const failures = await deleteObjectsByRow(batch);
    const cleared: string[] = [];
    for (const row of batch) {
      if (failures.has(row.id)) fail(row.id, failures.get(row.id));
      else cleared.push(row.id);
    }
    if (cleared.length === 0) continue;
    try {
      deleted += await deleteRows(supabase, userId, cleared);
    } catch (error) {
      for (const id of cleared) fail(id, error);
    }
  }

  return { deleted, failed, skipped };
}

/**
 * Permanently deletes the signed-in user's items past their 30-day retention,
 * through the same claim path as {@link permanentlyDeleteRecycleBinItems}.
 * Returns how many recycle bin rows were removed; per-item failures are
 * logged and retried on the next purge. Throws
 * {@link RecycleBinUnavailableError} if the migration is not applied.
 */
export async function purgeExpiredRecycleBinItems(
  session?: RecycleBinSession,
): Promise<number> {
  const resolved = session ?? (await getRecycleBinSession());
  const now = new Date().toISOString();

  const rows = await selectAllPages<{ id: string }>(
    "Could not load expired recycle bin items",
    (from, to) =>
      resolved.supabase
        .from("recycle_bin_items")
        .select("id")
        .eq("user_id", resolved.userId)
        .lt("expires_at", now)
        .order("id", { ascending: true })
        .range(from, to),
  );
  if (rows.length === 0) return 0;

  const { deleted, failed } = await permanentlyDeleteRecycleBinItems(
    resolved,
    rows.map((row) => row.id),
  );
  if (failed.length > 0) {
    console.error(
      `Recycle bin purge: ${failed.length} expired item(s) could not be deleted`,
      failed,
    );
  }
  return deleted;
}
