import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectBrowser } from "@/components/projects/project-browser";
import { ProjectBrowserSkeleton } from "@/components/projects/project-browser-skeleton";
import { loadProjectSummaries, loadProjectThumbnails } from "@/lib/projects";
import { connection } from "next/server";
import { Suspense } from "react";

async function ProjectsContent() {
  await connection();
  let loaded;
  try {
    loaded = await Promise.all([
      loadProjectSummaries(),
      loadProjectThumbnails(Number.POSITIVE_INFINITY),
    ]);
  } catch {
    return (
      <p className="text-sm text-destructive">
        Failed to load projects. If you recently updated the schema, run the
        latest Supabase migration.
      </p>
    );
  }

  const [{ projects }, thumbnails] = loaded;
  return (
    <ProjectBrowser
      projects={projects.map((project) => ({
        ...project,
        ...thumbnails.get(project.id),
      }))}
    />
  );
}

export default function ProjectsPage() {
  return (
    <>
      <AppHeader segments={[{ label: "Projects" }]} />
      <div className="flex-1 space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All Projects</h1>
          <p className="text-muted-foreground">
            Manage and organize all your projects
          </p>
        </div>
        <Suspense fallback={<ProjectBrowserSkeleton />}>
          <ProjectsContent />
        </Suspense>
      </div>
    </>
  );
}
