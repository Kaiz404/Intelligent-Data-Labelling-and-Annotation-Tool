"use server";

import { revalidatePath } from "next/cache";
import {
  deleteRecycleBinRowsPermanently,
  isRecycleBinSchemaMissing,
  isUuid,
  RECYCLE_BIN_DELETION_COLUMNS,
  RECYCLE_BIN_SETUP_MESSAGE,
  RECYCLE_BIN_SQLSTATE,
  RecycleBinUnavailableError,
  requireRecycleBinUser,
  selectRecycleBinRowsById,
  uniqueIds,
  type RecycleBinDeletionRow,
} from "@/lib/recycle-bin";
import { createClient } from "@/lib/supabase/server";
import type {
  RecycleBinItemKind,
  RecycleBinPermanentDeleteResult,
  RecycleBinRestoreResult,
} from "@/lib/types/recycle-bin";

type RpcError = { code?: string; message: string };

const PROJECT_NOT_FOUND = "Project not found or you do not have access.";
const IMAGES_NOT_FOUND = "One or more selected images could not be found.";
const ITEM_NOT_FOUND = "This item is no longer in the recycle bin.";
const PROJECT_GONE =
  "The project was permanently deleted, so this image can't be restored.";

/** Pages that list live projects/images, plus the bin itself. */
function revalidateAfterChange(projectIds: Iterable<string>) {
  revalidatePath("/dashboard");
  revalidatePath("/projects");
  revalidatePath("/annotate");
  revalidatePath("/recycle-bin");
  for (const projectId of new Set(projectIds)) {
    // "layout" also covers /projects/[id]/annotate/[imageId].
    revalidatePath(`/projects/${projectId}`, "layout");
  }
}

function moveErrorMessage(error: RpcError, fallback: string) {
  if (isRecycleBinSchemaMissing(error)) return RECYCLE_BIN_SETUP_MESSAGE;
  switch (error.code) {
    case RECYCLE_BIN_SQLSTATE.notAuthenticated:
      return "You must be signed in.";
    case RECYCLE_BIN_SQLSTATE.projectNotFound:
      return PROJECT_NOT_FOUND;
    case RECYCLE_BIN_SQLSTATE.imagesNotFound:
      return IMAGES_NOT_FOUND;
    default:
      return `${fallback}: ${error.message}`;
  }
}

/**
 * Moves an owned project (its labels and images) into the recycle bin. The
 * S3 objects are kept until the item is deleted permanently or expires.
 */
export async function moveProjectToRecycleBin(
  projectId: string,
): Promise<{ itemId: string }> {
  if (!isUuid(projectId)) throw new Error(PROJECT_NOT_FOUND);

  const supabase = await createClient();
  await requireRecycleBinUser(supabase, "You must be signed in to delete a project.");

  const { data, error } = await supabase.rpc("move_project_to_recycle_bin", {
    p_project_id: projectId,
  });
  if (error) {
    throw new Error(
      moveErrorMessage(error, "Could not move the project to the recycle bin"),
    );
  }

  revalidateAfterChange([projectId]);
  return { itemId: String(data) };
}

/**
 * Moves images of one owned project into the recycle bin (one bin item per
 * image). All-or-nothing: fails without changes if any id is not an image of
 * that project.
 */
export async function moveImagesToRecycleBin(
  projectId: string,
  imageIds: string[],
): Promise<{ itemIds: string[] }> {
  if (!isUuid(projectId)) throw new Error(PROJECT_NOT_FOUND);
  const ids = uniqueIds(imageIds);
  if (ids.length === 0) throw new Error("Select at least one image.");
  if (!ids.every(isUuid)) throw new Error(IMAGES_NOT_FOUND);

  const supabase = await createClient();
  await requireRecycleBinUser(supabase, "You must be signed in to delete images.");

  const { data, error } = await supabase.rpc("move_images_to_recycle_bin", {
    p_project_id: projectId,
    p_image_ids: ids,
  });
  if (error) {
    throw new Error(
      moveErrorMessage(error, "Could not move the images to the recycle bin"),
    );
  }

  revalidateAfterChange([projectId]);
  return { itemIds: Array.isArray(data) ? data.map(String) : [] };
}

type RestoreRow = {
  id: string;
  kind: RecycleBinItemKind;
  project_id: string;
  image_id: string | null;
  name: string;
  project_name: string;
};

function restoreErrorMessage(error: RpcError, row: RestoreRow) {
  switch (error.code) {
    case RECYCLE_BIN_SQLSTATE.itemNotFound:
      return ITEM_NOT_FOUND;
    case RECYCLE_BIN_SQLSTATE.projectInRecycleBin:
      return `Restore the project “${row.project_name}” first.`;
    case RECYCLE_BIN_SQLSTATE.projectNotFound:
    case "23503": // the project vanished between the check and the insert
      return row.kind === "image"
        ? PROJECT_GONE
        : `Could not restore “${row.name}”: ${error.message}`;
    case RECYCLE_BIN_SQLSTATE.restoreConflict:
      return row.kind === "project"
        ? `A project with the same ID already exists, so “${row.name}” can't be restored.`
        : `“${row.name}” is already back in “${row.project_name}”.`;
    case RECYCLE_BIN_SQLSTATE.snapshotInvalid:
      return `“${row.name}” can't be restored because its saved copy is incomplete.`;
    case RECYCLE_BIN_SQLSTATE.notAuthenticated:
      return "You must be signed in to restore items.";
    case "23505":
      return `“${row.name}” conflicts with something created since it was deleted. Try again.`;
    case "42501":
      return "You do not have permission to restore this item.";
    default:
      return `Could not restore “${row.name}”: ${error.message}`;
  }
}

// Each restore is its own transaction; label recreation is race-safe in SQL.
const RESTORE_CONCURRENCY = 4;

/**
 * Restores recycle bin items and reports a result per id (in the order
 * given). Projects are restored first, one at a time, so an image selected
 * together with its deleted project comes back too; images then restore a
 * few at a time.
 */
export async function restoreRecycleBinItems(
  itemIds: string[],
): Promise<RecycleBinRestoreResult[]> {
  const ids = uniqueIds(itemIds);
  if (ids.length === 0) throw new Error("Select at least one item to restore.");

  const supabase = await createClient();
  const user = await requireRecycleBinUser(
    supabase,
    "You must be signed in to restore items.",
  );
  const rows = await selectRecycleBinRowsById<RestoreRow>(
    supabase,
    user.id,
    ids,
    "id, kind, project_id, image_id, name, project_name",
  );
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const results = new Map<string, RecycleBinRestoreResult>();
  const restoredProjectIds = new Set<string>();
  let schemaMissing = false;

  async function restore(row: RestoreRow) {
    const details = {
      kind: row.kind,
      projectId: row.project_id,
      ...(row.image_id ? { imageId: row.image_id } : {}),
    };
    const { error } = await supabase.rpc("restore_recycle_bin_item", {
      p_item_id: row.id,
    });
    if (error) {
      if (isRecycleBinSchemaMissing(error)) schemaMissing = true;
      results.set(row.id, {
        id: row.id,
        ok: false,
        error: restoreErrorMessage(error, row),
        ...details,
      });
      return;
    }
    restoredProjectIds.add(row.project_id);
    results.set(row.id, { id: row.id, ok: true, ...details });
  }

  const found = ids.flatMap((id) => rowsById.get(id) ?? []);
  for (const row of found.filter((item) => item.kind === "project")) {
    await restore(row);
  }
  const images = found.filter((item) => item.kind === "image");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(RESTORE_CONCURRENCY, images.length) }, async () => {
      while (next < images.length) await restore(images[next++]);
    }),
  );

  if (restoredProjectIds.size > 0) revalidateAfterChange(restoredProjectIds);
  if (schemaMissing) throw new RecycleBinUnavailableError();
  return ids.map(
    (id) => results.get(id) ?? { id, ok: false, error: ITEM_NOT_FOUND },
  );
}

/**
 * Permanently deletes recycle bin items: their S3 objects first, then the
 * rows. Deleting a project also removes any of its images still in the bin.
 * Unknown ids are ignored; storage failures are reported per item and leave
 * the item in the bin for a retry.
 */
export async function deleteRecycleBinItemsPermanently(
  itemIds: string[],
): Promise<RecycleBinPermanentDeleteResult> {
  const ids = uniqueIds(itemIds);
  if (ids.length === 0) throw new Error("Select at least one item to delete.");

  const supabase = await createClient();
  const user = await requireRecycleBinUser(
    supabase,
    "You must be signed in to delete items.",
  );
  const rows = await selectRecycleBinRowsById<RecycleBinDeletionRow>(
    supabase,
    user.id,
    ids,
    RECYCLE_BIN_DELETION_COLUMNS,
  );
  const result =
    rows.length > 0
      ? await deleteRecycleBinRowsPermanently(supabase, user.id, rows)
      : { deleted: 0, failed: [] };

  revalidatePath("/recycle-bin");
  return result;
}
