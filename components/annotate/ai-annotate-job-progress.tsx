"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { thumbhashColor } from "@/lib/image-placeholder";
import type {
  AnnotationJobItemStatus,
  AnnotationJobProgress,
  ImageAiState,
} from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

export type BulkJobStatus = {
  job: AnnotationJobProgress;
  isActive: boolean;
  imageIds: string[];
  aiStates: Record<string, ImageAiState>;
  onCancel: () => Promise<void>;
  onDismiss: () => void;
  onReviewImage: (imageId: string) => void;
};

function statusLabel(
  status: AnnotationJobItemStatus,
  pendingSuggestions: number,
) {
  switch (status) {
    case "queued":
      return "Waiting";
    case "running":
      return "Detecting…";
    case "succeeded":
      return pendingSuggestions > 0
        ? `${pendingSuggestions} to review`
        : "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function StatusIcon({
  status,
  pendingSuggestions,
}: {
  status: AnnotationJobItemStatus;
  pendingSuggestions: number;
}) {
  if (status === "running") {
    return <Loader2 className="size-4 shrink-0 animate-spin text-violet-600" />;
  }
  if (status === "failed") {
    return <AlertCircle className="size-4 shrink-0 text-destructive" />;
  }
  if (status === "succeeded" && pendingSuggestions > 0) {
    return <Sparkles className="size-4 shrink-0 text-violet-600" />;
  }
  if (status === "succeeded") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />;
  }
  return <CircleDashed className="size-4 shrink-0 text-muted-foreground" />;
}

function processedCount(job: AnnotationJobProgress) {
  const { succeeded, failed, cancelled } = job.counts;
  return succeeded + failed + cancelled;
}

/** Bulk-run progress shown inside the AI Annotate dialog. */
export function AiAnnotateJobProgress({
  bulkJob,
  images,
  onClose,
}: {
  bulkJob: BulkJobStatus;
  images: ProjectImage[];
  onClose: () => void;
}) {
  const { job, isActive, aiStates, onCancel, onDismiss, onReviewImage } =
    bulkJob;
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [resolvedImageIds, setResolvedImageIds] = useState<string[]>(
    bulkJob.imageIds,
  );

  useEffect(() => {
    setResolvedImageIds(bulkJob.imageIds);
  }, [bulkJob.imageIds]);

  useEffect(() => {
    if (resolvedImageIds.length > 0 || !job.id) return;
    let cancelled = false;
    void fetch(`/api/annotations/jobs/${job.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          updates?: Array<{ imageId: string }>;
        };
      })
      .then((body) => {
        if (cancelled || !body?.updates?.length) return;
        setResolvedImageIds(body.updates.map((row) => row.imageId));
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, resolvedImageIds.length]);

  const rows = useMemo(() => {
    const byId = new Map(images.map((image) => [image.id, image]));
    return resolvedImageIds
      .map((id) => {
        const image = byId.get(id);
        if (!image) return null;
        const state = aiStates[id] ?? {
          status: "queued" as const,
          pendingSuggestions: 0,
        };
        return { image, state };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [aiStates, images, resolvedImageIds]);

  const processed = processedCount(job);
  const progressValue =
    job.total > 0 ? Math.round((processed / job.total) * 100) : 0;
  const pendingReview = job.pendingSuggestions;
  const reviewable = rows.filter((row) => row.state.pendingSuggestions > 0);

  const handleCancel = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await onCancel();
    } catch (error) {
      setCancelError(
        error instanceof Error ? error.message : "Could not cancel the AI run.",
      );
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium tabular-nums">
            {processed} of {job.total} images processed
          </span>
          <span className="text-muted-foreground tabular-nums">{progressValue}%</span>
        </div>
        <Progress value={progressValue} className="h-2" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {job.counts.running > 0 ? (
            <span>{job.counts.running} detecting</span>
          ) : null}
          {job.counts.queued > 0 ? (
            <span>{job.counts.queued} waiting</span>
          ) : null}
          {job.counts.succeeded > 0 ? (
            <span>{job.counts.succeeded} succeeded</span>
          ) : null}
          {job.counts.failed > 0 ? (
            <span className="text-destructive">{job.counts.failed} failed</span>
          ) : null}
          {pendingReview > 0 ? (
            <span className="text-violet-700 dark:text-violet-300">
              {pendingReview} suggestions awaiting review
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Images in this run</h3>
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
          {rows.length === 0 ? (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              Loading image list…
            </li>
          ) : (
            rows.map(({ image, state }) => {
              const canReview = state.pendingSuggestions > 0;
              return (
                <li key={image.id}>
                  <button
                    type="button"
                    disabled={!canReview}
                    onClick={() => onReviewImage(image.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors",
                      canReview
                        ? "hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500/40 dark:hover:bg-violet-950/40"
                        : "opacity-80",
                    )}
                  >
                    <span
                      className="size-9 shrink-0 overflow-hidden rounded border bg-muted"
                      style={{ backgroundColor: thumbhashColor(image.thumbhash) }}
                    >
                      {image.url ? (
                        <img
                          src={image.url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {image.fileName}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <StatusIcon
                          status={state.status}
                          pendingSuggestions={state.pendingSuggestions}
                        />
                        {statusLabel(state.status, state.pendingSuggestions)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {reviewable.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Open an image with suggestions to review dashed boxes on the canvas,
          then accept or reject them.
        </p>
      ) : isActive ? (
        <p className="text-xs text-muted-foreground">
          Suggestions appear on each image as detection finishes. You can leave
          this dialog open to watch progress.
        </p>
      ) : null}

      {cancelError ? (
        <p className="text-sm text-destructive" role="alert">{cancelError}</p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        {isActive ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isCancelling}
            onClick={() => void handleCancel()}
          >
            {isCancelling ? "Cancelling…" : "Cancel run"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              onDismiss();
              onClose();
            }}
          >
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

export function bulkJobDialogTitle(bulkJob: BulkJobStatus | null) {
  if (!bulkJob) return null;
  return bulkJob.isActive ? "AI labelling in progress" : "AI labelling finished";
}
