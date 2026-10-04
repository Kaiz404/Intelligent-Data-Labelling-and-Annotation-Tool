"use client";

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnnotationJobProgress } from "@/lib/types/annotations";

/** Compact progress chip for the project's bulk AI run, in the workspace footer. */
export function AiJobStatusChip({
  job,
  isActive,
  onCancel,
  onDismiss,
}: {
  job: AnnotationJobProgress;
  isActive: boolean;
  onCancel: () => Promise<void>;
  onDismiss: () => void;
}) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const { succeeded, failed, cancelled } = job.counts;
  const processed = succeeded + failed + cancelled;
  const summary = isActive
    ? `AI labelling ${processed}/${job.total} images`
    : job.status === "cancelled"
      ? `AI run cancelled · ${succeeded}/${job.total} labelled`
      : `AI labelling done · ${succeeded}/${job.total} images${failed > 0 ? ` · ${failed} failed` : ""}`;

  const handleCancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await onCancel();
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "Could not cancel the AI run.");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 py-0.5 pl-2.5 pr-1 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
      {isActive ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
      <span className="tabular-nums">{summary}</span>
      {cancelError ? (
        <span className="text-destructive" role="alert">{cancelError}</span>
      ) : null}
      {isActive ? (
        <Button type="button" variant="ghost" size="sm" className="h-6 rounded-full px-2 text-xs" disabled={isCancelling} onClick={() => void handleCancel()}>
          {isCancelling ? "Cancelling..." : "Cancel"}
        </Button>
      ) : (
        <Button type="button" variant="ghost" size="icon" className="size-6 rounded-full" aria-label="Dismiss AI run status" onClick={onDismiss}>
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
