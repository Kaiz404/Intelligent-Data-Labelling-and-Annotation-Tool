import { connection } from "next/server";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, numberFormatter, toPercent } from "@/lib/format";
import { getStorageUsage, type StorageUsage } from "@/lib/storage-usage";

function StorageCard({
  title,
  busy,
  children,
}: {
  title?: string;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      title={title}
      aria-busy={busy || undefined}
      className="rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden"
    >
      {children}
    </div>
  );
}

function sourceDescription({ source, objectCount }: StorageUsage) {
  if (source === "s3") {
    return objectCount === undefined
      ? "Measured from S3"
      : `Measured from S3 (${numberFormatter.format(objectCount)} ${objectCount === 1 ? "object" : "objects"})`;
  }

  return objectCount === undefined
    ? "Estimated from uploaded files"
    : `Estimated from uploaded files (${numberFormatter.format(objectCount)} ${objectCount === 1 ? "image" : "images"})`;
}

/** Placeholder with the same footprint as the loaded widget. */
export function StorageUsageSkeleton() {
  return (
    <StorageCard busy>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Storage used</span>
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
      <Skeleton className="mt-1.5 h-3.5 w-14" />
      <span className="sr-only">Loading storage usage</span>
    </StorageCard>
  );
}

/**
 * Server component: the signed-in user's storage usage for the sidebar
 * footer. Render it inside its own Suspense boundary (see `app/(app)/layout.tsx`)
 * so S3 listing never blocks the rest of the sidebar.
 */
export async function StorageUsageWidget() {
  await connection();

  let usage: StorageUsage | null = null;
  try {
    // Recycle Bin project IDs (objects still in S3) can be passed here.
    usage = await getStorageUsage();
  } catch (error) {
    console.error("[storage-usage] Could not load storage usage", error);
  }

  if (!usage) {
    return (
      <StorageCard title="Storage usage could not be loaded">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Storage used</span>
        </div>
        <Progress value={0} className="mt-2 h-1.5" aria-label="Storage used" />
        <p className="mt-1 text-xs text-muted-foreground">Storage unavailable</p>
      </StorageCard>
    );
  }

  const { usedBytes, quotaBytes } = usage;
  const percent = toPercent(usedBytes, quotaBytes);
  const percentLabel = usedBytes > 0 && percent === 0 ? "<1%" : `${percent}%`;
  const barValue =
    quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  return (
    <StorageCard title={sourceDescription(usage)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Storage used</span>
        <span className="font-medium">
          {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
        </span>
      </div>
      <Progress
        value={barValue}
        className="mt-2 h-1.5"
        aria-label="Storage used"
      />
      <p className="mt-1 text-xs text-muted-foreground">{percentLabel} used</p>
    </StorageCard>
  );
}
