"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createUploadQueueStore,
  type UploadQueueStore,
} from "@/lib/uploads/upload-queue";
import {
  createUploadRegistry,
  type UploadRegistry,
  type UploadRegistryEntry,
} from "@/lib/uploads/upload-registry";
import {
  UPLOAD_QUEUE_MAX_CONCURRENT_FILES,
  UPLOAD_QUEUE_MAX_IN_FLIGHT_BYTES,
} from "@/lib/uploads/types";
import { createUploadProvider } from "@/lib/uploads/uploader";

const ImageUploadContext = createContext<UploadRegistry<UploadQueueStore> | null>(null);
const noEntries: readonly UploadRegistryEntry<UploadQueueStore>[] = [];

function createImageUploadRegistry() {
  // One uploader for every project, so its upload policy and ThumbHash limits
  // are shared.
  const provider = createUploadProvider();
  return createUploadRegistry((projectId) =>
    createUploadQueueStore({
      provider,
      maxConcurrentFiles: UPLOAD_QUEUE_MAX_CONCURRENT_FILES,
      maxInFlightBytes: UPLOAD_QUEUE_MAX_IN_FLIGHT_BYTES,
      projectId,
    }),
  );
}

function useImageUploadRegistry() {
  const registry = useContext(ImageUploadContext);
  if (!registry) throw new Error("ImageUploadProvider is missing.");
  return registry;
}

/**
 * Owns image upload queues for the whole signed-in shell, so uploads keep
 * going after the dialog closes and while the user navigates between pages.
 * `BackgroundTasks` shows their pills and guards the tab.
 */
export function ImageUploadProvider({ children }: { children: React.ReactNode }) {
  const [registry] = useState(createImageUploadRegistry);
  return (
    <ImageUploadContext.Provider value={registry}>
      {children}
    </ImageUploadContext.Provider>
  );
}

/** The project's queue, created on first use. Does not subscribe to it. */
export function useProjectUploadQueue(projectId: string, projectName: string) {
  return useImageUploadRegistry().get(projectId, projectName);
}

export function useUploadQueueEntries() {
  const registry = useImageUploadRegistry();
  return useSyncExternalStore(registry.subscribe, registry.getEntries, () => noEntries);
}

export function useIsUploadingImages() {
  const registry = useImageUploadRegistry();
  return useSyncExternalStore(
    registry.subscribe,
    () => registry.getEntries().some(({ store }) => store.getSnapshot().isRunning),
    () => false,
  );
}
