"use client";

import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type SuggestionReviewBarProps = {
  pendingCount: number;
  /** Other images in this project that still have suggestions to review. */
  otherImagesToReview: number;
  selectedIsSuggestion: boolean;
  isSaving: boolean;
  error: string | null;
  onAcceptSelected: () => void;
  onRejectSelected: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptAllAndNext: () => void;
  onNextToReview: () => void;
};

/**
 * Review strip above the canvas for AI suggestions (dashed boxes). The fast
 * path is "Accept all & next": adjust or reject the few wrong boxes, then
 * accept the rest, save, and jump to the next image waiting for review.
 */
export function SuggestionReviewBar({
  pendingCount,
  otherImagesToReview,
  selectedIsSuggestion,
  isSaving,
  error,
  onAcceptSelected,
  onRejectSelected,
  onAcceptAll,
  onRejectAll,
  onAcceptAllAndNext,
  onNextToReview,
}: SuggestionReviewBarProps) {
  if (pendingCount === 0 && otherImagesToReview === 0) {
    return null;
  }

  if (pendingCount === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900 dark:bg-violet-950/40">
        <Sparkles className="size-5 text-violet-600" />
        <p className="min-w-0 flex-1 text-sm">
          Nothing left to review on this image.{" "}
          <span className="text-muted-foreground">
            {otherImagesToReview} more image
            {otherImagesToReview === 1 ? " has" : "s have"} AI suggestions.
          </span>
          {error ? (
            <span className="block text-xs text-destructive">{error}</span>
          ) : null}
        </p>
        <Button
          type="button"
          size="sm"
          className="bg-violet-600 text-white hover:bg-violet-700"
          disabled={isSaving}
          onClick={onNextToReview}
        >
          {isSaving ? "Saving..." : "Save & review next"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900 dark:bg-violet-950/40">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 text-violet-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {pendingCount} AI suggestion{pendingCount === 1 ? "" : "s"} to
            review
          </p>
          <p className="text-xs text-muted-foreground">
            Dashed boxes are suggestions. Drag or relabel one to accept it,
            delete wrong ones, then accept the rest.
            {otherImagesToReview > 0
              ? ` ${otherImagesToReview} more image${otherImagesToReview === 1 ? "" : "s"} to go.`
              : ""}
          </p>
        </div>
        {selectedIsSuggestion ? (
          <div className="flex items-center gap-1 border-r pr-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-emerald-700 hover:text-emerald-700"
              onClick={onAcceptSelected}
            >
              <Check className="size-4" />
              Accept box
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onRejectSelected}
            >
              <X className="size-4" />
              Reject box
            </Button>
          </div>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onRejectAll}>
          Reject all
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onAcceptAll}>
          Accept all
        </Button>
        <Button
          type="button"
          size="sm"
          className="bg-violet-600 text-white hover:bg-violet-700"
          disabled={isSaving}
          onClick={onAcceptAllAndNext}
        >
          {isSaving
            ? "Saving..."
            : otherImagesToReview > 0
              ? "Accept all & next"
              : "Accept all & save"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
