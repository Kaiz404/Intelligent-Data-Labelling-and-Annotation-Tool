"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailPreviewShell } from "@/components/projects/project-detail-preview-shell";
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton";
import { AnnotationWorkspaceRouteLoading } from "@/components/annotate/annotation-workspace-route-loading";
import { isAnnotatePath } from "@/lib/annotations/annotate-path";
import { readProjectPreview } from "@/lib/projects/preview-cache";
import { isUuid } from "@/lib/ids";

/** Route `loading.tsx` fallback: reuse list data for an instant project shell. */
export function ProjectDetailRouteLoading() {
  return (
    <Suspense fallback={<ProjectDetailSkeleton />}>
      <ProjectDetailRouteLoadingContent />
    </Suspense>
  );
}

function ProjectDetailRouteLoadingContent() {
  const pathname = usePathname();
  if (isAnnotatePath(pathname)) {
    return <AnnotationWorkspaceRouteLoading />;
  }
  const projectId = pathname.split("/").at(2) ?? "";
  const preview = isUuid(projectId) ? readProjectPreview(projectId) : undefined;

  if (!preview) {
    return <ProjectDetailSkeleton />;
  }

  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: preview.name },
        ]}
      />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailPreviewShell project={preview} />
      </div>
    </>
  );
}
