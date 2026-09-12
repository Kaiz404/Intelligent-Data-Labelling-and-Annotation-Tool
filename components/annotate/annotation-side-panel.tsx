"use client";

import { useEffect, useMemo, useState } from "react";
import { GripVertical, MoreVertical, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type BoxPatch = Partial<Pick<BoundingBox, "labelId" | "x" | "y" | "width" | "height">>;

type AnnotationSidePanelProps = {
  labels: AnnotationLabel[];
  boxes: BoundingBox[];
  selectedLabelId: string;
  selectedBoxId: string | null;
  onSelectLabel: (labelId: string) => void;
  onSelectBox: (boxId: string | null) => void;
  onUpdateBox: (boxId: string, patch: BoxPatch) => void;
  onMoveBox: (boxId: string, action: "front" | "forward" | "back" | "backward") => void;
  onDeleteBox: (boxId: string) => void;
};

function CoordinateField({ label, value, minimum, onCommit }: {
  label: string;
  value: number;
  minimum: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => setDraft(String(Math.round(value))), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(Math.round(value)));
      return;
    }
    const next = Math.max(minimum, Math.round(parsed));
    setDraft(String(next));
    if (next !== Math.round(value)) onCommit(next);
  };

  return (
    <label className="flex h-9 items-center rounded-md border bg-background px-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
      <span className="mr-2 text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={minimum}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(Math.round(value)));
            event.currentTarget.blur();
          }
        }}
        aria-label={`${label} coordinate`}
        className="min-w-0 flex-1 bg-transparent text-xs tabular-nums outline-none"
      />
    </label>
  );
}

export function AnnotationSidePanel({
  labels,
  boxes,
  selectedLabelId,
  selectedBoxId,
  onSelectLabel,
  onSelectBox,
  onUpdateBox,
  onMoveBox,
  onDeleteBox,
}: AnnotationSidePanelProps) {
  const [labelQuery, setLabelQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<"all" | "used">("all");
  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const selectedBox = boxes.find((box) => box.id === selectedBoxId) ?? null;

  const filteredLabels = useMemo(() => {
    const normalized = labelQuery.trim().toLowerCase();
    const usedIds = new Set(boxes.map((box) => box.labelId));
    return labels.filter((label) =>
      label.name.toLowerCase().includes(normalized) &&
      (labelFilter === "all" || usedIds.has(label.id)),
    );
  }, [boxes, labelFilter, labelQuery, labels]);

  return (
    <aside className="w-full min-w-0 space-y-4 xl:w-[290px] xl:shrink-0">
      <Tabs defaultValue="labels" className="w-full">
        <TabsList className="grid h-9 w-full grid-cols-2 bg-muted/70 p-1">
          <TabsTrigger value="labels" className="text-xs">Labels</TabsTrigger>
          <TabsTrigger value="layers" className="text-xs">Layers</TabsTrigger>
        </TabsList>

        <TabsContent value="labels" className="mt-2">
          <div className="space-y-3 rounded-xl border bg-card p-3 shadow-sm">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={labelQuery} onChange={(event) => setLabelQuery(event.target.value)} placeholder="Search labels..." className="h-9 pl-8 text-xs" />
            </div>
            <div className="flex justify-end">
              <Select value={labelFilter} onValueChange={(value) => setLabelFilter(value as "all" | "used")}>
                <SelectTrigger className="h-8 w-[112px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Filter: All</SelectItem>
                  <SelectItem value="used">Filter: Used</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ul className="space-y-0.5">
              {filteredLabels.map((label) => {
                const count = boxes.filter((box) => box.labelId === label.id).length;
                return (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => onSelectLabel(label.id)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted", label.id === selectedLabelId && "bg-primary/10")}
                    >
                      <span className="size-3 rounded-full" style={{ backgroundColor: label.color }} />
                      <span className="truncate">{label.name}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="layers" className="mt-2">
          <div className="rounded-xl border bg-card p-3 shadow-sm">
            {boxes.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No annotations yet.</p>
            ) : (
              <ul className="space-y-1">
                {[...boxes].reverse().map((box, reverseIndex) => {
                  const label = labelById.get(box.labelId);
                  const index = boxes.length - reverseIndex;
                  return (
                    <li key={box.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectBox(box.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") onSelectBox(box.id);
                        }}
                        className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted", box.id === selectedBoxId && "bg-primary/10")}
                      >
                        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: label?.color ?? "#71717a" }} />
                        <span className="truncate">{label?.name ?? "Unknown"} #{index}</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto size-7 shrink-0"
                              aria-label={`Layer options for ${label?.name ?? "annotation"} ${index}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVertical className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenuItem disabled={reverseIndex === 0} onSelect={() => onMoveBox(box.id, "front")}>Bring to Front</DropdownMenuItem>
                            <DropdownMenuItem disabled={reverseIndex === 0} onSelect={() => onMoveBox(box.id, "forward")}>Bring Forward</DropdownMenuItem>
                            <DropdownMenuItem disabled={reverseIndex === boxes.length - 1} onSelect={() => onMoveBox(box.id, "back")}>Send to Back</DropdownMenuItem>
                            <DropdownMenuItem disabled={reverseIndex === boxes.length - 1} onSelect={() => onMoveBox(box.id, "backward")}>Send Backward</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteBox(box.id)}>
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {selectedBox ? (
        <section className="space-y-3 rounded-xl border bg-card p-3 shadow-sm" aria-label="Selected bounding box properties">
          <div>
            <h2 className="text-sm font-semibold">Properties</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Edit the selected bounding box.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">Label</label>
            <Select value={selectedBox.labelId} onValueChange={(labelId) => {
              onSelectLabel(labelId);
              onUpdateBox(selectedBox.id, { labelId });
            }}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {labels.map((label) => (
                  <SelectItem key={label.id} value={label.id}>
                    <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />{label.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">Bounding Box</p>
            <div className="grid grid-cols-2 gap-2">
              <CoordinateField label="X" value={selectedBox.x} minimum={0} onCommit={(x) => onUpdateBox(selectedBox.id, { x })} />
              <CoordinateField label="Y" value={selectedBox.y} minimum={0} onCommit={(y) => onUpdateBox(selectedBox.id, { y })} />
              <CoordinateField label="W" value={selectedBox.width} minimum={1} onCommit={(width) => onUpdateBox(selectedBox.id, { width })} />
              <CoordinateField label="H" value={selectedBox.height} minimum={1} onCommit={(height) => onUpdateBox(selectedBox.id, { height })} />
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
