import { loadAnnotationWorkspace } from "@/lib/annotations/workspace";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

/**
 * Only checks the URL on the server: the workspace in the annotate layout
 * renders the image named here, and switches images client-side. An ID that
 * is not one of the project's images redirects to its first image. Shares the
 * layout's request-scoped workspace load.
 */
async function ImageGuard({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  const { id, imageId } = await params;
  await connection();
  const workspace = await loadAnnotationWorkspace(id);
  const images = workspace?.images ?? [];

  if (images.length > 0 && !images.some((image) => image.id === imageId)) {
    redirect(`/projects/${id}/annotate/${images[0].id}`);
  }
  return null;
}

export default function AnnotateImagePage({
  params,
}: {
  params: Promise<{ id: string; imageId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ImageGuard params={params} />
    </Suspense>
  );
}
