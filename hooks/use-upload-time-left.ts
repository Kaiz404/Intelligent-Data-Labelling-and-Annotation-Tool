"use client";

import { useEffect, useState } from "react";
import { formatTimeLeft } from "@/lib/format";
import type { UploadQueueStore } from "@/lib/uploads/upload-queue";

/**
 * "about 12 min left" while the queue runs, updated every second rather than
 * every frame, so the estimate keeps moving during a stall. Null when idle.
 */
export function useUploadTimeLeft(store: UploadQueueStore, isRunning: boolean) {
  const [estimateMs, setEstimateMs] = useState<number | null>(null);

  useEffect(() => {
    if (!isRunning) return;
    const update = () => setEstimateMs(store.estimateRemainingMs());
    update();
    const id = window.setInterval(update, 1000);
    return () => {
      window.clearInterval(id);
      setEstimateMs(null);
    };
  }, [isRunning, store]);

  if (!isRunning) return null;
  return estimateMs === null ? "Estimating time left…" : formatTimeLeft(estimateMs);
}
