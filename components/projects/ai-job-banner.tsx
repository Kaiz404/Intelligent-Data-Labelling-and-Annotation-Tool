"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { AnnotationJobProgress } from "@/lib/types/annotations";

type AiJobBannerProps = {
  job: AnnotationJobProgress;
  /** Images (any run) still waiting for review, and where to start reviewing. */
  reviewImageCount: number;
  reviewHref: string | null;
  failedImageIds: string[];
  onCancel: () => Promise<void>;
  onRetryFailed: () => void;
};

/** Live progress for the project's AI run, then a call to review its results. */
export function AiJobBanner({
  job,
  reviewImageCount,
  reviewHref,
  failedImageIds,
  onCancel,
  onRetryFailed,
}: AiJobBannerProps) {
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const isActive = job.status === "queued" || job.status === "running";
  const processed = job.counts.succeeded + job.counts.failed;
  const percent = job.total > 0 ? Math.round((processed / job.total) * 100) : 0;

  if (isActive) {
    return (
      <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles className="size-5 animate-pulse text-violet-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              AI annotating images… {processed} of {job.total}
            </p>
            <p className="text-xs text-muted-foreground">
              Runs in the background — you can start reviewing finished images
              now.
              {job.counts.failed > 0 ? ` ${job.counts.failed} failed so far.` : ""}
            </p>
          </div>
          {reviewHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={reviewHref}>
                Review {reviewImageCount} ready
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isCancelling}
            onClick={async () => {
              setIsCancelling(true);
              try {
                await onCancel();
              } finally {
                setIsCancelling(false);
              }
            }}
          >
            {isCancelling ? "Cancelling..." : "Cancel"}
          </Button>
        </div>
        <Progress
          value={percent}
          className="h-1.5 bg-violet-100 dark:bg-violet-900 [&>[data-slot=progress-indicator]]:bg-violet-600"
        />
      </div>
    );
  }

  const hasFailures = failedImageIds.length > 0;
  if (dismissedJobId === job.id || (reviewImageCount === 0 && !hasFailures)) {
    return null;
  }

  const summary =
    job.status === "cancelled"
      ? `AI run cancelled after ${processed} of ${job.total} images.`
      : `AI run finished for ${job.total} image${job.total === 1 ? "" : "s"}.`;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/40">
      <Sparkles className="size-5 text-violet-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{summary}</p>
        <p className="text-xs text-muted-foreground">
          {reviewImageCount > 0
            ? `${reviewImageCount} image${reviewImageCount === 1 ? " has" : "s have"} suggestions waiting for review.`
            : "All suggestions have been reviewed."}
          {hasFailures ? ` ${failedImageIds.length} image${failedImageIds.length === 1 ? "" : "s"} failed.` : ""}
        </p>
      </div>
      {hasFailures ? (
        <Button type="button" size="sm" variant="outline" onClick={onRetryFailed}>
          Retry failed
        </Button>
      ) : null}
      {reviewHref ? (
        <Button
          asChild
          size="sm"
          className="bg-violet-600 text-white hover:bg-violet-700"
        >
          <Link href={reviewHref}>
            Review suggestions
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label="Dismiss"
        onClick={() => setDismissedJobId(job.id)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
