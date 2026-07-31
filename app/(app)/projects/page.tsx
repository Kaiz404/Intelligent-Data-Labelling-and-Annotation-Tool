import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectBrowser } from "@/components/projects/project-browser";
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

  return <ProjectBrowser initialProjects={projects ?? []} />;
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
