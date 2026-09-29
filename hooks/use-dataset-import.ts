"use client";

import { useCallback, useRef, useState } from "react";
import { resolveDatasetLabels } from "@/lib/actions/labels";
import { saveImageAnnotations } from "@/lib/actions/annotations";
import type { BoundingBox } from "@/lib/types/annotations";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { createUploadProvider } from "@/lib/uploads/uploader";
import { DEFAULT_MAX_CONCURRENT_FILES, type UploadProvider } from "@/lib/uploads/types";

export type DatasetImportImageState = {
  sourceImageId: string;
  path: string;
  sizeBytes: number;
  status: "queued" | "uploading" | "saving_annotations" | "succeeded" | "failed";
  uploadProgress: number;
  imageId?: string;
  key?: string;
  failureStage?: "upload" | "annotations";
  error?: string;
};

export type DatasetImportState = {
  status: "idle" | "resolving_labels" | "importing" | "completed" | "completed_with_errors" | "failed";
  totalImageCount: number;
  /** Terminal outcomes, including failures; success requires an annotation save. */
  completedImageCount: number;
  successfulImageCount: number;
  failedImageCount: number;
  /** Byte-weighted upload percentage, independent of annotation-save completion. */
  uploadProgress: number;
  images: DatasetImportImageState[];
  labelResolutionFailed: boolean;
  error?: string;
};

function initialState(): DatasetImportState {
  return {
    status: "idle", totalImageCount: 0, completedImageCount: 0,
    successfulImageCount: 0, failedImageCount: 0, uploadProgress: 0,
    images: [], labelResolutionFailed: false,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected import error occurred.";
}

/**
 * Import a validated plan into one project. No parsing, navigation, or retries.
 * Keep the owner mounted for the duration of a run; this is not a persistent job.
 * startImport resolves with the final outcomes; overlapping calls reject.
 */
export function useDatasetImport({ projectId, provider }: {
  projectId: string;
  /** Optional provider override, using the same contract as ordinary uploads. */
  provider?: UploadProvider;
}) {
  const [state, setState] = useState<DatasetImportState>(initialState);
  const runningRef = useRef(false);

  const startImport = useCallback(async (plan: ValidatedDatasetImportPlan): Promise<DatasetImportState> => {
    // A ref closes the gap before React has rendered the resolving_labels state.
    if (runningRef.current) throw new Error("A dataset import is already running.");
    runningRef.current = true;
    let current = initialState();
    const publish = (patch: Partial<DatasetImportState> = {}) => {
      current = { ...current, ...patch };
      const succeeded = current.images.filter((image) => image.status === "succeeded").length;
      const failed = current.images.filter((image) => image.status === "failed").length;
      const bytes = current.images.reduce((sum, image) => sum + image.sizeBytes, 0);
      current = {
        ...current,
        successfulImageCount: succeeded,
        failedImageCount: failed,
        completedImageCount: succeeded + failed,
        uploadProgress: bytes === 0 ? 0 : current.images.reduce(
          (sum, image) => sum + image.sizeBytes * image.uploadProgress, 0,
        ) / bytes,
      };
      setState(current);
    };
    const updateImage = (index: number, patch: Partial<DatasetImportImageState>) => {
      publish({ images: current.images.map((image, i) => i === index ? { ...image, ...patch } : image) });
    };

    try {
      // Snapshot metadata so caller changes cannot alter the in-flight mapping.
      const categories = plan.categories.map((category) => ({ ...category }));
      const images = plan.images.map((image) => ({ ...image, boxes: image.boxes.map((box) => ({ ...box })) }));
      publish({
        status: "resolving_labels", totalImageCount: images.length,
        images: images.map((image) => ({
          sourceImageId: image.id, path: image.archivePath, sizeBytes: image.file.size,
          status: "queued", uploadProgress: 0,
        })),
      });
      const resolutions = await resolveDatasetLabels(projectId, categories);
      const labelIds = new Map<string, string>();
      for (const { categoryId, labelId } of resolutions) {
        if (typeof labelId !== "string" || !labelId.trim() ||
            (labelIds.has(categoryId) && labelIds.get(categoryId) !== labelId)) {
          throw new Error("Label resolution returned an invalid category mapping.");
        }
        labelIds.set(categoryId, labelId);
      }
      if (categories.some((category) => !labelIds.has(category.id)) ||
          images.some((image) => image.boxes.some((box) => !labelIds.has(box.categoryId)))) {
        throw new Error("Label resolution returned an incomplete category mapping.");
      }

      publish({ status: "importing" });
      const uploader = provider ?? createUploadProvider();
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < images.length) {
          const index = nextIndex++;
          const image = images[index];
          let stage: "upload" | "annotations" = "upload";
          try {
            updateImage(index, { status: "uploading" });
            const result = await uploader.upload({
              id: `dataset-upload-${crypto.randomUUID()}`,
              fileName: image.file.name, sizeBytes: image.file.size,
              mimeType: image.file.type, file: image.file,
              status: "Queued", progress: 0,
            }, {
              projectId, signal: new AbortController().signal,
              onProgress: (event) => {
                if (current.images[index].status !== "uploading") return;
                if (Number.isFinite(event.progress)) {
                  updateImage(index, { uploadProgress: Math.min(100, Math.max(0, event.progress)) });
                }
              },
            });
            stage = "annotations";
            updateImage(index, {
              status: "saving_annotations", uploadProgress: 100,
              imageId: result.imageId, key: result.key,
            });
            const boxes: BoundingBox[] = image.boxes.map((box) => ({
              id: `box-${crypto.randomUUID()}`, labelId: labelIds.get(box.categoryId)!,
              x: box.x, y: box.y, width: box.width, height: box.height,
            }));
            await saveImageAnnotations(projectId, result.imageId, boxes);
            updateImage(index, { status: "succeeded" });
          } catch (error) {
            updateImage(index, {
              status: "failed", failureStage: stage,
              error: stage === "annotations"
                ? `Image uploaded, but its annotations were not imported: ${errorMessage(error)}`
                : `Image upload failed: ${errorMessage(error)}`,
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DEFAULT_MAX_CONCURRENT_FILES, images.length) }, worker));
      publish({ status: current.failedImageCount > 0 ? "completed_with_errors" : "completed" });
    } catch (error) {
      publish({
        status: "failed", error: errorMessage(error),
        labelResolutionFailed: current.status === "resolving_labels",
      });
    } finally {
      runningRef.current = false;
    }
    return current;
  }, [projectId, provider]);

  return { ...state, isImporting: state.status === "resolving_labels" || state.status === "importing", startImport };
}
