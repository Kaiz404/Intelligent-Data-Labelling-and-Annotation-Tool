import { AnnotationWorkspace } from "@/components/annotate/annotation-workspace";
import { loadAnnotationWorkspace } from "@/lib/annotations/workspace";
import { isUuid } from "@/lib/ids";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The annotation workspace is a layout so it survives image switches: it
 * loads a project once, then shows whichever image the URL names (see the
 * [imageId] page) without rendering anything else again.
 *
 * `connection()` runs on the layout itself (not only inside Suspense) so
 * Cache Components does not serve a stale static 404 before auth and params
 * are available on a cold dev navigation.
 */
export default async function AnnotateLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await connection();

  if (!isUuid(id)) {
    notFound();
  }

  const workspace = await loadAnnotationWorkspace(id);

  if (!workspace) {
    notFound();
  }
  if (workspace.images.length === 0) {
    redirect(`/projects/${id}`);
  }

  return (
    <>
      <AnnotationWorkspace {...workspace} />
      {children}
    </>
  );
}
