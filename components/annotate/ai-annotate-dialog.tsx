"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";

type AiAnnotateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  imageId: string;
  labels: AnnotationLabel[];
  onDetected: (boxes: BoundingBox[]) => void;
};

const DEFAULT_CONFIDENCE = 0.4;

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
  const [confidence, setConfidence] = useState(DEFAULT_CONFIDENCE);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedLabelIds(new Set(labels.map((label) => label.id)));
      setConfidence(DEFAULT_CONFIDENCE);
      setError(null);
    }
    // Only reset when the dialog opens, not on every label list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleLabel(labelId: string) {
    setSelectedLabelIds((current) => {
      const next = new Set(current);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      return next;
    });
  }

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
        | { boxes?: BoundingBox[]; error?: string }
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
            below. Predictions are added to the canvas for you to review and
            edit — nothing is saved until you save changes.
          </DialogDescription>
        </DialogHeader>

        {labels.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Add at least one label in the Label tab before running AI
            annotation.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Labels to detect</Label>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {labels.map((label) => (
                  <li key={label.id}>
                    <label className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                      <Checkbox
                        checked={selectedLabelIds.has(label.id)}
                        onCheckedChange={() => toggleLabel(label.id)}
                      />
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      <span className="truncate">{label.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-annotate-confidence">
                Confidence threshold
              </Label>
              <Input
                id="ai-annotate-confidence"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={confidence}
                onChange={(event) =>
                  setConfidence(Number(event.target.value))
                }
              />
            </div>
          </div>
        )}

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
