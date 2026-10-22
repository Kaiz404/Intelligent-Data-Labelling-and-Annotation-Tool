"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  ImageAiState,
} from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";

export type ProjectWorkspaceLoadStatus =
  | "idle"
  | "loading-meta"
  | "loading-images"
  | "ready"
  | "error";

type WorkspaceMeta = {
  labels: AnnotationLabel[];
  latestJob: AnnotationJobProgress | null;
  aiStates: Record<string, ImageAiState>;
};

const IMAGE_PAGE_SIZE = 32;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Could not load the project.",
    );
  }
  return body;
}

/**
 * Loads labels, AI state, and images in pages so the project shell can render
 * while thumbnails and signed URLs stream in.
 */
type WorkspaceLoaderOptions = {
  /** Open this image first (deep links to a newer image in the project). */
  priorityImageId?: string | null;
};

export function useProjectWorkspaceLoader(
  projectId: string,
  enabled: boolean,
  options: WorkspaceLoaderOptions = {},
) {
  // Only the image open when a load starts gets priority; switching images
  // afterwards must not reload the project.
  const readPriorityImageId = useEffectEvent(
    () => options.priorityImageId ?? null,
  );
  const [status, setStatus] = useState<ProjectWorkspaceLoadStatus>(
    enabled ? "loading-meta" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<AnnotationLabel[]>([]);
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [initialJob, setInitialJob] = useState<AnnotationJobProgress | null>(
    null,
  );
  const [initialAiStates, setInitialAiStates] = useState<
    Record<string, ImageAiState>
  >({});
  const loadGeneration = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(null);
      return;
    }

    const generation = ++loadGeneration.current;
    const priorityImageId = readPriorityImageId();
    setStatus("loading-meta");
    setError(null);
    setLabels([]);
    setImages([]);
    setInitialJob(null);
    setInitialAiStates({});

    async function load() {
      try {
        const meta = await readJson<WorkspaceMeta>(
          await fetch(`/api/projects/${projectId}/detail-meta`, {
            cache: "no-store",
          }),
        );
        if (generation !== loadGeneration.current) return;
        setLabels(meta.labels);
        setInitialJob(meta.latestJob);
        setInitialAiStates(meta.aiStates);
        setStatus("loading-images");

        const seen = new Set<string>();
        const append = (batch: ProjectImage[]) => {
          const fresh = batch.filter((image) => {
            if (seen.has(image.id)) return false;
            seen.add(image.id);
            return true;
          });
          if (fresh.length > 0) {
            setImages((current) => [...current, ...fresh]);
          }
        };

        if (priorityImageId) {
          const priorityResponse = await fetch(
            `/api/projects/${projectId}/images/${priorityImageId}`,
            { cache: "no-store" },
          );
          if (generation !== loadGeneration.current) return;
          if (priorityResponse.ok) {
            const priority = await readJson<{ image: ProjectImage | null }>(
              priorityResponse,
            );
            if (priority.image) append([priority.image]);
          }
        }

        let offset = 0;
        let total = Number.POSITIVE_INFINITY;
        while (offset < total) {
          const page = await readJson<{ images: ProjectImage[]; total: number }>(
            await fetch(
              `/api/projects/${projectId}/images?offset=${offset}&limit=${IMAGE_PAGE_SIZE}`,
              { cache: "no-store" },
            ),
          );
          if (generation !== loadGeneration.current) return;
          total = page.total;
          if (page.images.length === 0) break;
          append(page.images);
          offset += page.images.length;
        }
        if (generation !== loadGeneration.current) return;
        setStatus("ready");
      } catch (loadError) {
        if (generation !== loadGeneration.current) return;
        setStatus("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load project images.",
        );
      }
    }

    void load();
    // eslint-plugin-react-hooks 5 predates useEffectEvent, whose functions
    // never belong in dependency lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId]);

  return {
    status,
    error,
    labels,
    images,
    initialJob,
    initialAiStates,
    imagesLoading: enabled && status !== "ready" && status !== "error",
  };
}
