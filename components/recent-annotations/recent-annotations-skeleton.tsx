import { Skeleton } from "@/components/ui/skeleton";

const CARDS = [0, 1, 2, 3, 4, 5, 6, 7];

/** Recent Annotations' shape (toolbar, image grid) while it loads. */
export function RecentAnnotationsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading recent annotations">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-[180px] rounded-md" />
          <Skeleton className="h-9 w-[190px] rounded-md" />
          <Skeleton className="size-9 rounded-md" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {CARDS.map((card) => (
          <div key={card} className="rounded-xl border bg-card p-2.5 shadow-sm">
            <Skeleton className="aspect-[16/10] rounded-lg" />
            <div className="space-y-2 px-0.5 pb-0.5 pt-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
