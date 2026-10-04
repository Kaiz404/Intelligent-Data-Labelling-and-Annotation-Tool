"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { numberFormatter } from "@/lib/format";
import { NO_LABELS } from "@/lib/image-label-filter";
import type { AnnotationLabel } from "@/lib/types/annotations";

type LabelFilterMenuProps = {
  labels: AnnotationLabel[];
  /** Images per label id, plus NO_LABELS (`countImagesByLabel`). */
  counts: ReadonlyMap<string, number>;
  /** Selected label ids (and NO_LABELS), already cleaned of unknown ids. */
  selection: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
};

function selectionSummary(labels: AnnotationLabel[], selection: readonly string[]) {
  if (selection.length === 0) return "All";
  if (selection.length > 1) return `${selection.length} labels`;
  if (selection[0] === NO_LABELS) return "No labels";
  return labels.find((label) => label.id === selection[0])?.name ?? "All";
}

function ImageCount({ count }: { count: number }) {
  return (
    <span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">
      {numberFormatter.format(count)}
    </span>
  );
}

/** Multi-select of the project's labels; items keep the menu open while toggling. */
export function LabelFilterMenu({
  labels,
  counts,
  selection,
  onToggle,
  onClear,
}: LabelFilterMenuProps) {
  const selected = new Set(selection);
  const summary = selectionSummary(labels, selection);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-[140px] justify-between gap-2 border-input px-3 font-normal"
          aria-label={`Filter by label: ${summary}`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Show images with any of
        </DropdownMenuLabel>
        {labels.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            This project has no labels yet.
          </p>
        ) : (
          labels.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={selected.has(label.id)}
              onCheckedChange={() => onToggle(label.id)}
              onSelect={(event) => event.preventDefault()}
              className="gap-2"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
                aria-hidden
              />
              <span className="truncate">{label.name}</span>
              <ImageCount count={counts.get(label.id) ?? 0} />
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={selected.has(NO_LABELS)}
          onCheckedChange={() => onToggle(NO_LABELS)}
          onSelect={(event) => event.preventDefault()}
          className="gap-2"
        >
          <span
            className="size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground"
            aria-hidden
          />
          No labels
          <ImageCount count={counts.get(NO_LABELS) ?? 0} />
        </DropdownMenuCheckboxItem>
        {selection.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>Clear label filter</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
