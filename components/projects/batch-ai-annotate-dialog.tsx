"use client";

import { useMemo, useState } from "react";
import {
  AiLabelOptions,
  DEFAULT_AI_CONFIDENCE
} from "@/components/annotate/ai-label-options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  type BatchScope,
  defaultBatchScope,
  resolveBatchScopes
} from "@/lib/annotations/batch-scopes";
import { MAX_JOB_IMAGES } from "@/lib/annotations/job-config";
import type { AnnotationLabel, ImageAiState } from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

type BatchAiAnnotateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: AnnotationLabel[];
  /** All project images, in grid order. */
  images: Pick<ProjectImage, "id" | "status">[];
  selectedImageIds: string[];
  aiStates: Record<string, ImageAiState>;
  onStart: (input: {
    imageIds: string[];
    labelIds: string[];
    confidence: number;
  }) => Promise<void>;
};

export function BatchAiAnnotateDialog({
  open,
  onOpenChange,
  ...props
}: BatchAiAnnotateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>AI Annotate images</DialogTitle>
          <DialogDescription>
            AI suggests bounding boxes for many images at once. It runs in the
            background — keep working while it goes, then accept or reject
            suggestions image by image.
          </DialogDescription>
        </DialogHeader>

        <BatchAiAnnotateForm onOpenChange={onOpenChange} {...props} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounts with the dialog content, so each open starts from the current selection. */
function BatchAiAnnotateForm({
  onOpenChange,
  labels,
  images,
  selectedImageIds,
  aiStates,
  onStart
}: Omit<BatchAiAnnotateDialogProps, "open">) {
  const scopeIds = useMemo(
    () => resolveBatchScopes(images, selectedImageIds, aiStates),
    [aiStates, images, selectedImageIds]
  );
  const scopes = {
    selected: {
      ids: scopeIds.selected,
      title: "Selected images",
      hint: "Only the images you ticked in the grid."
    },
    unannotated: {
      ids: scopeIds.unannotated,
      title: "Unannotated images",
      hint: "Skips images with saved boxes or AI suggestions to review."
    },
    all: {
      ids: scopeIds.all,
      title: "Entire project",
      hint: "Every image in this project."
    }
  } satisfies Record<BatchScope, { ids: string[]; title: string; hint: string }>;

  const [scope, setScope] = useState<BatchScope>(() =>
    defaultBatchScope(scopeIds)
  );
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    () => new Set(labels.map((label) => label.id))
  );
  const [confidence, setConfidence] = useState(DEFAULT_AI_CONFIDENCE);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetIds = scopes[scope].ids;
  const replacingCount = targetIds.filter(
    (id) => (aiStates[id]?.pendingSuggestions ?? 0) > 0
  ).length;
  const tooMany = targetIds.length > MAX_JOB_IMAGES;

  async function handleStart() {
    if (selectedLabelIds.size === 0) {
      setError("Select at least one label.");
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      await onStart({
        imageIds: targetIds,
        labelIds: Array.from(selectedLabelIds),
        confidence
      });
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the AI run."
      );
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pl-1 pr-2">
        <div className="space-y-2">
          <Label>Images</Label>
          <div role="radiogroup" className="grid gap-2">
            {(Object.keys(scopes) as BatchScope[]).map((key) => {
              const option = scopes[key];
              const disabled = option.ids.length === 0;
              const checked = scope === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  disabled={disabled}
                  onClick={() => setScope(key)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    checked
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-muted",
                    disabled &&
                      "cursor-not-allowed opacity-50 hover:bg-transparent"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      checked && "border-primary"
                    )}
                    aria-hidden
                  >
                    {checked ? (
                      <span className="size-2 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {option.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {option.ids.length}
                  </span>
                </button>
              );
            })}
          </div>
          {replacingCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {replacingCount} of these images still have unreviewed
              suggestions; new results will replace them.
            </p>
          ) : null}
          {tooMany ? (
            <p className="text-xs text-destructive">
              One run can include at most {MAX_JOB_IMAGES} images. Select a
              smaller set, or run the rest afterwards.
            </p>
          ) : null}
        </div>

        <AiLabelOptions
          labels={labels}
          selectedLabelIds={selectedLabelIds}
          onSelectedLabelIdsChange={setSelectedLabelIds}
          confidence={confidence}
          onConfidenceChange={setConfidence}
          idPrefix="batch-ai-annotate"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <DialogFooter className="shrink-0 gap-2 border-t pt-4 sm:gap-0">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={isStarting}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleStart}
          disabled={
            isStarting ||
            labels.length === 0 ||
            targetIds.length === 0 ||
            tooMany
          }
          className="bg-violet-600 text-white hover:bg-violet-700"
        >
          {isStarting
            ? "Starting..."
            : `Annotate ${targetIds.length} image${targetIds.length === 1 ? "" : "s"}`}
        </Button>
      </DialogFooter>
    </div>
  );
}
