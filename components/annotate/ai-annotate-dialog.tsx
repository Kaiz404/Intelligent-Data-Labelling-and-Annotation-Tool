"use client";

import { useEffect, useState } from "react";
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
import type {
  AnnotationLabel,
  AnnotationSuggestion,
} from "@/lib/types/annotations";

type AiAnnotateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  imageId: string;
  labels: AnnotationLabel[];
  onDetected: (suggestions: AnnotationSuggestion[]) => void;
};

export function AiAnnotateDialog({
  open,
  onOpenChange,
  projectId,
  imageId,
  labels,
  onDetected,
}: AiAnnotateDialogProps) {
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    new Set(),
  );
  const [confidence, setConfidence] = useState(DEFAULT_AI_CONFIDENCE);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedLabelIds(new Set(labels.map((label) => label.id)));
      setConfidence(DEFAULT_AI_CONFIDENCE);
      setError(null);
    }
    // Only reset when the dialog opens, not on every label list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleRun() {
    if (selectedLabelIds.size === 0) {
      setError("Select at least one label.");
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const response = await fetch("/api/annotations/auto-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          imageId,
          labelIds: Array.from(selectedLabelIds),
          confidence,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { boxes?: AnnotationSuggestion[]; error?: string }
        | null;

      if (!response.ok || !body) {
        throw new Error(body?.error ?? "AI annotation failed.");
      }

      onDetected(body.boxes ?? []);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI annotation failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>AI Annotate</DialogTitle>
          <DialogDescription>
            Detect bounding boxes for this image using the labels you select
            below. Predictions appear as dashed suggestions — accept the ones
            you want; nothing is saved until you do.
          </DialogDescription>
        </DialogHeader>

        <AiLabelOptions
          labels={labels}
          selectedLabelIds={selectedLabelIds}
          onSelectedLabelIdsChange={setSelectedLabelIds}
          confidence={confidence}
          onConfidenceChange={setConfidence}
          idPrefix="ai-annotate"
        />

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRunning}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleRun}
            disabled={isRunning || labels.length === 0}
          >
            {isRunning ? "Detecting..." : "Run AI Annotate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
