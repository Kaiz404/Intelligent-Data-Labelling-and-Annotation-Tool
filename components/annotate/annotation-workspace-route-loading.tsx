"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import { AnnotationWorkspacePending } from "@/components/annotate/annotation-workspace-pending";
import { AnnotationWorkspaceSkeleton } from "@/components/annotate/annotation-workspace-skeleton";
import { annotateImageIdFromPath } from "@/lib/annotations/annotate-path";
import { isUuid } from "@/lib/ids";
import { readProjectPreview } from "@/lib/projects/preview-cache";

export function AnnotationWorkspaceRouteLoading() {
  return (
    <Suspense fallback={<AnnotationWorkspaceSkeleton />}>
      <AnnotationWorkspaceRouteLoadingContent />
    </Suspense>
  );
}

function AnnotationWorkspaceRouteLoadingContent() {
  const pathname = usePathname();
  const segments = pathname.split("/");
  const projectId = segments[2] ?? "";
  const preview = isUuid(projectId) ? readProjectPreview(projectId) : undefined;

  if (!preview) {
    return <AnnotationWorkspaceSkeleton />;
  }

  return (
    <AnnotationWorkspacePending
      project={preview}
      labels={[]}
      images={[]}
      routeImageId={annotateImageIdFromPath(pathname)}
      error={null}
    />
  );
}
