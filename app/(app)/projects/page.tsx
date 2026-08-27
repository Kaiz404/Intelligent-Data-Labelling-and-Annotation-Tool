import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectBrowser } from "@/components/projects/project-browser";
import { fetchImageStats } from "@/lib/images";
import { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";
import { Suspense } from "react";

async function ProjectsContent() {
  await connection();
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load projects. If you recently updated the schema, run the
        latest Supabase migration.
      </p>
    );
  }

  const projectRows = projects ?? [];
  const stats = await fetchImageStats(projectRows.map((project) => project.id));
  const projectsWithStats = projectRows.map((project) => ({
    ...project,
    image_count: stats.byProject[project.id]?.total ?? 0,
    annotated_count: stats.byProject[project.id]?.annotated ?? 0,
  }));

  return <ProjectBrowser initialProjects={projectsWithStats} />;
}

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 p-4 md:p-6">
        <Suspense
          fallback={<p className="text-muted-foreground">Loading projects...</p>}
        >
          <ProjectsContent />
        </Suspense>
      </div>
    </>
  );
}
