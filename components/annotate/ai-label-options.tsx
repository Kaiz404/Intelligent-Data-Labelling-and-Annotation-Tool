"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AnnotationLabel } from "@/lib/types/annotations";

export const DEFAULT_AI_CONFIDENCE = 0.4;

type AiLabelOptionsProps = {
  labels: AnnotationLabel[];
  selectedLabelIds: Set<string>;
  onSelectedLabelIdsChange: (next: Set<string>) => void;
  confidence: number;
  onConfidenceChange: (confidence: number) => void;
  idPrefix: string;
};

/** Label checklist + confidence threshold shared by the AI Annotate dialogs. */
export function AiLabelOptions({
  labels,
  selectedLabelIds,
  onSelectedLabelIdsChange,
  confidence,
  onConfidenceChange,
  idPrefix,
}: AiLabelOptionsProps) {
  if (labels.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Add at least one label in the annotation workspace&apos;s Label tab
        before running AI annotation.
      </p>
    );
  }

  const allSelected = selectedLabelIds.size === labels.length;

  function toggleLabel(labelId: string) {
    const next = new Set(selectedLabelIds);
    if (next.has(labelId)) {
      next.delete(labelId);
    } else {
      next.add(labelId);
    }
    onSelectedLabelIdsChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Labels to detect</Label>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() =>
              onSelectedLabelIdsChange(
                allSelected ? new Set() : new Set(labels.map((label) => label.id)),
              )
            }
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>
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
        <Label htmlFor={`${idPrefix}-confidence`}>Confidence threshold</Label>
        <Input
          id={`${idPrefix}-confidence`}
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => onConfidenceChange(Number(event.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Lower finds more objects but also more false positives.
        </p>
      </div>
    </div>
  );
}
