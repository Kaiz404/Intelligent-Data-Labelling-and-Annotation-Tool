import { resolveDatasetLabels } from "@/lib/actions/labels";
import { saveImageAnnotations } from "@/lib/actions/annotations";
import { dateFormatter } from "@/lib/format";
import type { BoundingBox } from "@/lib/types/annotations";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import type { ProjectImage } from "@/lib/types/projects";
import { createUploadProvider } from "@/lib/uploads/uploader";
import { DEFAULT_MAX_CONCURRENT_FILES, type UploadProvider } from "@/lib/uploads/types";

type ImportImageBase = {
  sourceImageId: string;
  path: string;
  file: File;
  sizeBytes: number;
  uploadProgress: number;
};

export type DatasetImportImageState = ImportImageBase & (
  | { status: "queued" | "uploading" }
  | { status: "saving_annotations"; imageId: string; key: string }
  | { status: "succeeded"; imageId: string; key: string; thumbhash: string | null; boxes: BoundingBox[] }
  | { status: "failed"; failureStage: "upload"; error: string }
  | { status: "failed"; failureStage: "annotations"; imageId: string; key: string; error: string }
);

export type DatasetImportState = {
  status: "resolving_labels" | "importing" | "completed" | "completed_with_errors" | "failed";
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

export function isImportActive(state: DatasetImportState): boolean {
  return state.status === "resolving_labels" || state.status === "importing";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected import error occurred.";
}

/**
 * Import a validated plan into one project: resolve labels once, then upload
 * and save up to three images at a time. No parsing, navigation, or retries.
 * Publishes the first state synchronously and never rejects: failures are
 * reported in the resolved state.
 */
export async function runDatasetImport({ projectId, plan, provider, onChange }: {
  projectId: string;
  plan: ValidatedDatasetImportPlan;
  /** Optional provider override, using the same contract as ordinary uploads. */
  provider?: UploadProvider;
  onChange: (state: DatasetImportState) => void;
}): Promise<DatasetImportState> {
  // Snapshot metadata so caller changes cannot alter the in-flight mapping.
  const categories = plan.categories.map((category) => ({ ...category }));
  const images = plan.images.map((image) => ({ ...image, boxes: image.boxes.map((box) => ({ ...box })) }));
  let current: DatasetImportState = {
    status: "resolving_labels", totalImageCount: images.length, completedImageCount: 0,
    successfulImageCount: 0, failedImageCount: 0, uploadProgress: 0,
    images: images.map((image) => ({
      sourceImageId: image.id, path: image.archivePath, file: image.file, sizeBytes: image.file.size,
      status: "queued", uploadProgress: 0,
    })),
    labelResolutionFailed: false,
  };
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
    onChange(current);
  };
  const setImage = (index: number, image: DatasetImportImageState) => {
    publish({ images: current.images.map((existing, i) => i === index ? image : existing) });
  };

  publish();
  try {
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
        const base = {
          sourceImageId: image.id, path: image.archivePath, file: image.file, sizeBytes: image.file.size,
        };
        let uploaded: { imageId: string; key: string } | null = null;
        try {
          setImage(index, { ...base, status: "uploading", uploadProgress: 0 });
          const result = await uploader.upload({
            id: `dataset-upload-${crypto.randomUUID()}`,
            fileName: image.file.name, sizeBytes: image.file.size,
            mimeType: image.file.type, source: { kind: "file", file: image.file },
            status: "Queued", progress: 0,
          }, {
            projectId, signal: new AbortController().signal,
            onProgress: (event) => {
              if (current.images[index].status !== "uploading") return;
              if (Number.isFinite(event.progress)) {
                setImage(index, {
                  ...base, status: "uploading", uploadProgress: Math.min(100, Math.max(0, event.progress)),
                });
              }
            },
          });
          uploaded = { imageId: result.imageId, key: result.key };
          setImage(index, { ...base, ...uploaded, status: "saving_annotations", uploadProgress: 100 });
          const boxes: BoundingBox[] = image.boxes.map((box) => ({
            id: `box-${crypto.randomUUID()}`, labelId: labelIds.get(box.categoryId)!,
            x: box.x, y: box.y, width: box.width, height: box.height,
          }));
          await saveImageAnnotations(projectId, result.imageId, boxes);
          setImage(index, {
            ...base, ...uploaded, status: "succeeded", uploadProgress: 100,
            thumbhash: result.thumbhash ?? null, boxes,
          });
        } catch (error) {
          setImage(index, uploaded
            ? {
                ...base, ...uploaded, status: "failed", failureStage: "annotations", uploadProgress: 100,
                error: `Image uploaded, but its annotations were not imported: ${errorMessage(error)}`,
              }
            : {
                ...base, status: "failed", failureStage: "upload",
                uploadProgress: current.images[index].uploadProgress,
                error: `Image upload failed: ${errorMessage(error)}`,
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
  }
  return current;
}

/** One dataset import into one project, kept until the user dismisses it. */
export type DatasetImportRun = {
  id: string;
  projectId: string;
  projectName: string;
  fileName: string;
  state: DatasetImportState;
  /** Images this run created, in completion order, shown from their local bytes. */
  importedImages: ProjectImage[];
};

export type DatasetImportStore = ReturnType<typeof createDatasetImportStore>;

function toImportedImage(
  image: Extract<DatasetImportImageState, { status: "succeeded" }>,
  now: Date,
): ProjectImage {
  const annotated = image.boxes.length > 0;
  return {
    id: image.imageId,
    fileName: image.file.name,
    sizeBytes: image.sizeBytes,
    capturedAt: dateFormatter.format(now),
    modifiedAt: now.toISOString(),
    status: annotated ? "Annotated" : "Unannotated",
    progress: annotated ? 100 : 0,
    url: URL.createObjectURL(image.file),
    thumbhash: image.thumbhash,
    annotations: image.boxes,
  };
}

function revokeImages(run: DatasetImportRun) {
  for (const image of run.importedImages) if (image.url) URL.revokeObjectURL(image.url);
}

/**
 * Dataset import runs keyed by project, at most one per project. Runs outlive
 * whichever component started them. Progress notifications are batched per
 * `schedule` tick; a run's first and final states notify at once.
 */
export function createDatasetImportStore({ provider, schedule = (callback) => requestAnimationFrame(callback) }: {
  provider?: UploadProvider;
  schedule?: (callback: () => void) => void;
} = {}) {
  let runs: Readonly<Record<string, DatasetImportRun>> = {};
  const listeners = new Set<() => void>();
  let scheduled = false;

  const notify = () => {
    scheduled = false;
    for (const listener of listeners) listener();
  };
  const commit = (nextRuns: Record<string, DatasetImportRun>, immediate: boolean) => {
    runs = nextRuns;
    if (immediate) notify();
    else if (!scheduled) {
      scheduled = true;
      schedule(notify);
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getRuns: () => runs,

    /** False while the project already has an active run. Replaces a finished one. */
    start({ projectId, projectName, fileName, plan }: {
      projectId: string;
      projectName: string;
      fileName: string;
      plan: ValidatedDatasetImportPlan;
    }): boolean {
      const existing = runs[projectId];
      if (existing && isImportActive(existing.state)) return false;
      if (existing) revokeImages(existing);
      const id = crypto.randomUUID();
      const importedIds = new Set<string>();
      let importedImages: ProjectImage[] = [];
      void runDatasetImport({
        projectId, plan, provider,
        onChange: (state) => {
          const now = new Date();
          const added: ProjectImage[] = [];
          for (const image of state.images) {
            if (image.status !== "succeeded" || importedIds.has(image.imageId)) continue;
            importedIds.add(image.imageId);
            added.push(toImportedImage(image, now));
          }
          // Unchanged between images, so the project grid's memoised merge holds.
          if (added.length) importedImages = [...importedImages, ...added];
          const first = runs[projectId]?.id !== id;
          commit(
            { ...runs, [projectId]: { id, projectId, projectName, fileName, state, importedImages } },
            first || !isImportActive(state),
          );
        },
      });
      return true;
    },

    /** Forgets a finished run and releases its local image bytes. */
    dismiss(projectId: string) {
      const run = runs[projectId];
      if (!run || isImportActive(run.state)) return;
      revokeImages(run);
      const rest = { ...runs };
      delete rest[projectId];
      commit(rest, true);
    },
  };
}
