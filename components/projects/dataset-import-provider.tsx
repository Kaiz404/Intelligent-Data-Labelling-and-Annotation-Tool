"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createDatasetImportStore,
  isImportActive,
  type DatasetImportRun,
  type DatasetImportStore,
} from "@/lib/uploads/dataset-import";

const DatasetImportContext = createContext<DatasetImportStore | null>(null);
const noRuns: Readonly<Record<string, DatasetImportRun>> = {};

function useDatasetImportStore() {
  const store = useContext(DatasetImportContext);
  if (!store) throw new Error("DatasetImportProvider is missing.");
  return store;
}

/**
 * Owns dataset imports for the whole signed-in shell, so a run keeps going
 * after its dialog closes and while the user navigates between pages.
 * `BackgroundTasks` shows their pills and guards the tab.
 */
export function DatasetImportProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDatasetImportStore);
  return (
    <DatasetImportContext.Provider value={store}>
      {children}
    </DatasetImportContext.Provider>
  );
}

/** The project's current or finished-but-undismissed import. */
export function useDatasetImportRun(projectId: string): DatasetImportRun | undefined {
  const store = useDatasetImportStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getRuns()[projectId],
    () => undefined,
  );
}

export function useDatasetImportActions() {
  const store = useDatasetImportStore();
  return { startDatasetImport: store.start, dismissDatasetImport: store.dismiss };
}

export function useDatasetImportRuns() {
  const store = useDatasetImportStore();
  return useSyncExternalStore(store.subscribe, store.getRuns, () => noRuns);
}

export function useIsDatasetImporting() {
  const store = useDatasetImportStore();
  return useSyncExternalStore(
    store.subscribe,
    () => Object.values(store.getRuns()).some((run) => isImportActive(run.state)),
    () => false,
  );
}
