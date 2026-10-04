import { Skeleton } from "@/components/ui/skeleton";

const ROWS = [0, 1, 2];

/** The Recycle Bin's shape (tabs, toolbar, project rows) while it loads. */
export function RecycleBinSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading the Recycle Bin">
      <div className="space-y-5">
        <div className="flex border-b">
          <div className="px-5 pb-2.5 pt-1.5">
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="px-5 pb-2.5 pt-1.5">
            <Skeleton className="h-5 w-24" />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-[190px] rounded-md" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          </div>

          <div className="space-y-3">
            {ROWS.map((row) => (
              <div
                key={row}
                className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className="p-1">
                    <Skeleton className="size-4 rounded-[4px]" />
                  </div>
                  <Skeleton className="size-16 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-3.5 w-56" />
                    <Skeleton className="h-3.5 w-72 max-w-full" />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 pl-10 sm:items-end sm:pl-0">
                  <Skeleton className="h-3.5 w-20" />
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-24 rounded-md" />
                    <Skeleton className="h-8 w-40 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
