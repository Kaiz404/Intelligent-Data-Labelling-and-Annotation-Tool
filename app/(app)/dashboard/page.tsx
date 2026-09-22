import { AppHeader } from "@/components/app-shell/app-header";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { RecentProjectsTable } from "@/components/dashboard/recent-projects-table";
import { fetchImageStats } from "@/lib/images";
import { createClient } from "@/lib/supabase/server";
import { createProjectThumbnailReadUrl } from "@/lib/uploads/s3-server";
import { connection } from "next/server";
import { Suspense } from "react";

async function DashboardContent() {
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
  const stats = await fetchImageStats();
  const projectsWithStats = projectRows.map((project) => ({
    ...project,
    image_count: stats.byProject[project.id]?.total ?? 0,
    annotated_count: stats.byProject[project.id]?.annotated ?? 0,
  }));
  const recentProjects = await Promise.all(
    projectsWithStats.slice(0, 7).map(async (project) => ({
      ...project,
      thumbnailUrl: await createProjectThumbnailReadUrl(project.id),
    })),
  );

  return (
    <div className="space-y-6">
      <MetricCards
        total={stats.total}
        annotated={stats.annotated}
        unannotated={stats.unannotated}
      />
      <RecentProjectsTable
        projects={recentProjects}
        copyDestinations={projectsWithStats}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <AppHeader />
      <div className="flex-1 space-y-6 p-4 md:p-6">
        <Suspense
          fallback={
            <p className="text-muted-foreground">Loading dashboard...</p>
          }
        >
          <DashboardContent />
        </Suspense>
      </div>
    </>
  );
}
