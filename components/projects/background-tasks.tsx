"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, CirclePause, Loader2, X, type LucideIcon } from "lucide-react";
import {
  useDatasetImportActions,
  useDatasetImportRuns,
  useIsDatasetImporting,
} from "@/components/projects/dataset-import-provider";
import {
  useIsUploadingImages,
  useUploadQueueEntries,
} from "@/components/projects/image-upload-provider";
import { useUploadTimeLeft } from "@/hooks/use-upload-time-left";
import { numberFormatter } from "@/lib/format";
import { isImportActive, type DatasetImportRun } from "@/lib/uploads/dataset-import";
import { uploadPhase, type UploadQueueStore } from "@/lib/uploads/upload-queue";
import { cn } from "@/lib/utils";

/**
 * Dataset imports and image uploads that run in the background: a pill for
 * each, and a prompt before closing or reloading the tab mid-run. Mounted
 * once inside both providers.
 */
export function BackgroundTasks() {
  return (
    <>
      <UnloadGuard />
      <Suspense fallback={null}>
        <BackgroundTaskPills />
      </Suspense>
    </>
  );
}

/** Closing or reloading the tab would abandon the remaining uploads. */
function UnloadGuard() {
  const isImporting = useIsDatasetImporting();
  const isUploading = useIsUploadingImages();
  const isBusy = isImporting || isUploading;

  useEffect(() => {
    if (!isBusy) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isBusy]);

  return null;
}

const workspacePath = /^\/projects\/[^/]+\/annotate(\/|$)/;

/**
 * A small link back to each run's project. Hidden on that project's page,
 * which shows its own banner, and in the annotation workspace, whose footer
 * occupies the bottom-right corner.
 */
function BackgroundTaskPills() {
  const runs = useDatasetImportRuns();
  const uploads = useUploadQueueEntries();
  const pathname = usePathname();
  if (workspacePath.test(pathname)) return null;
  const elsewhere = ({ projectId }: { projectId: string }) => pathname !== `/projects/${projectId}`;
  const shownRuns = Object.values(runs).filter(elsewhere);
  const shownUploads = uploads.filter(elsewhere);
  if (shownRuns.length === 0 && shownUploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {shownRuns.map((run) => <ImportPill key={run.id} run={run} />)}
      {shownUploads.map(({ projectId, projectName, store }) => (
        <UploadPill key={projectId} projectId={projectId} projectName={projectName} store={store} />
      ))}
    </div>
  );
}

type TaskPillProps = {
  projectId: string;
  projectName: string;
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  /** Shown once the run has finished. */
  onDismiss?: () => void;
  dismissLabel: string;
};

function TaskPill({ projectId, projectName, icon: Icon, iconClassName, label, onDismiss, dismissLabel }: TaskPillProps) {
  return (
    <div className="flex max-w-96 items-center rounded-full border bg-background/95 text-sm shadow-lg backdrop-blur">
      <Link
        href={`/projects/${projectId}`}
        className="flex min-w-0 items-center gap-2 rounded-full px-3 py-1.5 transition-colors hover:bg-accent"
      >
        <Icon className={cn("size-4 shrink-0", iconClassName)} aria-hidden="true" />
        <span className="truncate">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground"> · {projectName}</span>
        </span>
      </Link>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mr-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={dismissLabel}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ImportPill({ run }: { run: DatasetImportRun }) {
  const { dismissDatasetImport } = useDatasetImportActions();
  const { state } = run;
  const active = isImportActive(state);
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
    <TaskPill
      projectId={run.projectId}
      projectName={run.projectName}
      icon={active ? Loader2 : state.status === "completed" ? CheckCircle2 : AlertCircle}
      iconClassName={
        active ? "animate-spin text-primary" : state.status === "completed" ? "text-emerald-600" : "text-destructive"
      }
      label={label}
      onDismiss={active ? undefined : () => dismissDatasetImport(run.projectId)}
      dismissLabel={`Dismiss import into ${run.projectName}`}
    />
  );
}

function UploadPill({
  projectId,
  projectName,
  store,
}: {
  projectId: string;
  projectName: string;
  store: UploadQueueStore;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const timeLeft = useUploadTimeLeft(store, snapshot.isRunning);
  const phase = uploadPhase(snapshot);
  if (phase === "idle") return null;

  const { counts, items } = snapshot;
  const progress = `${numberFormatter.format(counts.Completed)}/${numberFormatter.format(items.length)}`;
  const pill = {
    running: { icon: Loader2, iconClassName: "animate-spin text-primary", label: `Uploading ${progress} · ${timeLeft}` },
    paused: { icon: CirclePause, iconClassName: "text-muted-foreground", label: `Upload paused ${progress}` },
    finished: { icon: CheckCircle2, iconClassName: "text-emerald-600", label: "Upload complete" },
    failed: {
      icon: AlertCircle,
      iconClassName: "text-destructive",
      label: `Upload finished with ${numberFormatter.format(counts.Failed)} failed`,
    },
  }[phase];
  const done = phase === "finished" || phase === "failed";

  return (
    <TaskPill
      projectId={projectId}
      projectName={projectName}
      {...pill}
      onDismiss={done ? () => void store.cancelAll() : undefined}
      dismissLabel={`Dismiss upload to ${projectName}`}
    />
  );
}
