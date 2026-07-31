import { AppHeader } from "@/components/app-shell/app-header";
import { ProjectDetailClient } from "@/components/projects/project-detail-client";
import { buildProjectImages } from "@/lib/mock/image-metadata";
import { fetchProjectSamplePhotos } from "@/lib/unsplash";
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

  const { photos, error: unsplashError } = await fetchProjectSamplePhotos(
    project.name,
    12,
  );
  const images = buildProjectImages(12, photos, unsplashError);

  return (
    <>
      <AppHeader projectName={project.name} />
      <div className="flex-1 p-4 md:p-6">
        <ProjectDetailClient
          project={project}
          images={images}
          unsplashError={unsplashError}
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
