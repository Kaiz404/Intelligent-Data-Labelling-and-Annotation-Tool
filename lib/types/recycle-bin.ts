export type RecycleBinItemKind = "project" | "image";

/** A deleted project waiting in the recycle bin. */
export type RecycleBinProject = {
  /** Recycle bin item id — pass this to restore / delete-permanently actions. */
  id: string;
  /** The original project id (restored with the same id). */
  projectId: string;
  name: string;
  description: string | null;
  imageCount: number;
  sizeBytes: number;
  /** ISO timestamp. */
  deletedAt: string;
  /** ISO timestamp after which the item is purged permanently. */
  expiresAt: string;
  /** Project thumbnail, else its first image; short-lived signed URL. */
  thumbnailUrl: string | null;
  /**
   * Permanent deletion started but did not finish (some files may be gone).
   * The item can no longer be restored; deleting it permanently again retries.
   */
  deletionPending: boolean;
};

/**
 * Where a deleted image's project currently is:
 * - `active`: the project exists, so the image can be restored.
 * - `in_bin`: the project is in the recycle bin; restore the project first.
 * - `gone`: the project was permanently deleted (or its permanent deletion
 *   started); the image cannot be restored.
 */
export type RecycleBinProjectState = "active" | "in_bin" | "gone";

/** An individually deleted image waiting in the recycle bin. */
export type RecycleBinImage = {
  /** Recycle bin item id — pass this to restore / delete-permanently actions. */
  id: string;
  /** The original image id (restored with the same id). */
  imageId: string;
  projectId: string;
  projectName: string;
  projectState: RecycleBinProjectState;
  fileName: string;
  sizeBytes: number;
  /** ISO timestamp. */
  deletedAt: string;
  /** ISO timestamp after which the item is purged permanently. */
  expiresAt: string;
  /** Short-lived signed URL for the image object. */
  thumbnailUrl: string | null;
  /**
   * Permanent deletion started but did not finish (its file may be gone).
   * The item can no longer be restored; deleting it permanently again retries.
   */
  deletionPending: boolean;
};

export type RecycleBinContents = {
  /** Newest deletion first. */
  projects: RecycleBinProject[];
  /** Newest deletion first. */
  images: RecycleBinImage[];
  /** ISO timestamp of when the listing was produced (for "expires in N days"). */
  serverNow: string;
};

export type RecycleBinRestoreResult = {
  /** Recycle bin item id that was requested. */
  id: string;
  ok: boolean;
  /** User-facing reason when `ok` is false. */
  error?: string;
  kind?: RecycleBinItemKind;
  /** The restored (or attempted) project id, when known. */
  projectId?: string;
  imageId?: string;
};

export type RecycleBinPermanentDeleteResult = {
  /** Recycle bin rows removed, including dependent image rows of deleted projects. */
  deleted: number;
  /**
   * Items whose stored files (or row) could not be removed. They stay in the
   * bin marked as deletion pending, so they cannot be restored; retry deleting.
   */
  failed: Array<{ id: string; error: string }>;
  /** Requested ids that were no longer in the bin (restored or deleted elsewhere). */
  skipped: string[];
};

/** Expected failures are returned (not thrown) so production builds show the message. */
export type RecycleBinActionFailure = { ok: false; error: string };

export type MoveProjectToRecycleBinResult =
  | { ok: true; itemId: string }
  | RecycleBinActionFailure;

export type MoveImagesToRecycleBinResult =
  | { ok: true; itemIds: string[] }
  | RecycleBinActionFailure;
