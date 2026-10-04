import { AnnotationWorkspace } from "@/components/annotate/annotation-workspace";
import { AnnotationWorkspaceSkeleton } from "@/components/annotate/annotation-workspace-skeleton";
import { loadAnnotationWorkspace } from "@/lib/annotations/workspace";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const workspace = await loadAnnotationWorkspace(id);

  if (!workspace) {
    notFound();
  }
  if (workspace.images.length === 0) {
    redirect(`/projects/${id}`);
  }

  return <AnnotationWorkspace {...workspace} />;
}

/**
 * The annotation workspace is a layout so it survives image switches: it
 * loads a project once, then shows whichever image the URL names (see the
 * [imageId] page) without rendering anything else again.
 */
export default function AnnotateLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <Suspense fallback={<AnnotationWorkspaceSkeleton />}>
        <Workspace params={params} />
      </Suspense>
      {children}
    </>
  );
}
