import { AppHeader } from "@/components/app-shell/app-header";
import { AnnotationWorkspace } from "@/components/annotate/annotation-workspace";
import { buildProjectImages } from "@/lib/mock/image-metadata";
import { createClient } from "@/lib/supabase/server";
import { fetchProjectSamplePhotos } from "@/lib/unsplash";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

async function AnnotateContent({
  projectId,
  imageId,
}: {
  projectId: string;
  imageId: string;
}) {
  await connection();
  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (error || !project) {
    notFound();
  }

  const { photos, error: unsplashError } = await fetchProjectSamplePhotos(
    project.name,
    12,
  );
  const images = buildProjectImages(12, photos, unsplashError);

  if (images.length === 0) {
    redirect(`/projects/${projectId}`);
  }

  const activeImage =
    images.find((image) => image.id === imageId) ?? images[0];

  if (activeImage.id !== imageId) {
    redirect(`/projects/${projectId}/annotate/${activeImage.id}`);
  }

  return (
    <>
      <AppHeader
        projectName={project.name}
        projectId={project.id}
        fileName={activeImage.fileName}
      />
      <div className="flex-1 p-4 md:p-6">
        <AnnotationWorkspace
          project={project}
          images={images}
          imageId={activeImage.id}
        />
      </div>
    </>
  );
}

async function AnnotatePageInner({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  const { id, imageId } = await params;
  return <AnnotateContent projectId={id} imageId={imageId} />;
}

export default function AnnotatePage({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  return (
    <Suspense
      fallback={<p className="p-6 text-muted-foreground">Loading workspace...</p>}
    >
      <AnnotatePageInner params={params} />
    </Suspense>
  );
}
