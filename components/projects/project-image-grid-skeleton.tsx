import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ProjectImageCardSkeleton() {
  return (
    <Card className="overflow-hidden shadow-sm">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <CardContent className="space-y-2 p-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-20 rounded-md" />
        <Skeleton className="h-4 w-40" />
      </CardContent>
    </Card>
  );
}

type ProjectImageGridSkeletonProps = {
  count?: number;
};

export function ProjectImageGridSkeleton({
  count = 8,
}: ProjectImageGridSkeletonProps) {
  const safeCount = Math.max(1, Math.min(count, 12));
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-hidden="true"
    >
      {Array.from({ length: safeCount }, (_, index) => (
        <ProjectImageCardSkeleton key={index} />
      ))}
    </div>
  );
}
