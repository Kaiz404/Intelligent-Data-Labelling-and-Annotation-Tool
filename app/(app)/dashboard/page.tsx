import { AppHeader } from "@/components/app-shell/app-header";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { RecentProjectsTable } from "@/components/dashboard/recent-projects-table";
import { loadProjectSummaries, loadProjectThumbnails } from "@/lib/projects";
import { connection } from "next/server";
import { Suspense } from "react";

const RECENT_PROJECT_COUNT = 7;

async function DashboardContent() {
  await connection();
  let loaded;
  try {
    loaded = await Promise.all([
      loadProjectSummaries(),
      loadProjectThumbnails(RECENT_PROJECT_COUNT),
    ]);
  } catch {
    return (
      <p className="text-sm text-destructive">
        Failed to load projects. If you recently updated the schema, run the
        latest Supabase migration.
      </p>
    );
  }

  const [{ projects, stats }, thumbnails] = loaded;
  const recentProjects = projects
    .slice(0, RECENT_PROJECT_COUNT)
    .map((project) => ({ ...project, ...thumbnails.get(project.id) }));

  return (
    <div className="space-y-6">
      <MetricCards
        total={stats.total}
        annotated={stats.annotated}
        unannotated={stats.unannotated}
      />
      <RecentProjectsTable projects={recentProjects} copyDestinations={projects} />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <AppHeader segments={[{ label: "Dashboard" }]} />
      <div className="flex-1 space-y-6 p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent />
        </Suspense>
      </div>
    </>
  );
}
