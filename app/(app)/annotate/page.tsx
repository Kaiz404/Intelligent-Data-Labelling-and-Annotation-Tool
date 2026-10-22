import { AppHeader } from "@/components/app-shell/app-header";
import { RecentAnnotationsClient } from "@/components/recent-annotations/recent-annotations-client";
import { loadProjectSummaries } from "@/lib/projects";
import { connection } from "next/server";
import { Suspense } from "react";

async function RecentAnnotationsShell() {
  await connection();
  let projects;
  try {
    ({ projects } = await loadProjectSummaries());
  } catch {
    return (
      <p className="text-sm text-destructive">
        Failed to load projects. If you recently updated the schema, run the
        latest Supabase migration.
      </p>
    );
  }

  return (
    <RecentAnnotationsClient
      projects={projects.toSorted((a, b) => a.name.localeCompare(b.name))}
      loadOnClient
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
        <Suspense fallback={null}>
          <RecentAnnotationsShell />
        </Suspense>
      </div>
    </>
  );
}
