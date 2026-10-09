import type {
  UploadEntry,
  UploadProvider,
  UploadQueueItem,
  UploadStatus,
} from "@/lib/uploads/types";
import { ACCEPTED_IMAGE_TYPES, MAX_TOTAL_UPLOAD_BYTES } from "@/lib/uploads/types";

export type UploadQueueSnapshot = {
  /** Newest first. */
  items: readonly UploadQueueItem[];
  counts: Readonly<Record<UploadStatus, number>>;
  totalBytes: number;
  /** Sum of every item's 0–100 progress. */
  progressSum: number;
  isRunning: boolean;
};

type UploadQueueOptions = {
  provider: UploadProvider;
  maxConcurrentFiles: number;
  getProjectId: () => string;
  onUploadComplete?: (result: { imageId: string; key: string }) => void;
  /** Batches change notifications; defaults to one per animation frame. */
  scheduleNotify?: (notify: () => void) => void;
};

function emptyCounts(): Record<UploadStatus, number> {
  return { Queued: 0, Uploading: 0, Paused: 0, Completed: 0, Failed: 0 };
}

function isAcceptedImage(entry: UploadEntry) {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(entry.mimeType);
}

export function uploadEntryFromFile(file: File): UploadEntry {
  return {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    source: { kind: "file", file },
  };
}

/**
 * The upload queue outside React, so a batch of tens of thousands of images
 * costs O(1) per progress event: items are patched by index, counts are kept
 * as totals, and subscribers hear about changes once per frame.
 */
export function createUploadQueueStore({
  provider,
  maxConcurrentFiles,
  getProjectId,
  onUploadComplete,
  scheduleNotify = (notify) => requestAnimationFrame(notify),
}: UploadQueueOptions) {
  let items: UploadQueueItem[] = [];
  let indexById = new Map<string, number>();
  const counts = emptyCounts();
  let totalBytes = 0;
  let progressSum = 0;
  let isRunning = false;
  /** Ids waiting for an upload slot, in the order they were queued. */
  const waiting = new Set<string>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let snapshot: UploadQueueSnapshot = {
    items,
    counts: { ...counts },
    totalBytes,
    progressSum,
    isRunning,
  };
  let itemsChanged = false;
  let notifyScheduled = false;

  function notify() {
    notifyScheduled = false;
    snapshot = { items, counts: { ...counts }, totalBytes, progressSum, isRunning };
    itemsChanged = false;
    for (const listener of listeners) listener();
  }

  function changed() {
    if (notifyScheduled) return;
    notifyScheduled = true;
    scheduleNotify(notify);
  }

  /** Copy-on-write: the published snapshot's array is never mutated. */
  function writableItems() {
    if (!itemsChanged) {
      items = items.slice();
      itemsChanged = true;
    }
    return items;
  }

  function patch(id: string, update: Partial<UploadQueueItem>) {
    const index = indexById.get(id);
    if (index === undefined) return;
    const list = writableItems();
    const previous = list[index];
    const next = { ...previous, ...update };
    list[index] = next;
    progressSum += next.progress - previous.progress;
    if (next.status !== previous.status) {
      counts[previous.status] -= 1;
      counts[next.status] += 1;
      if (previous.status === "Queued") waiting.delete(id);
      if (next.status === "Queued") waiting.add(id);
    }
    changed();
  }

  function setRunning(running: boolean) {
    if (isRunning === running) return;
    isRunning = running;
    changed();
  }

  async function run(item: UploadQueueItem) {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    patch(item.id, { status: "Uploading", error: undefined });

    try {
      const result = await provider.upload(item, {
        projectId: getProjectId(),
        signal: controller.signal,
        onProgress: (event) => {
          if (controller.signal.aborted) return;
          patch(event.fileId, {
            progress: event.progress,
            completedParts: event.completedParts,
            completedPartETags: event.completedPartETags,
            uploadId: event.uploadId,
            key: event.key,
          });
        },
      });
      patch(item.id, {
        status: "Completed",
        progress: 100,
        key: result.key,
        uploadId: result.uploadId,
      });
      onUploadComplete?.({ imageId: result.imageId, key: result.key });
    } catch (error) {
      if (!controller.signal.aborted) {
        patch(item.id, {
          status: "Failed",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    } finally {
      if (controllers.get(item.id) === controller) controllers.delete(item.id);
      pump();
    }
  }

  /** Fills free upload slots from the waiting items. */
  function pump() {
    if (!isRunning) return;
    for (const id of waiting) {
      if (controllers.size >= maxConcurrentFiles) break;
      const index = indexById.get(id);
      if (index !== undefined) void run(items[index]);
    }
    if (controllers.size === 0 && waiting.size === 0) setRunning(false);
  }

  function stop(id: string) {
    controllers.get(id)?.abort();
    controllers.delete(id);
  }

  async function remove(ids: string[]) {
    const removed = new Set(ids);
    const doomed = items.filter((item) => removed.has(item.id));
    for (const item of doomed) {
      stop(item.id);
      waiting.delete(item.id);
    }

    items = items.filter((item) => !removed.has(item.id));
    itemsChanged = true;
    indexById = new Map(items.map((item, index) => [item.id, index]));
    for (const item of doomed) {
      counts[item.status] -= 1;
      totalBytes -= item.sizeBytes;
      progressSum -= item.progress;
    }
    changed();
    pump();

    await Promise.all(
      doomed
        .filter((item) => item.status !== "Completed" && item.uploadId)
        .map((item) =>
          // Removing a local queue item should still succeed when the
          // best-effort server-side multipart cleanup is unavailable.
          provider.abort?.(item).catch(() => {}),
        ),
    );
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,

    /** Adds accepted images until the batch would pass the size cap. */
    add(entries: UploadEntry[]) {
      const accepted: UploadQueueItem[] = [];
      for (const entry of entries) {
        if (!isAcceptedImage(entry)) continue;
        if (totalBytes + entry.sizeBytes > MAX_TOTAL_UPLOAD_BYTES) break;
        totalBytes += entry.sizeBytes;
        accepted.push({
          ...entry,
          id: `upload-${crypto.randomUUID()}`,
          status: "Queued",
          progress: 0,
        });
      }
      if (!accepted.length) return;

      items = [...accepted, ...items];
      itemsChanged = true;
      indexById = new Map(items.map((item, index) => [item.id, index]));
      counts.Queued += accepted.length;
      for (const item of accepted) waiting.add(item.id);
      changed();
      pump();
    },

    remove,

    async cancelAll() {
      setRunning(false);
      await remove(items.map((item) => item.id));
    },

    rename(id: string, fileName: string) {
      const trimmed = fileName.trim();
      if (trimmed) patch(id, { fileName: trimmed });
    },

    pause(id: string) {
      stop(id);
      patch(id, { status: "Paused" });
      pump();
    },

    pauseAll() {
      setRunning(false);
      for (const id of [...controllers.keys()]) stop(id);
      for (const item of items) {
        if (item.status === "Uploading" || item.status === "Queued") {
          patch(item.id, { status: "Paused" });
        }
      }
    },

    retry(id: string) {
      patch(id, { status: "Queued", error: undefined });
      setRunning(true);
      pump();
    },

    start() {
      for (const item of items) {
        if (item.status === "Paused" || item.status === "Failed") {
          patch(item.id, { status: "Queued", error: undefined });
        }
      }
      setRunning(true);
      pump();
    },

    /** Aborts in-flight requests when the owner unmounts. */
    dispose() {
      isRunning = false;
      for (const controller of controllers.values()) controller.abort();
    },
  };
}

export type UploadQueueStore = ReturnType<typeof createUploadQueueStore>;
