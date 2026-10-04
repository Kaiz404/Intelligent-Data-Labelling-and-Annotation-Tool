import { AppHeader } from "@/components/app-shell/app-header";
import { RecentAnnotationsClient } from "@/components/recent-annotations/recent-annotations-client";
import { RecentAnnotationsSkeleton } from "@/components/recent-annotations/recent-annotations-skeleton";
import { fetchRecentlyAnnotatedImages } from "@/lib/images";
import { loadProjectSummaries } from "@/lib/projects";
import { connection } from "next/server";
import { Suspense } from "react";

async function RecentAnnotationsContent() {
  await connection();
  let loaded;
  try {
    // Every owned project is a Move/Add destination, shown with its image count.
    loaded = await Promise.all([
      fetchRecentlyAnnotatedImages(),
      loadProjectSummaries(),
    ]);
  } catch (cause) {
    return (
      <p className="text-sm text-destructive">
        {cause instanceof Error ? cause.message : "Could not load recent annotations."}
      </p>
    );
  }

  const [recent, { projects }] = loaded;
  return (
    <RecentAnnotationsClient
      images={recent.images}
      projects={projects.toSorted((a, b) => a.name.localeCompare(b.name))}
      limit={recent.limit}
      isCapped={recent.isCapped}
      serverNow={Date.now()}
    />
  );
}

export default function AnnotatePage() {
  return (
    <>
      <AppHeader segments={[{ label: "Annotate" }]} />
      <div className="flex-1 space-y-6 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Recent Annotations
          </h1>
          <p className="text-muted-foreground">
            View and manage your latest annotated images across all projects
          </p>
        </div>
        <Suspense fallback={<RecentAnnotationsSkeleton />}>
          <RecentAnnotationsContent />
        </Suspense>
      </div>
    </>
  );
}
