import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import { ProjectDetailSkeleton } from "@/components/projects/project-detail-skeleton";
import { loadAnnotationWorkspace } from "@/lib/annotations/workspace";
import { isUuid } from "@/lib/ids";
import { loadProjectSummaries } from "@/lib/projects";
import { createProjectThumbnailReadUrl } from "@/lib/uploads/s3-server";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  await connection();
  // The project's images, labels and AI state, every project as a Move/Add
  // destination, and the thumbnail the Edit dialog previews: all in parallel.
  // The thumbnail URL only reaches the page once RLS has returned the project.
  const [workspace, { projects }, thumbnailUrl] = await Promise.all([
    loadAnnotationWorkspace(id),
    loadProjectSummaries(),
    createProjectThumbnailReadUrl(id),
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
          project={{ ...project, thumbnailUrl }}
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
