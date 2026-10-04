import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

const STRIP_PLACEHOLDERS = Array.from({ length: 8 }, (_, index) => index);

/**
 * The annotation workspace's shape while its project data streams in: shown
 * once per project visit (image switches never show it).
 */
export function AnnotationWorkspaceSkeleton() {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Skeleton className="h-4 w-60" />
      </header>
      <div className="flex-1 p-4 md:p-6" aria-busy="true" aria-label="Loading workspace">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="size-9 rounded-md" />
            </div>
            <Skeleton className="h-10 w-[17rem] rounded-lg" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-44 rounded-lg" />
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-9 w-36 rounded-lg" />
            </div>
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px] xl:items-start">
            <div className="min-w-0 space-y-4">
              <Skeleton className="h-[510px] rounded-xl" />
              <div className="flex items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
                <div className="grid min-w-0 flex-1 auto-cols-[110px] grid-flow-col gap-3 overflow-hidden px-11 py-1">
                  {STRIP_PLACEHOLDERS.map((index) => (
                    <div key={index}>
                      <Skeleton className="h-16 rounded-md" />
                      <Skeleton className="mt-1.5 h-2.5 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-[300px] rounded-xl" />
              </div>
              <Skeleton className="h-48 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
