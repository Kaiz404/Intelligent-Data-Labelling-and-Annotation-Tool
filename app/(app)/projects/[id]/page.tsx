import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import { loadProjectDetailShell } from "@/lib/projects";
import { isUuid } from "@/lib/ids";
import { connection } from "next/server";
import { notFound } from "next/navigation";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }
  await connection();
  const shell = await loadProjectDetailShell(id);
  if (!shell) {
    notFound();
  }

  return (
    <>
      <AppHeader
        segments={[
          { label: "Projects", href: "/projects" },
          { label: shell.project.name },
        ]}
      />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailClient
          project={shell.project}
          projects={shell.projects}
          loadWorkspaceOnClient
        />
      </div>
    </>
  );
}
