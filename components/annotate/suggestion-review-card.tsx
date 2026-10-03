"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnnotationLabel } from "@/lib/types/annotations";

type ReviewSuggestion = { id: string; labelId: string; confidence: number };

type SuggestionReviewCardProps = {
  /** Pending suggestions on this image, in display order. */
  suggestions: ReviewSuggestion[];
  labels: AnnotationLabel[];
  selectedBoxId: string | null;
  /** Other images in this project that still have suggestions to review. */
  otherImagesToReview: number;
  isSaving: boolean;
  error: string | null;
  onSelect: (boxId: string) => void;
  /** Relabel a suggestion; the box stays a pending suggestion. */
  onChangeLabel: (boxId: string, labelId: string) => void;
  onCreateLabel: (name: string) => Promise<AnnotationLabel>;
  /** Reject one suggestion. */
  onDeleteSelected: (boxId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  /** Accept all, save, and open the next image awaiting review. */
  onAcceptAllAndNext: () => void;
  /** Nothing pending here: save and open the next image awaiting review. */
  onNextToReview: () => void;
};

const CREATE_LABEL_VALUE = "__create-label__";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const primaryButtonClass =
  "w-full bg-violet-600 text-white hover:bg-violet-700 focus-visible:ring-violet-500/40";

/**
 * Floating review card for AI suggestions (dashed boxes): step through
 * detections, relabel or delete one, then add or discard the rest. Keeps the
 * cross-image review queue ("Add & review next"). Placement is up to the
 * parent; the card can be minimised to a pill to get it out of the way.
 */
export function SuggestionReviewCard({
  suggestions,
  labels,
  selectedBoxId,
  otherImagesToReview,
  isSaving,
  error,
  onSelect,
  onChangeLabel,
  onCreateLabel,
  onDeleteSelected,
  onAcceptAll,
  onRejectAll,
  onAcceptAllAndNext,
  onNextToReview,
}: SuggestionReviewCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pendingCount = suggestions.length;

  // Re-open when new suggestions arrive (a new AI run or another image).
  const suggestionKey = suggestions.map((suggestion) => suggestion.id).join("\n");
  const [previousKey, setPreviousKey] = useState(suggestionKey);
  if (suggestionKey !== previousKey) {
    const previousIds = new Set(previousKey ? previousKey.split("\n") : []);
    setPreviousKey(suggestionKey);
    if (suggestions.some((suggestion) => !previousIds.has(suggestion.id))) {
      setCollapsed(false);
    }
  }

  if (pendingCount === 0 && otherImagesToReview === 0) {
    return null;
  }

  if (collapsed) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setCollapsed(false)}
        className="ml-auto flex w-fit items-center gap-2 rounded-full bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-lg transition-colors outline-none hover:bg-violet-700 focus-visible:ring-[3px] focus-visible:ring-violet-500/40"
      >
        <Sparkles className="size-4" aria-hidden />
        {pendingCount > 0
          ? `Review ${plural(pendingCount, "suggestion")}`
          : `${plural(otherImagesToReview, "image")} to review`}
        <ChevronDown className="size-4" aria-hidden />
      </button>
    );
  }

  const minimiseButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="-mt-1 -mr-1 shrink-0 text-muted-foreground"
      aria-expanded
      aria-label="Minimise AI review"
      title="Minimise"
      onClick={() => setCollapsed(true)}
    >
      <ChevronUp />
    </Button>
  );

  const errorMessage = error ? (
    <p className="text-xs text-destructive" role="alert">
      {error}
    </p>
  ) : null;

  if (pendingCount === 0) {
    return (
      <section
        aria-label="Review AI suggestions"
        className="w-full space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
      >
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            Nothing left to review on this image.{" "}
            <span className="text-muted-foreground">
              {plural(otherImagesToReview, "more image")}{" "}
              {otherImagesToReview === 1 ? "has" : "have"} AI suggestions.
            </span>
          </p>
          {minimiseButton}
        </div>
        <Button
          type="button"
          className={primaryButtonClass}
          disabled={isSaving}
          onClick={onNextToReview}
        >
          {isSaving ? "Saving..." : "Save & review next"}
          <ArrowRight aria-hidden />
        </Button>
        {errorMessage}
      </section>
    );
  }

  const selectedIndex = suggestions.findIndex(
    (suggestion) => suggestion.id === selectedBoxId,
  );
  const selected = selectedIndex >= 0 ? suggestions[selectedIndex] : null;

  function step(direction: 1 | -1) {
    const nextIndex =
      selectedIndex < 0
        ? direction === 1
          ? 0
          : pendingCount - 1
        : (selectedIndex + direction + pendingCount) % pendingCount;
    onSelect(suggestions[nextIndex].id);
  }

  function handleDeleteSelected() {
    if (!selected) return;
    // Move on to the next detection so review keeps flowing.
    const next =
      pendingCount > 1 ? suggestions[(selectedIndex + 1) % pendingCount] : null;
    onDeleteSelected(selected.id);
    if (next) onSelect(next.id);
  }

  return (
    <section
      aria-label="Review AI suggestions"
      className="w-full space-y-3 rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base leading-tight font-medium">
            Review AI Suggestions
          </h2>
          <p className="mt-1.5 text-sm">
            {plural(pendingCount, "suggestion")}
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
            Not saved
          </p>
        </div>
        {minimiseButton}
      </div>

      <p className="text-xs text-muted-foreground">
        Select a box to change its label or delete it. Drag to move; drag a
        corner to resize (adjusted boxes are added as annotations).
      </p>

      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm" aria-live="polite">
          {selected ? (
            <>
              Detection {selectedIndex + 1} of {pendingCount}
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums"
                title="Model confidence"
              >
                {Math.round(selected.confidence * 100)}%
              </span>
            </>
          ) : (
            "Select a detection"
          )}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous detection"
            onClick={() => step(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next detection"
            onClick={() => step(1)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {selected ? (
        <>
          <SuggestionClassField
            key={selected.id}
            suggestion={selected}
            labels={labels}
            onChangeLabel={onChangeLabel}
            onCreateLabel={onCreateLabel}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={isSaving}
            onClick={handleDeleteSelected}
          >
            <Trash2 aria-hidden />
            Delete Selected Box
          </Button>
        </>
      ) : null}

      <div className="space-y-2">
        <Button
          type="button"
          className={primaryButtonClass}
          disabled={isSaving}
          onClick={onAcceptAll}
        >
          Add {plural(pendingCount, "Annotation")}
        </Button>
        {otherImagesToReview > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="w-full border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
            disabled={isSaving}
            onClick={onAcceptAllAndNext}
          >
            {isSaving
              ? "Saving..."
              : `Add & review next (${otherImagesToReview} more)`}
            <ArrowRight aria-hidden />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={isSaving}
          onClick={onRejectAll}
        >
          Discard Suggestions
        </Button>
      </div>

      {errorMessage}
    </section>
  );
}

/**
 * "Class" select for the selected suggestion, with an inline "Create label…"
 * form. Keyed by suggestion ID so the form resets when the selection changes.
 */
function SuggestionClassField({
  suggestion,
  labels,
  onChangeLabel,
  onCreateLabel,
}: {
  suggestion: ReviewSuggestion;
  labels: AnnotationLabel[];
  onChangeLabel: (boxId: string, labelId: string) => void;
  onCreateLabel: (name: string) => Promise<AnnotationLabel>;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectId = useId();
  const inputId = useId();

  // Focus after the Select popover has closed and returned focus.
  useEffect(() => {
    if (!isCreating) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isCreating]);

  const hasLabel = labels.some((label) => label.id === suggestion.labelId);

  function closeForm() {
    setIsCreating(false);
    setName("");
    setError(null);
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a class name.");
      return;
    }

    const existing = labels.find(
      (label) => label.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      onChangeLabel(suggestion.id, existing.id);
      closeForm();
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const label = await onCreateLabel(trimmed);
      onChangeLabel(suggestion.id, label.id);
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the label.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCreating) {
    return (
      <div className="space-y-2 rounded-md border bg-muted/50 p-2.5">
        <Label htmlFor={inputId} className="text-xs">
          Class Name
        </Label>
        <Input
          ref={inputRef}
          id={inputId}
          value={name}
          placeholder="e.g. people"
          disabled={isSubmitting}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape" && !isSubmitting) {
              event.preventDefault();
              closeForm();
            }
          }}
          className="h-8 bg-background"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={closeForm}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isSubmitting || !name.trim()}
            onClick={() => void submit()}
          >
            {isSubmitting ? "Adding..." : "Add"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={selectId}>Class</Label>
      <Select
        value={hasLabel ? suggestion.labelId : ""}
        onValueChange={(value) => {
          if (value === CREATE_LABEL_VALUE) {
            setIsCreating(true);
          } else {
            onChangeLabel(suggestion.id, value);
          }
        }}
      >
        <SelectTrigger id={selectId} className="w-full">
          <SelectValue placeholder="Select label" />
        </SelectTrigger>
        <SelectContent position="popper">
          {labels.map((label) => (
            <SelectItem key={label.id} value={label.id}>
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
                aria-hidden
              />
              {label.name}
            </SelectItem>
          ))}
          {labels.length > 0 ? <SelectSeparator /> : null}
          <SelectItem value={CREATE_LABEL_VALUE}>
            <Plus aria-hidden />
            Create label…
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
