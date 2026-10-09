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
  /** Sum of `sizeBytes` per status. */
  bytes: Readonly<Record<UploadStatus, number>>;
  totalBytes: number;
  /** Sum of every item's 0–100 progress. */
  progressSum: number;
  isRunning: boolean;
  /** Set by `start`; cleared when the queue empties. */
  started: boolean;
};

/**
 * What the banner and pill show. `idle` until uploads start and once the
 * queue is cleared; `finished` and `failed` stay until dismissed.
 */
export type UploadPhase = "idle" | "running" | "paused" | "finished" | "failed";

export function uploadPhase({ items, counts, isRunning, started }: UploadQueueSnapshot): UploadPhase {
  if (!started || items.length === 0) return "idle";
  if (isRunning) return "running";
  if (counts.Queued + counts.Uploading + counts.Paused > 0) return "paused";
  return counts.Failed > 0 ? "failed" : "finished";
}

type UploadCompleteListener = (result: { imageId: string; key: string }) => void;

type UploadQueueOptions = {
  provider: UploadProvider;
  maxConcurrentFiles: number;
  /** Uploads start only while their combined size fits, though one always may. */
  maxInFlightBytes?: number;
  projectId: string;
  /** Batches change notifications; defaults to one per animation frame. */
  scheduleNotify?: (notify: () => void) => void;
  now?: () => number;
};

/** Throughput is measured over the images completed in this window. */
const RATE_WINDOW_MS = 30_000;
/** An estimate from less data than this jumps around too much to show. */
const MIN_RATE_SAMPLE_MS = 3_000;

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
  maxInFlightBytes = Infinity,
  projectId,
  scheduleNotify = (notify) => requestAnimationFrame(notify),
  now: clock = Date.now,
}: UploadQueueOptions) {
  let items: UploadQueueItem[] = [];
  let indexById = new Map<string, number>();
  const counts = emptyCounts();
  const bytes = emptyCounts();
  let totalBytes = 0;
  let progressSum = 0;
  let isRunning = false;
  let started = false;
  /**
   * Bytes completed since the queue was created, sampled at each completion.
   * It only grows, so removing finished images does not read as negative
   * throughput. The first sample marks the latest start or stop.
   */
  let meteredBytes = 0;
  let rateSamples: { at: number; bytes: number }[] = [];
  const completeListeners = new Set<UploadCompleteListener>();
  /** Ids waiting for an upload slot, in the order they were queued. */
  const waiting = new Set<string>();
  const controllers = new Map<string, AbortController>();
  /** Size of the uploads whose `run` has not settled yet. */
  let inFlightBytes = 0;
  const listeners = new Set<() => void>();
  function takeSnapshot(): UploadQueueSnapshot {
    return {
      items,
      counts: { ...counts },
      bytes: { ...bytes },
      totalBytes,
      progressSum,
      isRunning,
      started,
    };
  }
  let snapshot = takeSnapshot();
  let itemsChanged = false;
  let notifyScheduled = false;

  function notify() {
    notifyScheduled = false;
    snapshot = takeSnapshot();
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
      bytes[previous.status] -= next.sizeBytes;
      bytes[next.status] += next.sizeBytes;
      if (previous.status === "Queued") waiting.delete(id);
      if (next.status === "Queued") waiting.add(id);
      if (next.status === "Completed") recordCompletion(next.sizeBytes);
    }
    changed();
  }

  /** Keeps the newest sample at or before `windowStart` as the baseline. */
  function dropSamplesBefore(windowStart: number) {
    let stale = 0;
    while (stale + 1 < rateSamples.length && rateSamples[stale + 1].at <= windowStart) {
      stale++;
    }
    if (stale > 0) rateSamples = rateSamples.slice(stale);
  }

  function recordCompletion(sizeBytes: number) {
    meteredBytes += sizeBytes;
    const at = clock();
    rateSamples.push({ at, bytes: meteredBytes });
    dropSamplesBefore(at - RATE_WINDOW_MS);
  }

  function setRunning(running: boolean) {
    if (isRunning === running) return;
    isRunning = running;
    // Time spent paused or idle never counts towards throughput.
    rateSamples = [{ at: clock(), bytes: meteredBytes }];
    changed();
  }

  async function run(item: UploadQueueItem) {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    inFlightBytes += item.sizeBytes;
    patch(item.id, { status: "Uploading", error: undefined });

    try {
      const result = await provider.upload(item, {
        projectId,
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
      for (const listener of completeListeners) {
        listener({ imageId: result.imageId, key: result.key });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        patch(item.id, {
          status: "Failed",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    } finally {
      if (controllers.get(item.id) === controller) controllers.delete(item.id);
      inFlightBytes -= item.sizeBytes;
      pump();
    }
  }

  /** Fills free upload slots from the waiting items, in queue order. */
  function pump() {
    if (!isRunning) return;
    for (const id of waiting) {
      if (controllers.size >= maxConcurrentFiles) break;
      const index = indexById.get(id);
      if (index === undefined) continue;
      const item = items[index];
      if (inFlightBytes > 0 && inFlightBytes + item.sizeBytes > maxInFlightBytes) break;
      void run(item);
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
      bytes[item.status] -= item.sizeBytes;
      totalBytes -= item.sizeBytes;
      progressSum -= item.progress;
    }
    if (items.length === 0) started = false;
    changed();
    pump();

    await Promise.all(
      doomed
        .filter((item) => item.status !== "Completed" && item.key)
        .map((item) =>
          // Removing a local queue item should still succeed when the
          // best-effort server-side cleanup is unavailable.
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

    /** Hears each saved image at once, not batched per frame. */
    onComplete(listener: UploadCompleteListener) {
      completeListeners.add(listener);
      return () => {
        completeListeners.delete(listener);
      };
    },

    /**
     * Time left at the throughput of the last 30 s, measured up to `now` so a
     * stall lowers the rate instead of freezing the estimate. Reads live
     * state, not the per-frame snapshot. Null while stopped or short of data.
     */
    estimateRemainingMs(now = clock()) {
      if (!isRunning) return null;
      const windowStart = now - RATE_WINDOW_MS;
      dropSamplesBefore(windowStart);
      const baseline = rateSamples[0];
      const from = Math.max(baseline.at, windowStart);
      const gained = meteredBytes - baseline.bytes;
      if (now - from < MIN_RATE_SAMPLE_MS || gained <= 0) return null;
      const remaining = bytes.Queued + bytes.Uploading + bytes.Paused;
      return remaining / (gained / (now - from));
    },

    /** Adds accepted images until the batch would pass the size cap. */
    add(entries: UploadEntry[]) {
      const accepted: UploadQueueItem[] = [];
      for (const entry of entries) {
        if (!isAcceptedImage(entry) || entry.sizeBytes === 0) continue;
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
      for (const item of accepted) {
        bytes.Queued += item.sizeBytes;
        waiting.add(item.id);
      }
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
      started = true;
      for (const item of items) {
        if (item.status === "Paused" || item.status === "Failed") {
          patch(item.id, { status: "Queued", error: undefined });
        }
      }
      setRunning(true);
      changed();
      pump();
    },
  };
}

export type UploadQueueStore = ReturnType<typeof createUploadQueueStore>;
