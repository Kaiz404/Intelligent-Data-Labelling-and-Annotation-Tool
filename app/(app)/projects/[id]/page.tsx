import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton";
import { loadAnnotationWorkspace } from "@/lib/annotations/workspace";
import { loadProjectSummaries } from "@/lib/projects";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  // The project's images, labels and AI state, plus every project as a
  // Move/Add destination: all in parallel.
  const [workspace, { projects }] = await Promise.all([
    loadAnnotationWorkspace(id),
    loadProjectSummaries(),
  ]);
  if (!workspace) {
    notFound();
  }
  const { project, images, labels, latestJob, aiStates } = workspace;

  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailClient
          project={project}
          images={images}
          projects={projects.toSorted((a, b) => a.name.localeCompare(b.name))}
          labels={labels}
          initialJob={latestJob}
          initialAiStates={aiStates}
        />
      </div>
    </>
  );
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<ProjectDetailSkeleton />}>
      <ProjectDetail params={params} />
    </Suspense>
  );
}
