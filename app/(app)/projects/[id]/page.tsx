import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import {
  fetchImageAiStates,
  fetchLatestAnnotationJob,
} from "@/lib/annotations/jobs";
import { fetchImageStats, fetchProjectImages } from "@/lib/images";
import { fetchProjectLabels } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

async function ProjectDetailContent({ id }: { id: string }) {
  await connection();
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) {
    notFound();
  }

  const [{ data: projectRows }, images, labels, latestJob, aiStates] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .order("name", { ascending: true }),
    fetchProjectImages(project.id),
    fetchProjectLabels(project.id),
    fetchLatestAnnotationJob(project.id),
    fetchImageAiStates(project.id),
  ]);
  const destinations = projectRows ?? [];
  const stats = await fetchImageStats(destinations.map((item) => item.id));
  const projects = destinations.map((item) => ({
    ...item,
    image_count: stats.byProject[item.id]?.total ?? 0,
    annotated_count: stats.byProject[item.id]?.annotated ?? 0,
  }));

  return (
    <>
      <AppHeader projectName={project.name} />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailClient
          project={project}
          images={images}
          projects={projects}
          labels={labels}
          initialJob={latestJob}
          initialAiStates={aiStates}
        />
      </div>
    </>
  );
}

async function ProjectPageInner({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetailContent id={id} />;
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground">Loading...</p>}>
      <ProjectPageInner params={params} />
    </Suspense>
  );
}
