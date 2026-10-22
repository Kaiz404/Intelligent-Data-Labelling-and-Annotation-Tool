"use client";

import {
  ChevronDown,
  ImageIcon,
  Images,
  Loader2,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AnnotationJobProgress } from "@/lib/types/annotations";
import type { AiAnnotateScope } from "@/components/annotate/annotation-toolbar";
import { cn } from "@/lib/utils";

function processedCount(job: AnnotationJobProgress) {
  const { succeeded, failed, cancelled } = job.counts;
  return succeeded + failed + cancelled;
}

type AiAnnotateToolbarButtonProps = {
  onAiAnnotate: (scope: AiAnnotateScope) => void;
  /** Opens the AI Annotate dialog on the bulk-run progress view. */
  onOpenJobProgress: () => void;
  jobStatus?: {
    job: AnnotationJobProgress;
    isActive: boolean;
  } | null;
};

/** Split AI Annotate control; shows live bulk-run counts on the label while a run is tracked. */
export function AiAnnotateToolbarButton({
  onAiAnnotate,
  onOpenJobProgress,
  jobStatus,
}: AiAnnotateToolbarButtonProps) {
  const showProgress = Boolean(jobStatus);
  const processed = jobStatus ? processedCount(jobStatus.job) : 0;
  const total = jobStatus?.job.total ?? 0;

  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg bg-violet-600 text-white shadow-sm">
      <Button
        type="button"
        onClick={() => (showProgress ? onOpenJobProgress() : onAiAnnotate("current"))}
        className="relative h-9 min-w-0 gap-1.5 overflow-hidden rounded-none bg-transparent px-3 text-sm text-white shadow-none hover:bg-violet-700"
        aria-label={
          showProgress
            ? `AI labelling ${processed} of ${total} images. Open progress.`
            : "AI Annotate this image"
        }
      >
        {jobStatus?.isActive ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-0 bg-violet-800/45 transition-[width] duration-500 ease-out"
            style={{
              width: total > 0 ? `${Math.round((processed / total) * 100)}%` : "0%",
            }}
            aria-hidden
          />
        ) : null}
        <span className="relative z-[1] flex min-w-0 items-center gap-1.5">
          {jobStatus?.isActive ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
          ) : (
            <WandSparkles className="size-4 shrink-0" aria-hidden />
          )}
          <span className="truncate">
            AI Annotate
            {showProgress ? (
              <span className="tabular-nums opacity-90">
                {" "}
                · {processed}/{total}
              </span>
            ) : null}
          </span>
        </span>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            aria-label="AI Annotate options"
            className={cn(
              "h-9 w-8 rounded-none border-l border-white/25 bg-transparent px-0 text-white shadow-none hover:bg-violet-700 data-[state=open]:bg-violet-700",
            )}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-60">
          {showProgress ? (
            <DropdownMenuItem
              className="whitespace-nowrap"
              onSelect={onOpenJobProgress}
            >
              <Loader2 className="size-4" />
              View labelling progress
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className="whitespace-nowrap"
            onSelect={() => onAiAnnotate("current")}
          >
            <ImageIcon />
            Annotate this image
          </DropdownMenuItem>
          <DropdownMenuItem
            className="whitespace-nowrap"
            onSelect={() => onAiAnnotate("range")}
            disabled={jobStatus?.isActive}
          >
            <Images />
            Annotate multiple images…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
