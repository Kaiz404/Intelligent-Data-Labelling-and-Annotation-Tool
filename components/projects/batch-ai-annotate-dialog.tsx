"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AiLabelOptions,
  DEFAULT_AI_CONFIDENCE,
} from "@/components/annotate/ai-label-options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MAX_JOB_IMAGES } from "@/lib/annotations/job-config";
import type { AnnotationLabel, ImageAiState } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type Scope = "selected" | "new" | "all";

type BatchAiAnnotateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: AnnotationLabel[];
  /** All project image IDs, in grid order. */
  imageIds: string[];
  selectedImageIds: string[];
  aiStates: Record<string, ImageAiState>;
  onStart: (input: {
    imageIds: string[];
    labelIds: string[];
    confidence: number;
  }) => Promise<void>;
};

function hasBeenProcessed(state: ImageAiState | undefined) {
  return state?.status === "succeeded" || state?.pendingSuggestions;
}

export function BatchAiAnnotateDialog({
  open,
  onOpenChange,
  labels,
  imageIds,
  selectedImageIds,
  aiStates,
  onStart,
}: BatchAiAnnotateDialogProps) {
  const scopes = useMemo(() => {
    const selected = imageIds.filter((id) => selectedImageIds.includes(id));
    const fresh = imageIds.filter((id) => !hasBeenProcessed(aiStates[id]));
    return {
      selected: {
        ids: selected,
        title: "Selected images",
        hint: "Only the images you ticked in the grid.",
      },
      new: {
        ids: fresh,
        title: "Images not yet AI-annotated",
        hint: "Skips images that already have AI results.",
      },
      all: {
        ids: imageIds,
        title: "Entire project",
        hint: "Every image in this project.",
      },
    } satisfies Record<Scope, { ids: string[]; title: string; hint: string }>;
  }, [aiStates, imageIds, selectedImageIds]);

  const [scope, setScope] = useState<Scope>("all");
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [confidence, setConfidence] = useState(DEFAULT_AI_CONFIDENCE);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setScope(
      scopes.selected.ids.length > 0
        ? "selected"
        : scopes.new.ids.length > 0
          ? "new"
          : "all",
    );
    setSelectedLabelIds(new Set(labels.map((label) => label.id)));
    setConfidence(DEFAULT_AI_CONFIDENCE);
    setError(null);
    // Only reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const targetIds = scopes[scope].ids;
  const replacingCount = targetIds.filter(
    (id) => (aiStates[id]?.pendingSuggestions ?? 0) > 0,
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
        confidence,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the AI run.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI Annotate images</DialogTitle>
          <DialogDescription>
            AI suggests bounding boxes for many images at once. It runs in the
            background — keep working while it goes, then accept or reject
            suggestions image by image.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Images</Label>
          <div role="radiogroup" className="grid gap-2">
            {(Object.keys(scopes) as Scope[]).map((key) => {
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
                    disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      checked && "border-primary",
                    )}
                    aria-hidden
                  >
                    {checked ? (
                      <span className="size-2 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{option.title}</span>
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

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
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
      </DialogContent>
    </Dialog>
  );
}
