import "server-only";

import { cache } from "react";
import {
  fetchRecycleBinProjectIds,
  isRecycleBinSchemaMissing,
} from "@/lib/recycle-bin";
import { forEachRowPage } from "@/lib/supabase/rows";
import { createClient } from "@/lib/supabase/server";
import { measureProjectStorage } from "@/lib/uploads/s3-server";

export type StorageUsageSource = "s3" | "database";

export type StorageUsage = {
  usedBytes: number;
  quotaBytes: number;
  /**
   * "s3" = listed from the bucket; "database" = sum of `images.size_bytes`
   * plus the Recycle Bin's `size_bytes` (binned files are still stored).
   */
  source: StorageUsageSource;
  /** S3 objects listed ("s3") or image rows summed ("database"). */
  objectCount?: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const DEFAULT_STORAGE_QUOTA_GB = 100;
const BYTES_PER_GB = 1024 ** 3;

/**
 * `STORAGE_QUOTA_GB` in binary gigabytes (so 100 formats as "100 GB" via
 * `formatBytes`). Falls back to 100 GB when unset, non-numeric, or <= 0.
 */
function getStorageQuotaBytes() {
  const raw = process.env.STORAGE_QUOTA_GB?.trim();
  const gb = raw ? Number(raw) : Number.NaN;
  const quotaGb = Number.isFinite(gb) && gb > 0 ? gb : DEFAULT_STORAGE_QUOTA_GB;
  return Math.round(quotaGb * BYTES_PER_GB);
}

async function fetchOwnedProjectIds(supabase: SupabaseServerClient) {
  const ids: string[] = [];
  await forEachRowPage<{ id: string }>(supabase, "projects", "id", (rows) => {
    for (const row of rows) ids.push(row.id);
  });
  return ids;
}

async function sumImageSizes(supabase: SupabaseServerClient) {
  let bytes = 0;
  let count = 0;
  await forEachRowPage<{ size_bytes: number | string | null }>(
    supabase,
    "images",
    "size_bytes",
    (rows) => {
      for (const row of rows) {
        // bigint columns can arrive as strings; ignore anything non-numeric.
        const size = Number(row.size_bytes);
        if (Number.isFinite(size) && size > 0) bytes += size;
        count += 1;
      }
    },
  );
  return { bytes, count };
}

/**
 * Bytes still held by the user's Recycle Bin items (their S3 objects are kept
 * until permanent deletion). Live images and binned items never overlap, so
 * adding this to `sumImageSizes` does not double count. Zero when the Recycle
 * Bin migration is not applied yet.
 */
async function sumRecycleBinSizes(supabase: SupabaseServerClient) {
  let bytes = 0;
  let count = 0;
  try {
    await forEachRowPage<{ size_bytes: number | string | null; image_count: number | null }>(
      supabase,
      "recycle_bin_items",
      "size_bytes, image_count",
      (rows) => {
        for (const row of rows) {
          const size = Number(row.size_bytes);
          if (Number.isFinite(size) && size > 0) bytes += size;
          count += Number(row.image_count) || 0;
        }
      },
    );
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message: string } }).cause;
    if (!isRecycleBinSchemaMissing(cause)) {
      console.warn("[storage-usage] Could not include Recycle Bin items", error);
    }
    return { bytes: 0, count: 0 };
  }
  return { bytes, count };
}

// Process-wide de-duplication of the fallback warning so a missing
// s3:ListBucket permission logs once rather than on every page load. Holds no
// per-user data.
const loggedS3Failures = new Set<string>();

function warnS3FallbackOnce(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  const key = `${name}:${status ?? ""}`;
  if (loggedS3Failures.has(key)) return;
  loggedS3Failures.add(key);

  console.warn(
    `[storage-usage] S3 listing failed (${name}${status ? `, HTTP ${status}` : ""}); ` +
      "falling back to the sum of images.size_bytes. Measuring from S3 needs " +
      's3:ListBucket on the bucket for the "projects/" prefix. ' +
      "Repeats of this error will not be logged.",
    error instanceof Error ? error.message : error,
  );
}

/**
 * The signed-in user's storage usage, measured once per request (React
 * `cache()`).
 *
 * Lists S3 under `projects/{id}/` for every RLS-visible project plus the
 * projects of Recycle Bin items, whose objects stay in S3 until permanent
 * deletion. If S3 listing fails for any reason, falls back to summing the
 * user's `images.size_bytes` plus Recycle Bin item sizes (source "database",
 * which excludes thumbnails and anything without a row). Throws only when
 * Supabase itself cannot be queried.
 */
export const getStorageUsage = cache(async (): Promise<StorageUsage> => {
  const supabase = await createClient();
  const quotaBytes = getStorageQuotaBytes();
  const [projectIds, binnedProjectIds] = await Promise.all([
    fetchOwnedProjectIds(supabase),
    fetchBinnedProjectIds(),
  ]);

  try {
    const { bytes, objectCount } = await measureProjectStorage([
      ...projectIds,
      ...binnedProjectIds,
    ]);
    return { usedBytes: bytes, quotaBytes, source: "s3", objectCount };
  } catch (error) {
    warnS3FallbackOnce(error);
  }

  const [live, binned] = await Promise.all([
    sumImageSizes(supabase),
    sumRecycleBinSizes(supabase),
  ]);
  return {
    usedBytes: live.bytes + binned.bytes,
    quotaBytes,
    source: "database",
    objectCount: live.count + binned.count,
  };
});

/** Recycle Bin projects still in S3; none if they cannot be loaded. */
async function fetchBinnedProjectIds() {
  try {
    return await fetchRecycleBinProjectIds();
  } catch (error) {
    console.error("[storage-usage] Could not load Recycle Bin projects", error);
    return [];
  }
}
