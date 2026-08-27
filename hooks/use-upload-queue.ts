"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUploadProvider } from "@/lib/uploads/uploader";
import type {
  UploadProvider,
  UploadQueueItem,
  UploadStatus,
  UploadTab,
} from "@/lib/uploads/types";
import {
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_MAX_CONCURRENT_FILES,
  MAX_TOTAL_UPLOAD_BYTES,
} from "@/lib/uploads/types";
import { toPercent } from "@/lib/format";

type UseUploadQueueOptions = {
  projectId: string;
  provider?: UploadProvider;
  maxConcurrentFiles?: number;
  onUploadComplete?: (result: { imageId: string; key: string }) => void;
};

function createItemId() {
  return `upload-${crypto.randomUUID()}`;
}

function isAcceptedImage(file: File) {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type);
}

function revokePreview(item: UploadQueueItem) {
  if (item.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

export function useUploadQueue({
  projectId,
  provider: providerProp,
  maxConcurrentFiles = DEFAULT_MAX_CONCURRENT_FILES,
  onUploadComplete,
}: UseUploadQueueOptions) {
  const providerRef = useRef(providerProp ?? createUploadProvider());
  const [items, setItems] = useState<UploadQueueItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const controllersRef = useRef(new Map<string, AbortController>());
  const inFlightRef = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadQueueItem>) => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const addFiles = useCallback((fileList: FileList | File[] | null) => {
    if (!fileList) return;

    const files = Array.from(fileList).filter(isAcceptedImage);
    if (!files.length) return;

    const currentBytes = itemsRef.current.reduce(
      (sum, item) => sum + item.sizeBytes,
      0,
    );
    let runningBytes = currentBytes;
    const accepted: UploadQueueItem[] = [];

    for (const file of files) {
      if (runningBytes + file.size > MAX_TOTAL_UPLOAD_BYTES) break;
      runningBytes += file.size;
      accepted.push({
        id: createItemId(),
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        status: "Queued",
        progress: 0,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (!accepted.length) return;
    setItems((current) => [...accepted, ...current]);
  }, []);

  const removeItems = useCallback(async (ids: string[]) => {
    const idSet = new Set(ids);
    for (const id of ids) {
      controllersRef.current.get(id)?.abort();
      controllersRef.current.delete(id);
      inFlightRef.current.delete(id);
      const item = itemsRef.current.find((row) => row.id === id);
      if (item) {
        revokePreview(item);
        await providerRef.current.abort?.(item);
      }
    }
    setItems((current) => current.filter((item) => !idSet.has(item.id)));
    setSelectedIds((current) => current.filter((id) => !idSet.has(id)));
  }, []);

  const pauseItem = useCallback(
    (id: string) => {
      controllersRef.current.get(id)?.abort();
      controllersRef.current.delete(id);
      inFlightRef.current.delete(id);
      updateItem(id, { status: "Paused" });
    },
    [updateItem],
  );

  const pauseAll = useCallback(() => {
    for (const [id, controller] of controllersRef.current) {
      controller.abort();
      controllersRef.current.delete(id);
      inFlightRef.current.delete(id);
    }
    setItems((current) =>
      current.map((item) =>
        item.status === "Uploading" || item.status === "Queued"
          ? { ...item, status: "Paused" as const }
          : item,
      ),
    );
    setIsRunning(false);
  }, []);

  const cancelAll = useCallback(async () => {
    setIsRunning(false);
    const ids = itemsRef.current.map((item) => item.id);
    await removeItems(ids);
  }, [removeItems]);

  const retryItem = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((row) => row.id === id);
      if (!item?.file) {
        updateItem(id, {
          status: "Failed",
          error: "No local file data (demo row). Re-add the file to upload.",
        });
        return;
      }
      updateItem(id, {
        status: "Queued",
        error: undefined,
      });
      setIsRunning(true);
    },
    [updateItem],
  );

  const runUpload = useCallback(
    async (item: UploadQueueItem) => {
      if (!item.file || inFlightRef.current.has(item.id)) return;

      inFlightRef.current.add(item.id);
      const controller = new AbortController();
      controllersRef.current.set(item.id, controller);
      updateItem(item.id, { status: "Uploading", error: undefined });

      try {
        const result = await providerRef.current.upload(item, {
          projectId,
          signal: controller.signal,
          onProgress: (event) => {
            updateItem(event.fileId, {
              progress: event.progress,
              status: "Uploading",
              completedParts: event.completedParts,
              completedPartETags: event.completedPartETags,
              uploadId: event.uploadId,
              key: event.key,
            });
          },
        });
        updateItem(item.id, {
          status: "Completed",
          progress: 100,
          key: result.key,
          uploadId: result.uploadId,
        });
        onUploadComplete?.({ imageId: result.imageId, key: result.key });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        updateItem(item.id, {
          status: "Failed",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      } finally {
        controllersRef.current.delete(item.id);
        inFlightRef.current.delete(item.id);
      }
    },
    [onUploadComplete, projectId, updateItem],
  );

  // Fill concurrent upload slots while the batch is running.
  useEffect(() => {
    if (!isRunning) return;

    const uploading = items.filter((i) => i.status === "Uploading").length;
    const queued = items.filter(
      (i) => i.status === "Queued" && i.file && !inFlightRef.current.has(i.id),
    );

    if (
      uploading === 0 &&
      queued.length === 0 &&
      inFlightRef.current.size === 0
    ) {
      setIsRunning(false);
      return;
    }

    const slots = maxConcurrentFiles - inFlightRef.current.size;
    if (slots <= 0) return;

    for (const item of queued.slice(0, slots)) {
      void runUpload(item);
    }
  }, [isRunning, items, maxConcurrentFiles, runUpload]);

  const startUploads = useCallback(() => {
    setItems((current) =>
      current.map((item) => {
        if (!item.file) return item;
        if (item.status === "Completed" || item.status === "Uploading") {
          return item;
        }
        return { ...item, status: "Queued" as const, error: undefined };
      }),
    );
    setIsRunning(true);
  }, []);

  const summary = useMemo(() => {
    const uploading = items.filter(
      (i) => i.status === "Uploading" || i.status === "Queued" || i.status === "Paused",
    ).length;
    const completed = items.filter((i) => i.status === "Completed").length;
    const failed = items.filter((i) => i.status === "Failed").length;
    const totalSelected = items.length;
    const uploaded = completed;
    const totalSizeBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
    // Weighted progress across all files
    const progress =
      totalSelected === 0
        ? 0
        : Math.round(
            items.reduce((sum, i) => sum + i.progress, 0) / totalSelected,
          );

    return {
      uploading,
      completed,
      failed,
      totalSelected,
      uploaded,
      totalSizeBytes,
      progress: toPercent(uploaded, totalSelected) || progress,
    };
  }, [items]);

  const getTabCount = useCallback(
    (tab: UploadTab) => {
      if (tab === "All") return summary.totalSelected;
      if (tab === "Uploading") {
        return items.filter(
          (i) =>
            i.status === "Uploading" ||
            i.status === "Queued" ||
            i.status === "Paused",
        ).length;
      }
      if (tab === "Completed") return summary.completed;
      return summary.failed;
    },
    [items, summary],
  );

  const matchesTab = useCallback((item: UploadQueueItem, tab: UploadTab) => {
    if (tab === "All") return true;
    if (tab === "Uploading") {
      return (
        item.status === "Uploading" ||
        item.status === "Queued" ||
        item.status === "Paused"
      );
    }
    return item.status === tab;
  }, []);

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((rowId) => rowId !== id),
    );
  }, []);

  const toggleSelectAll = useCallback(
    (ids: string[], checked: boolean) => {
      setSelectedIds((current) => {
        if (!checked) {
          const drop = new Set(ids);
          return current.filter((id) => !drop.has(id));
        }
        const next = new Set(current);
        for (const id of ids) next.add(id);
        return [...next];
      });
    },
    [],
  );

  // Cleanup object URLs on unmount.
  useEffect(() => {
    const controllers = controllersRef.current;

    return () => {
      for (const item of itemsRef.current) {
        revokePreview(item);
      }
      for (const controller of controllers.values()) {
        controller.abort();
      }
    };
  }, []);

  return {
    items,
    selectedIds,
    isRunning,
    summary,
    addFiles,
    removeItems,
    pauseItem,
    pauseAll,
    cancelAll,
    retryItem,
    startUploads,
    getTabCount,
    matchesTab,
    toggleSelected,
    toggleSelectAll,
    setStatus: (id: string, status: UploadStatus) => updateItem(id, { status }),
  };
}
