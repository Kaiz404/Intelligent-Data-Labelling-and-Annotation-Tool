import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS = [0, 1, 2, 3];

/** The project browser's shape (toolbar, card grid) while projects load. */
export function ProjectBrowserSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading projects">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort By:</span>
            <Skeleton className="h-9 w-[140px] rounded-md" />
          </div>
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-9 w-[124px] rounded-md" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {CARDS.map((card) => (
          <Card key={card} className="overflow-hidden py-0 shadow-sm">
            <CardContent className="flex min-h-[262px] flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="size-16 rounded-lg" />
                <div className="flex items-center gap-1">
                  <Skeleton className="size-8 rounded-md" />
                  <Skeleton className="size-8 rounded-md" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-full" />
              </div>
              <div className="mt-auto space-y-3 border-t pt-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-2 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
