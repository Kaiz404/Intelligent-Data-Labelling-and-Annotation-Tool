import { AppHeader } from "@/components/app-shell/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const CARDS = [0, 1, 2, 3, 4, 5, 6, 7];
const FILTERS = [
  { label: "Filter By:", width: "w-[120px]" },
  { label: "Status:", width: "w-[140px]" },
  { label: "Label:", width: "w-[140px]" },
  { label: "Sort By:", width: "w-[140px]" },
];

/** The project page's shape (header, toolbar, image grid) while it loads. */
export function ProjectDetailSkeleton() {
  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: <Skeleton className="h-4 w-28" /> },
        ]}
      />
      <div className="flex-1 p-4 md:p-6" aria-busy="true" aria-label="Loading project">
        <div className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex h-8 items-center gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="size-8 rounded-md" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-[150px] rounded-md" />
              <Skeleton className="h-9 w-[124px] rounded-md" />
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Skeleton className="h-9 flex-1 rounded-md" />
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map(({ label, width }) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <Skeleton className={`h-9 rounded-md ${width}`} />
                </div>
              ))}
              <Skeleton className="size-9 rounded-md" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex h-5 items-center justify-between gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {CARDS.map((card) => (
                <Card key={card} className="overflow-hidden shadow-sm">
                  <Skeleton className="aspect-[4/3] rounded-none" />
                  <CardContent className="space-y-2 p-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-5 w-20 rounded-md" />
                    <Skeleton className="h-4 w-40" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
