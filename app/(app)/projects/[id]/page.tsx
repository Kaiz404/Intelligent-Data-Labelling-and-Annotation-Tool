import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import { fetchProjectImages } from "@/lib/images";
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

  const images = await fetchProjectImages(project.id);

  return (
    <>
      <AppHeader projectName={project.name} />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailClient project={project} images={images} />
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
