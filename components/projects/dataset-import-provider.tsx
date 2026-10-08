"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { numberFormatter } from "@/lib/format";
import {
  createDatasetImportStore,
  isImportActive,
  type DatasetImportRun,
  type DatasetImportStore,
} from "@/lib/uploads/dataset-import";
import { cn } from "@/lib/utils";

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
 */
export function DatasetImportProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(createDatasetImportStore);
  return (
    <DatasetImportContext.Provider value={store}>
      {children}
      <UnloadGuard />
      <Suspense fallback={null}>
        <DatasetImportPills />
      </Suspense>
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

function useDatasetImportRuns() {
  const store = useDatasetImportStore();
  return useSyncExternalStore(store.subscribe, store.getRuns, () => noRuns);
}

/** Closing or reloading the tab would abandon the remaining uploads. */
function UnloadGuard() {
  const store = useDatasetImportStore();
  const isImporting = useSyncExternalStore(
    store.subscribe,
    () => Object.values(store.getRuns()).some((run) => isImportActive(run.state)),
    () => false,
  );

  useEffect(() => {
    if (!isImporting) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isImporting]);

  return null;
}

const workspacePath = /^\/projects\/[^/]+\/annotate(\/|$)/;

/**
 * A small link back to each import's project. Hidden on that project's page,
 * which shows its own banner, and in the annotation workspace, whose footer
 * occupies the bottom-right corner.
 */
function DatasetImportPills() {
  const runs = useDatasetImportRuns();
  const pathname = usePathname();
  if (workspacePath.test(pathname)) return null;
  const shown = Object.values(runs).filter((run) => pathname !== `/projects/${run.projectId}`);
  if (shown.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {shown.map((run) => <ImportPill key={run.id} run={run} />)}
    </div>
  );
}

function ImportPill({ run }: { run: DatasetImportRun }) {
  const { state } = run;
  const active = isImportActive(state);
  const Icon = active ? Loader2 : state.status === "completed" ? CheckCircle2 : AlertCircle;
  const label = active
    ? state.status === "resolving_labels"
      ? "Preparing import"
      : `Importing ${numberFormatter.format(state.completedImageCount)}/${numberFormatter.format(state.totalImageCount)}`
    : state.status === "completed"
      ? "Import complete"
      : state.status === "completed_with_errors"
        ? "Import finished with failures"
        : "Import failed";

  return (
    <Link
      href={`/projects/${run.projectId}`}
      className="flex max-w-80 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-sm shadow-lg backdrop-blur transition-colors hover:bg-accent"
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active && "animate-spin text-primary",
          state.status === "completed" && "text-emerald-600",
          (state.status === "completed_with_errors" || state.status === "failed") && "text-destructive",
        )}
        aria-hidden="true"
      />
      <span className="truncate">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground"> · {run.projectName}</span>
      </span>
    </Link>
  );
}
