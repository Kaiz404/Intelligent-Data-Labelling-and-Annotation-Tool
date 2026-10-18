"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { UploadQueueStore } from "@/lib/uploads/upload-queue";
import type { UploadQueueItem, UploadTab } from "@/lib/uploads/types";
import { toPercent } from "@/lib/format";

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

/** The dialog's view of a project's queue; the queue itself outlives it. */
export function useUploadQueue(store: UploadQueueStore) {
  const { items, counts, totalBytes, progressSum, isRunning, started } =
    useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The queue can be cleared from outside the dialog (banner or pill dismiss).
  if (items.length === 0 && selectedIds.size > 0) setSelectedIds(new Set());

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
    started,
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
