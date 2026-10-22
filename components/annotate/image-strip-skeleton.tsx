import { Skeleton } from "@/components/ui/skeleton";

const PLACEHOLDERS = Array.from({ length: 8 }, (_, index) => index);

export function ImageStripSkeleton() {
  return (
    <div
      className="flex items-center gap-2 rounded-xl border bg-card p-3 shadow-sm"
      aria-hidden="true"
    >
      <div className="grid min-w-0 flex-1 auto-cols-[110px] grid-flow-col gap-3 overflow-hidden px-11 py-1">
        {PLACEHOLDERS.map((index) => (
          <div key={index}>
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="mt-1.5 h-2.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
