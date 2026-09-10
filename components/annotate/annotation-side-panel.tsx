"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type AnnotationSidePanelProps = {
  labels: AnnotationLabel[];
  boxes: BoundingBox[];
  selectedLabelId: string;
  selectedBoxId: string | null;
  onSelectLabel: (labelId: string) => void;
  onSelectBox: (boxId: string | null) => void;
  onCreateLabel: (name: string) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
};

export function AnnotationSidePanel({
  labels,
  boxes,
  selectedLabelId,
  selectedBoxId,
  onSelectLabel,
  onSelectBox,
  onCreateLabel,
  onDeleteLabel,
}: AnnotationSidePanelProps) {
  const [labelQuery, setLabelQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<"all" | "used">("all");
  const [newLabelName, setNewLabelName] = useState("");
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  async function handleCreateLabel(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = newLabelName.trim();
    if (!trimmed) {
      return;
    }

    setIsCreatingLabel(true);
    setLabelError(null);
    try {
      await onCreateLabel(trimmed);
      setNewLabelName("");
    } catch (error) {
      setLabelError(
        error instanceof Error ? error.message : "Could not add label.",
      );
    } finally {
      setIsCreatingLabel(false);
    }
  }

  const filteredLabels = useMemo(() => {
    const normalized = labelQuery.trim().toLowerCase();
    const usedIds = new Set(boxes.map((box) => box.labelId));

    return labels.filter((label) => {
      const matchesQuery = label.name.toLowerCase().includes(normalized);
      const matchesFilter =
        labelFilter === "all" ? true : usedIds.has(label.id);
      return matchesQuery && matchesFilter;
    });
  }, [boxes, labelFilter, labelQuery, labels]);

  const labelById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );

  const selectedBox = boxes.find((box) => box.id === selectedBoxId) ?? null;
  const selectedBoxLabel = selectedBox
    ? labelById.get(selectedBox.labelId)
    : null;

  return (
    <Tabs defaultValue="label" className="w-full min-w-[260px] max-w-[320px]">
      <TabsList className="grid h-auto w-full grid-cols-3">
        <TabsTrigger value="label" className="text-sm">
          Label
        </TabsTrigger>
        <TabsTrigger value="annotations" className="text-sm">
          Annotations ({boxes.length})
        </TabsTrigger>
        <TabsTrigger value="properties" className="text-sm">
          Properties
        </TabsTrigger>
      </TabsList>

      <TabsContent value="label" className="mt-2">
        <div className="space-y-4 rounded-xl border bg-card p-3 shadow-sm">
          <form onSubmit={handleCreateLabel} className="flex gap-1.5">
            <Input
              value={newLabelName}
              onChange={(event) => setNewLabelName(event.target.value)}
              placeholder="New label name..."
              className="h-8 text-xs"
              disabled={isCreatingLabel}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8 shrink-0"
              disabled={isCreatingLabel || !newLabelName.trim()}
            >
              Add
            </Button>
          </form>
          {labelError ? (
            <p className="text-xs text-destructive">{labelError}</p>
          ) : null}

          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={labelQuery}
                onChange={(event) => setLabelQuery(event.target.value)}
                placeholder="Search labels..."
                className="pl-8"
              />
            </div>
            <div className="flex justify-end">
              <Select
                value={labelFilter}
                onValueChange={(value) =>
                  setLabelFilter(value as "all" | "used")
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue
                    placeholder="Filter"
                  >{`Filter: ${labelFilter === "all" ? "All" : "Used"}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ul className="space-y-1">
            {filteredLabels.map((label) => {
              const isActive = label.id === selectedLabelId;
              return (
                <li key={label.id}>
                  <div
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectLabel(label.id)}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: label.color }}
                        aria-hidden
                      />
                      <span className="truncate">{label.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${label.name}`}
                      onClick={() => onDeleteLabel(label.id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
            {filteredLabels.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                {labels.length === 0
                  ? "No labels yet. Add one above."
                  : "No labels match."}
              </li>
            ) : null}
          </ul>
        </div>
      </TabsContent>

      <TabsContent value="annotations" className="mt-2">
        <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
          {boxes.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No annotations yet. Draw a bounding box to get started.
            </p>
          ) : (
            <ul className="space-y-1">
              {boxes.map((box, index) => {
                const label = labelById.get(box.labelId);
                const isActive = box.id === selectedBoxId;
                return (
                  <li key={box.id}>
                    <button
                      type="button"
                      onClick={() => onSelectBox(box.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors",
                        isActive
                          ? "bg-primary/10 text-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: label?.color ?? "#71717a" }}
                        aria-hidden
                      />
                      <span className="truncate font-medium">
                        {label?.name ?? "Unknown"} #{index + 1}
                      </span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {Math.round(box.width)}×{Math.round(box.height)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </TabsContent>

      <TabsContent value="properties" className="mt-2">
        <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm text-xs">
          {selectedBox ? (
            <>
              <div className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full"
                  style={{
                    backgroundColor: selectedBoxLabel?.color ?? "#71717a",
                  }}
                />
                <span className="font-medium">
                  {selectedBoxLabel?.name ?? "Unknown"}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-muted-foreground">
                <div>
                  <dt>X</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {Math.round(selectedBox.x)}
                  </dd>
                </div>
                <div>
                  <dt>Y</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {Math.round(selectedBox.y)}
                  </dd>
                </div>
                <div>
                  <dt>Width</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {Math.round(selectedBox.width)}
                  </dd>
                </div>
                <div>
                  <dt>Height</dt>
                  <dd className="font-medium text-foreground tabular-nums">
                    {Math.round(selectedBox.height)}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              Select an annotation to view its properties.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
