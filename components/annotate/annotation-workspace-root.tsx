"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { AnnotationWorkspace } from "@/components/annotate/annotation-workspace";
import { AnnotationWorkspacePending } from "@/components/annotate/annotation-workspace-pending";
import { useProjectWorkspaceLoader } from "@/hooks/use-project-workspace-loader";
import {
  annotateImageIdFromParams,
  annotateImageIdFromPath,
} from "@/lib/annotations/annotate-path";
import { readProjectPreview } from "@/lib/projects/preview-cache";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  ImageAiState,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

type AnnotationWorkspaceRootProps = {
  project: Project;
  loadWorkspaceOnClient?: boolean;
  workspace?: {
    images: ProjectImage[];
    labels: AnnotationLabel[];
    latestJob: AnnotationJobProgress | null;
    aiStates: Record<string, ImageAiState>;
  };
};

export function AnnotationWorkspaceRoot({
  project: serverProject,
  loadWorkspaceOnClient = false,
  workspace,
}: AnnotationWorkspaceRootProps) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const openImageId =
    annotateImageIdFromPath(pathname) ??
    annotateImageIdFromParams(params);
  const preview = readProjectPreview(serverProject.id);
  const project = {
    ...serverProject,
    name: serverProject.name || preview?.name || serverProject.name,
  };

  const loader = useProjectWorkspaceLoader(project.id, loadWorkspaceOnClient, {
    priorityImageId: openImageId,
  });

  const images = useMemo(
    () =>
      loadWorkspaceOnClient ? loader.images : (workspace?.images ?? []),
    [loadWorkspaceOnClient, loader.images, workspace?.images],
  );
  const labels = useMemo(
    () =>
      loadWorkspaceOnClient ? loader.labels : (workspace?.labels ?? []),
    [loadWorkspaceOnClient, loader.labels, workspace?.labels],
  );
  const latestJob = loadWorkspaceOnClient
    ? loader.initialJob
    : (workspace?.latestJob ?? null);
  const aiStates = useMemo(
    () =>
      loadWorkspaceOnClient
        ? loader.initialAiStates
        : (workspace?.aiStates ?? {}),
    [loadWorkspaceOnClient, loader.initialAiStates, workspace?.aiStates],
  );

  const activeImage =
    (openImageId
      ? images.find((image) => image.id === openImageId)
      : undefined) ?? images[0];

  useEffect(() => {
    if (!loadWorkspaceOnClient || loader.status !== "ready") return;
    if (images.length === 0) {
      router.replace(`/projects/${project.id}`);
      return;
    }
    if (
      openImageId &&
      !images.some((image) => image.id === openImageId)
    ) {
      router.replace(
        `/projects/${project.id}/annotate/${images[0].id}`,
      );
    }
  }, [
    images,
    loadWorkspaceOnClient,
    loader.status,
    openImageId,
    project.id,
    router,
  ]);

  if (loadWorkspaceOnClient && !activeImage) {
    return (
      <AnnotationWorkspacePending
        project={project}
        labels={labels}
        images={images}
        routeImageId={openImageId}
        error={loader.error}
      />
    );
  }

  if (!activeImage) {
    return null;
  }

  return (
    <AnnotationWorkspace
      project={project}
      images={images}
      labels={labels}
      latestJob={latestJob}
      aiStates={aiStates}
      initialImageId={openImageId}
    />
  );
}
