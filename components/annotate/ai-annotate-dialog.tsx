"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  ScanSearch,
} from "lucide-react";
import { DEFAULT_AI_CONFIDENCE } from "@/components/annotate/ai-label-options";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_JOB_IMAGES } from "@/lib/annotations/job-config";
import { thumbhashColor } from "@/lib/image-placeholder";
import type {
  AnnotationLabel,
  AnnotationSuggestion,
} from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

type Scope = "current" | "range";

type AiAnnotateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentImageId: string;
  /** Project images in display order, for the range picker. */
  images: ProjectImage[];
  labels: AnnotationLabel[];
  /** Scope preselected each time the dialog opens. Defaults to "current". */
  initialScope?: Scope;
  /** Creates a project label; the dialog then selects it for detection. */
  onCreateLabel: (name: string) => Promise<AnnotationLabel>;
  /** Results for the current image, shown on the canvas as suggestions. */
  onDetected: (suggestions: AnnotationSuggestion[]) => void;
  /** Queues a background run over a range of images (the workspace tracks it). */
  onStartJob: (input: {
    imageIds: string[];
    labelIds: string[];
    confidence: number;
  }) => Promise<void>;
};

const MODEL_ID = "roboflow-zero-shot";

const SCOPE_OPTIONS: Array<{ value: Scope; title: string; hint: string }> = [
  {
    value: "current",
    title: "Annotate the current image",
    hint: "Run AI on the image you're currently viewing",
  },
  {
    value: "range",
    title: "Annotate a range of images",
    hint: "Run AI on multiple images in this project",
  },
];

function formatConfidence(value: number) {
  return String(Math.round(value * 100) / 100);
}

/** A 0..1 confidence from the number input, or null while it is invalid. */
function parseConfidence(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 1
    ? parsed
    : null;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "Annotation Assist": runs the zero-shot detector on the current image
 * (results return as canvas suggestions) or queues a background run over a
 * range of project images (results arrive as suggestions to review per image).
 */
export function AiAnnotateDialog({
  open,
  onOpenChange,
  projectId,
  currentImageId,
  images,
  labels,
  initialScope = "current",
  onCreateLabel,
  onDetected,
  onStartJob,
}: AiAnnotateDialogProps) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    () => new Set([currentImageId]),
  );
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
    () => new Set(labels.map((label) => label.id)),
  );
  const [confidence, setConfidence] = useState(DEFAULT_AI_CONFIDENCE);
  const [confidenceDraft, setConfidenceDraft] = useState(
    formatConfidence(DEFAULT_AI_CONFIDENCE),
  );
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [isCreatingClass, setIsCreatingClass] = useState(false);
  const [classError, setClassError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Reset to a fresh form every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setScope(initialScope);
      setSelectedImageIds(new Set([currentImageId]));
      setAnchorIndex(null);
      setSelectedLabelIds(new Set(labels.map((label) => label.id)));
      setConfidence(DEFAULT_AI_CONFIDENCE);
      setConfidenceDraft(formatConfidence(DEFAULT_AI_CONFIDENCE));
      setIsAddingClass(false);
      setNewClassName("");
      setClassError(null);
      setError(null);
      setNotice(null);
    }
  }

  // Bring the current image into view when the range picker appears.
  useEffect(() => {
    if (!open || scope !== "range") {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const strip = stripRef.current;
      const thumb = strip?.querySelector<HTMLElement>(
        `[data-image-id="${CSS.escape(currentImageId)}"]`,
      );
      if (strip && thumb) {
        strip.scrollLeft =
          thumb.offsetLeft - (strip.clientWidth - thumb.clientWidth) / 2;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentImageId, open, scope]);

  const labelIds = labels
    .filter((label) => selectedLabelIds.has(label.id))
    .map((label) => label.id);
  const allLabelsSelected =
    labels.length > 0 && labelIds.length === labels.length;

  const selectedIndices = images.flatMap((image, index) =>
    selectedImageIds.has(image.id) ? [index] : [],
  );
  const rangeImageIds = selectedIndices.map((index) => images[index].id);
  const rangeCount = rangeImageIds.length;
  const firstIndex = selectedIndices[0];
  const lastIndex = selectedIndices[rangeCount - 1];
  const rangeSuffix =
    rangeCount === 1
      ? ` (${firstIndex + 1})`
      : rangeCount > 1 && lastIndex - firstIndex === rangeCount - 1
        ? ` (${firstIndex + 1} - ${lastIndex + 1})`
        : "";
  const tooManyImages = rangeCount > MAX_JOB_IMAGES;

  const canRun =
    !isRunning &&
    labelIds.length > 0 &&
    (scope === "current" || (rangeCount > 0 && !tooManyImages));

  function handleOpenChange(next: boolean) {
    // Keep the dialog up while a request is in flight so its result lands
    // on the image it was started for.
    if (!next && isRunning) {
      return;
    }
    onOpenChange(next);
  }

  function handleThumbnailClick(index: number, extendRange: boolean) {
    const image = images[index];
    const select = !selectedImageIds.has(image.id);
    const next = new Set(selectedImageIds);
    const [from, to] =
      extendRange && anchorIndex !== null
        ? [Math.min(anchorIndex, index), Math.max(anchorIndex, index)]
        : [index, index];
    for (let position = from; position <= to; position += 1) {
      if (select) {
        next.add(images[position].id);
      } else {
        next.delete(images[position].id);
      }
    }
    setSelectedImageIds(next);
    setAnchorIndex(index);
  }

  function scrollStrip(direction: 1 | -1) {
    const strip = stripRef.current;
    if (strip) {
      strip.scrollBy({
        left: direction * strip.clientWidth * 0.8,
        behavior: "smooth",
      });
    }
  }

  function toggleLabel(labelId: string) {
    const next = new Set(selectedLabelIds);
    if (next.has(labelId)) {
      next.delete(labelId);
    } else {
      next.add(labelId);
    }
    setSelectedLabelIds(next);
  }

  function handleConfidenceDraftChange(value: string) {
    setConfidenceDraft(value);
    const parsed = parseConfidence(value);
    if (parsed !== null) {
      setConfidence(parsed);
    }
  }

  function cancelAddClass() {
    setIsAddingClass(false);
    setNewClassName("");
    setClassError(null);
  }

  async function handleAddClass() {
    const name = newClassName.trim();
    if (!name) {
      setClassError("Enter a class name.");
      return;
    }

    const existing = labels.find(
      (label) => label.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      setSelectedLabelIds((current) => new Set(current).add(existing.id));
      cancelAddClass();
      return;
    }

    setIsCreatingClass(true);
    setClassError(null);
    try {
      const label = await onCreateLabel(name);
      setSelectedLabelIds((current) => new Set(current).add(label.id));
      cancelAddClass();
    } catch (err) {
      setClassError(err instanceof Error ? err.message : "Could not add the class.");
    } finally {
      setIsCreatingClass(false);
    }
  }

  async function runCurrentImage() {
    const response = await fetch("/api/annotations/auto-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        imageId: currentImageId,
        labelIds,
        confidence,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | { boxes?: AnnotationSuggestion[]; error?: string }
      | null;

    if (!response.ok || !body) {
      throw new Error(body?.error ?? "AI annotation failed.");
    }

    const boxes = body.boxes ?? [];
    if (boxes.length === 0) {
      setNotice(
        `No objects found above ${Math.round(confidence * 100)}% confidence. ` +
          "Try a lower threshold or different label names.",
      );
      return;
    }

    onDetected(boxes);
    onOpenChange(false);
  }

  async function runRange() {
    await onStartJob({ imageIds: rangeImageIds, labelIds, confidence });
    onOpenChange(false);
  }

  async function handleRun() {
    if (labelIds.length === 0) {
      setError("Select at least one label.");
      return;
    }
    if (scope === "range" && rangeCount === 0) {
      setError("Select at least one image.");
      return;
    }

    setIsRunning(true);
    setError(null);
    setNotice(null);
    try {
      if (scope === "current") {
        await runCurrentImage();
      } else {
        await runRange();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : scope === "current"
            ? "AI annotation failed."
            : "Could not start the AI run.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  const runLabel =
    scope === "current"
      ? "Label with AI"
      : `Label ${plural(rangeCount, "image")} with AI`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          // Escape leaves the inline "Add Class" input before the dialog.
          if (isAddingClass) {
            event.preventDefault();
            if (!isCreatingClass) {
              cancelAddClass();
            }
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Annotation Assist</DialogTitle>
          <DialogDescription>
            {scope === "current"
              ? "Use AI to detect and label objects in this image."
              : "Use AI to detect and label objects across multiple images."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-5">
          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            <p>
              AI will suggest labels. Please review and adjust the results
              before saving.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-annotate-model">Model</Label>
            <Select defaultValue={MODEL_ID} disabled={isRunning}>
              <SelectTrigger id="ai-annotate-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MODEL_ID}>
                  <span className="flex size-5 items-center justify-center rounded-full bg-violet-600">
                    <ScanSearch className="size-3 text-white" aria-hidden />
                  </span>
                  Roboflow zero-shot (Boxes)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Zero-shot detector: it looks for objects matching the names of
              the labels selected below, so no training is needed. Clear,
              specific label names work best.
            </p>
          </div>

          <fieldset className="space-y-3" disabled={isRunning}>
            <legend className="mb-3 text-sm font-medium">What to annotate?</legend>
            {SCOPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  type="radio"
                  name="ai-annotate-scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => {
                    setScope(option.value);
                    setError(null);
                    setNotice(null);
                  }}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm leading-tight">
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {scope === "range" ? (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">Select images</span>
                <span
                  className="tabular-nums text-muted-foreground"
                  aria-live="polite"
                >
                  Selected {plural(rangeCount, "image")}
                  {rangeSuffix}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Scroll images left"
                  onClick={() => scrollStrip(-1)}
                >
                  <ChevronLeft />
                </Button>
                <div
                  ref={stripRef}
                  className="relative flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-1"
                >
                  {images.map((image, index) => {
                    const checked = selectedImageIds.has(image.id);
                    return (
                      <button
                        key={image.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={image.fileName}
                        title={image.fileName}
                        data-image-id={image.id}
                        disabled={isRunning}
                        onClick={(event) =>
                          handleThumbnailClick(index, event.shiftKey)
                        }
                        className="group w-20 shrink-0 snap-start rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        <span
                          className={cn(
                            "relative block h-14 overflow-hidden rounded-md border bg-muted transition",
                            checked
                              ? "border-primary ring-2 ring-primary/25"
                              : "group-hover:border-primary/50",
                          )}
                          style={{ backgroundColor: thumbhashColor(image.thumbhash) }}
                        >
                          {image.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={image.url}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          ) : null}
                          <span
                            className={cn(
                              "absolute top-1 left-1 flex size-4 items-center justify-center rounded-full border bg-background shadow-sm",
                              checked &&
                                "border-primary bg-primary text-primary-foreground",
                            )}
                            aria-hidden
                          >
                            {checked ? <Check className="size-3" /> : null}
                          </span>
                          {image.id === currentImageId ? (
                            <span className="absolute right-1 bottom-1 rounded bg-background/90 px-1 text-[9px] font-medium">
                              Current
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-[11px]">
                          {image.fileName}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-label="Scroll images right"
                  onClick={() => scrollStrip(1)}
                >
                  <ChevronRight />
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  Shift-click to select a range.
                </span>
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-primary hover:underline disabled:opacity-50"
                    disabled={isRunning || rangeCount === images.length}
                    onClick={() =>
                      setSelectedImageIds(new Set(images.map((image) => image.id)))
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-primary hover:underline disabled:opacity-50"
                    disabled={isRunning || rangeCount === 0}
                    onClick={() => {
                      setSelectedImageIds(new Set());
                      setAnchorIndex(null);
                    }}
                  >
                    Clear
                  </button>
                </span>
              </div>

              {tooManyImages ? (
                <p className="text-xs text-destructive">
                  One run can include at most {MAX_JOB_IMAGES} images. Select
                  fewer, then run the rest afterwards.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Runs in the background. Each image&apos;s results appear as
                  suggestions to review when you open it.
                </p>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="ai-annotate-confidence">
              Confidence Threshold{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={confidence}
                disabled={isRunning}
                aria-label="Confidence threshold"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setConfidence(value);
                  setConfidenceDraft(formatConfidence(value));
                }}
                className="h-2 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
              />
              <Input
                id="ai-annotate-confidence"
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.05}
                value={confidenceDraft}
                disabled={isRunning}
                aria-invalid={parseConfidence(confidenceDraft) === null}
                onChange={(event) =>
                  handleConfidenceDraftChange(event.target.value)
                }
                onBlur={() => setConfidenceDraft(formatConfidence(confidence))}
                className="h-8 w-20 text-right tabular-nums"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Only show predictions with confidence above this threshold (0.0 -
              1.0)
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Available Labels</Label>
              {labels.length > 1 ? (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                  disabled={isRunning}
                  onClick={() =>
                    setSelectedLabelIds(
                      allLabelsSelected
                        ? new Set()
                        : new Set(labels.map((label) => label.id)),
                    )
                  }
                >
                  {allLabelsSelected ? "Clear all" : "Select all"}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {labels.map((label) => {
                const active = selectedLabelIds.has(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    aria-pressed={active}
                    disabled={isRunning}
                    onClick={() => toggleLabel(label.id)}
                    className={cn(
                      "inline-flex h-7 max-w-full items-center rounded-md border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{label.name}</span>
                  </button>
                );
              })}

              {isAddingClass ? (
                <span className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={newClassName}
                    placeholder="Class name"
                    aria-label="New class name"
                    disabled={isCreatingClass}
                    onChange={(event) => {
                      setNewClassName(event.target.value);
                      setClassError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddClass();
                      }
                    }}
                    className="h-7 w-36 px-2 text-xs md:text-xs"
                  />
                  <Button
                    type="button"
                    size="xs"
                    disabled={isCreatingClass || !newClassName.trim()}
                    onClick={() => void handleAddClass()}
                  >
                    {isCreatingClass ? "Adding..." : "Add"}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={isCreatingClass}
                    onClick={cancelAddClass}
                  >
                    Cancel
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setIsAddingClass(true)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-primary px-2.5 text-xs font-medium text-primary transition-colors outline-none hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <Plus className="size-3.5" aria-hidden />
                  Add Class
                </button>
              )}
            </div>
            {classError ? (
              <p className="text-xs text-destructive">{classError}</p>
            ) : null}
            {labels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This project has no labels yet. Add a class: the AI looks for
                objects matching your label names.
              </p>
            ) : labelIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Select at least one label for the AI to look for.
              </p>
            ) : null}
          </div>

          {notice ? (
            <p className="text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isRunning}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleRun()} disabled={!canRun}>
            {isRunning ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {isRunning
              ? scope === "current"
                ? "Detecting..."
                : "Queuing..."
              : runLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
