import { AppHeader } from "@/components/app-shell/app-header";
import { RecentAnnotationsClient } from "@/components/recent-annotations/recent-annotations-client";
import { fetchImageStats, fetchRecentlyAnnotatedImages } from "@/lib/images";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types/projects";
import { connection } from "next/server";
import { Suspense } from "react";

async function RecentAnnotationsContent() {
  await connection();
  const supabase = await createClient();

  try {
    const [recent, { data: projectRows, error }] = await Promise.all([
      fetchRecentlyAnnotatedImages(),
      supabase.from("projects").select("*").order("name", { ascending: true }),
    ]);
    if (error) throw new Error(`Could not load projects: ${error.message}`);

    // Every owned project is a Move/Add destination, shown with its image count.
    const destinations = (projectRows ?? []) as Project[];
    const stats = await fetchImageStats(destinations.map((project) => project.id));
    const projects = destinations.map((project) => ({
      ...project,
      image_count: stats.byProject[project.id]?.total ?? 0,
      annotated_count: stats.byProject[project.id]?.annotated ?? 0,
    }));

    return (
      <RecentAnnotationsClient
        images={recent.images}
        projects={projects}
        limit={recent.limit}
        isCapped={recent.isCapped}
        serverNow={Date.now()}
      />
    );
  } catch (cause) {
    return (
      <p className="text-sm text-destructive">
        {cause instanceof Error ? cause.message : "Could not load recent annotations."}
      </p>
    );
  }
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
        <Suspense
          fallback={
            <p className="text-muted-foreground">Loading recent annotations...</p>
          }
        >
          <RecentAnnotationsContent />
        </Suspense>
      </div>
    </>
  );
}
