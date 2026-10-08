"use client";

import { AlertCircle, CheckCircle2, FileArchive, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { numberFormatter } from "@/lib/format";
import { isImportActive, type DatasetImportRun } from "@/lib/uploads/dataset-import";

type DatasetImportBannerProps = {
  run: DatasetImportRun;
  onViewDetails: () => void;
  onDismiss: () => void;
};

/** Progress of the project's dataset import, then its outcome until dismissed. */
export function DatasetImportBanner({ run, onViewDetails, onDismiss }: DatasetImportBannerProps) {
  const { state } = run;
  const active = isImportActive(state);
  const imported = numberFormatter.format(state.successfulImageCount);
  const total = numberFormatter.format(state.totalImageCount);
  const failed = numberFormatter.format(state.failedImageCount);
  const percent = state.totalImageCount > 0
    ? Math.round((state.completedImageCount / state.totalImageCount) * 100)
    : 0;

  const title = active
    ? state.status === "resolving_labels"
      ? `Preparing labels for ${run.fileName}…`
      : `Importing ${run.fileName}… ${imported} of ${total} images imported`
    : state.status === "failed"
      ? `Import of ${run.fileName} failed.`
      : `Imported ${imported} of ${total} images from ${run.fileName}.`;
  const detail = active
    ? `Runs in the background, so you can keep working. Images appear here as they finish.${
        state.failedImageCount > 0 ? ` ${failed} failed so far.` : ""
      }`
    : state.status === "failed"
      ? state.error ?? "An unexpected import error occurred."
      : state.status === "completed_with_errors"
        ? `${failed} image${state.failedImageCount === 1 ? "" : "s"} failed. View details for the errors.`
        : "All images and annotations were imported.";

  const Icon = active ? FileArchive : state.status === "completed" ? CheckCircle2 : AlertCircle;

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon
          className={
            active
              ? "size-5 animate-pulse text-primary"
              : state.status === "completed"
                ? "size-5 text-emerald-600"
                : "size-5 text-destructive"
          }
        />
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onViewDetails}>
          View details
        </Button>
        {active ? null : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Dismiss"
            onClick={onDismiss}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {active ? (
        <Progress value={percent} className="h-1.5" aria-label="Images imported" />
      ) : null}
    </div>
  );
}
