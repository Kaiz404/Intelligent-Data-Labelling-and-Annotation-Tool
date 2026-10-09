"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createUploadProvider } from "@/lib/uploads/uploader";
import { createUploadQueueStore } from "@/lib/uploads/upload-queue";
import type {
  UploadProvider,
  UploadQueueItem,
  UploadTab,
} from "@/lib/uploads/types";
import {
  UPLOAD_QUEUE_MAX_CONCURRENT_FILES,
  UPLOAD_QUEUE_MAX_IN_FLIGHT_BYTES,
} from "@/lib/uploads/types";
import { toPercent } from "@/lib/format";

type UseUploadQueueOptions = {
  projectId: string;
  provider?: UploadProvider;
  maxConcurrentFiles?: number;
  onUploadComplete?: (result: { imageId: string; key: string }) => void;
};

export function matchesUploadTab(item: UploadQueueItem, tab: UploadTab) {
  if (tab === "All") return true;
  if (tab === "Uploading") {
    return (
      item.status === "Uploading" ||
      item.status === "Queued" ||
      item.status === "Paused"
    );
  }
  return item.status === tab;
}

export function useUploadQueue({
  projectId,
  provider,
  maxConcurrentFiles = UPLOAD_QUEUE_MAX_CONCURRENT_FILES,
  onUploadComplete,
}: UseUploadQueueOptions) {
  const projectIdRef = useRef(projectId);
  const onUploadCompleteRef = useRef(onUploadComplete);
  projectIdRef.current = projectId;
  onUploadCompleteRef.current = onUploadComplete;

  const [store] = useState(() =>
    createUploadQueueStore({
      provider: provider ?? createUploadProvider(),
      maxConcurrentFiles,
      maxInFlightBytes: UPLOAD_QUEUE_MAX_IN_FLIGHT_BYTES,
      getProjectId: () => projectIdRef.current,
      onUploadComplete: (result) => onUploadCompleteRef.current?.(result),
    }),
  );
  const { items, counts, totalBytes, progressSum, isRunning } =
    useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => () => store.dispose(), [store]);

  const summary = useMemo(() => {
    const totalSelected = items.length;
    const progress = totalSelected ? Math.round(progressSum / totalSelected) : 0;
    return {
      uploading: counts.Uploading + counts.Queued + counts.Paused,
      completed: counts.Completed,
      failed: counts.Failed,
      totalSelected,
      uploaded: counts.Completed,
      totalSizeBytes: totalBytes,
      progress: toPercent(counts.Completed, totalSelected) || progress,
    };
  }, [counts, items.length, progressSum, totalBytes]);

  const getTabCount = useCallback(
    (tab: UploadTab) => {
      if (tab === "All") return summary.totalSelected;
      if (tab === "Uploading") return summary.uploading;
      if (tab === "Completed") return summary.completed;
      return summary.failed;
    },
    [summary],
  );

  const removeItems = useCallback(
    async (ids: string[]) => {
      const removed = new Set(ids);
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of removed) next.delete(id);
        return next;
      });
      await store.remove(ids);
    },
    [store],
  );

  const cancelAll = useCallback(async () => {
    setSelectedIds(new Set());
    await store.cancelAll();
  }, [store]);

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (current.has(id) === checked) return current;
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return {
    items,
    counts,
    selectedIds,
    isRunning,
    summary,
    addEntries: store.add,
    renameItem: store.rename,
    removeItems,
    pauseItem: store.pause,
    pauseAll: store.pauseAll,
    cancelAll,
    retryItem: store.retry,
    startUploads: store.start,
    getTabCount,
    toggleSelected,
    toggleSelectAll,
  };
}
