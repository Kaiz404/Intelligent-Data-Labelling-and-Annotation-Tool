import { AppHeader } from "@/components/app-shell/app-header";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { RecentProjectsTable } from "@/components/dashboard/recent-projects-table";
import { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";
import { Suspense } from "react";

async function DashboardContent() {
  await connection();
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(7);

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load projects. If you recently updated the schema, run the
        latest Supabase migration.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <MetricCards />
      <RecentProjectsTable projects={projects ?? []} />
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
