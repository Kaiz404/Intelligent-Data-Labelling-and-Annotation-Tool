"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BringToFront, Check, Copy, GripVertical, MoreVertical, Pencil, Plus, Search, SendToBack, Sparkles, SquarePen, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type BoxPatch = Partial<Pick<BoundingBox, "labelId" | "x" | "y" | "width" | "height">>;

type DropTarget = { boxId: string; position: "before" | "after" };

/** Private drag type so layer drags never drop text into inputs or accept outside files. */
const LAYER_DRAG_TYPE = "application/x-annotation-layer";

type AnnotationSidePanelProps = {
  labels: AnnotationLabel[];
  boxes: BoundingBox[];
  selectedLabelId: string;
  selectedBoxId: string | null;
  onSelectLabel: (labelId: string) => void;
  onSelectBox: (boxId: string | null) => void;
  /** Resolves once created; the result (the new label) is not used here. */
  onCreateLabel: (name: string) => Promise<unknown>;
  onRenameLabel: (labelId: string, name: string) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  onUpdateBox: (boxId: string, patch: BoxPatch) => void;
  onMoveBox: (boxId: string, action: "front" | "forward" | "back" | "backward") => void;
  /** Move a box to `toIndex` in the boxes array (later = drawn on top). */
  onReorderBox: (boxId: string, toIndex: number) => void;
  onDuplicateBox: (boxId: string) => void;
  /** Give a box the label with this name, creating the label if needed. */
  onRenameBox: (boxId: string, name: string) => Promise<void>;
  onDeleteBox: (boxId: string) => void;
  /** Confidence keyed by box ID for AI suggestions not yet accepted. */
  suggestionConfidence?: Record<string, number>;
  onAcceptSuggestion?: (boxId: string) => void;
  onRejectSuggestion?: (boxId: string) => void;
};

function CoordinateField({ label, value, minimum, onCommit }: { label: string; value: number | null; minimum: number; onCommit: (value: number) => void }) {
  const rounded = value === null ? "" : String(Math.round(value));
  const [draft, setDraft] = useState(rounded);
  useEffect(() => setDraft(rounded), [rounded]);

  if (value === null) {
    return (
      <div className="flex h-9 items-center rounded-md border bg-muted/30 px-2 text-muted-foreground" title="Select a bounding box to edit">
        <span className="mr-2 text-[11px] font-medium">{label}</span>
        <span className="text-xs">–</span>
      </div>
    );
  }

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(rounded);
      return;
    }
    const next = Math.max(minimum, Math.round(parsed));
    setDraft(String(next));
    if (next !== Math.round(value)) onCommit(next);
  };

  return (
    <label className="flex h-9 items-center rounded-md border bg-background px-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
      <span className="mr-2 text-[11px] font-medium text-muted-foreground">{label}</span>
      <input type="number" min={minimum} step={1} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(rounded);
          event.currentTarget.blur();
        }
      }} aria-label={`${label} coordinate`} className="min-w-0 flex-1 bg-transparent text-xs tabular-nums outline-none" />
    </label>
  );
}

/**
 * Inline rename field: Enter submits, Escape or blur cancels. `onSubmit`
 * resolves true when the edit is finished (the parent then unmounts this).
 */
function InlineNameInput({ initialValue, ariaLabel, onSubmit, onCancel }: { initialValue: string; ariaLabel: string; onSubmit: (value: string) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  // Focus on the next frame so a closing dropdown menu cannot steal focus back.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    const done = await onSubmit(value);
    submittingRef.current = false;
    setIsSubmitting(false);
    if (!done) inputRef.current?.focus();
  };

  return (
    <input ref={inputRef} value={value} readOnly={isSubmitting} aria-label={ariaLabel} aria-busy={isSubmitting} onChange={(event) => setValue(event.target.value)} onBlur={() => {
      if (!submittingRef.current) onCancel();
    }} onKeyDown={(event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    }} className="h-7 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-xs outline-none ring-2 ring-primary/15 read-only:opacity-70" />
  );
}

export function AnnotationSidePanel({ labels, boxes, selectedLabelId, selectedBoxId, onSelectLabel, onSelectBox, onCreateLabel, onRenameLabel, onDeleteLabel, onUpdateBox, onMoveBox, onReorderBox, onDuplicateBox, onRenameBox, onDeleteBox, suggestionConfidence, onAcceptSuggestion, onRejectSuggestion }: AnnotationSidePanelProps) {
  const [labelQuery, setLabelQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<"all" | "used">("all");
  const [isAddingLabel, setIsAddingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelPendingDelete, setLabelPendingDelete] = useState<AnnotationLabel | null>(null);
  const [isDeletingLabel, setIsDeletingLabel] = useState(false);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [renamingBoxId, setRenamingBoxId] = useState<string | null>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [draggingBoxId, setDraggingBoxId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const newLabelInputRef = useRef<HTMLInputElement>(null);
  /** Set when a menu item hands focus to an inline input instead of the menu trigger. */
  const keepFocusOnMenuCloseRef = useRef(false);
  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  /** Top of the list = drawn last (on top), so layers are the boxes reversed. */
  const layers = useMemo(() => [...boxes].reverse(), [boxes]);
  const selectedBox = boxes.find((box) => box.id === selectedBoxId) ?? null;
  const selectedConfidence = selectedBox ? suggestionConfidence?.[selectedBox.id] : undefined;
  const showAddLabel = isAddingLabel || labels.length === 0;

  const filteredLabels = useMemo(() => {
    const normalized = labelQuery.trim().toLowerCase();
    const usedIds = new Set(boxes.map((box) => box.labelId));
    return labels.filter((label) => label.name.toLowerCase().includes(normalized) && (labelFilter === "all" || usedIds.has(label.id)));
  }, [boxes, labelFilter, labelQuery, labels]);

  const openAddLabel = () => {
    setIsAddingLabel(true);
    setLabelError(null);
    window.requestAnimationFrame(() => newLabelInputRef.current?.focus());
  };

  const closeAddLabel = () => {
    setIsAddingLabel(false);
    setNewLabelName("");
  };

  const handleCreateLabel = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newLabelName.trim();
    if (!name) return;
    setIsCreatingLabel(true);
    setLabelError(null);
    try {
      await onCreateLabel(name);
      setNewLabelName("");
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Could not add label.");
    } finally {
      setIsCreatingLabel(false);
    }
  };

  const handleRenameLabel = async (labelId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLabelError("Label name is required.");
      return false;
    }
    if (labels.some((label) => label.id !== labelId && label.name.toLowerCase() === trimmed.toLowerCase())) {
      setLabelError(`A label named "${trimmed}" already exists.`);
      return false;
    }
    setLabelError(null);
    try {
      await onRenameLabel(labelId, trimmed);
      setEditingLabelId(null);
      return true;
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Could not rename label.");
      return false;
    }
  };

  const confirmDeleteLabel = async () => {
    if (!labelPendingDelete) return;
    setIsDeletingLabel(true);
    setLabelError(null);
    try {
      await onDeleteLabel(labelPendingDelete.id);
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Could not delete label.");
    } finally {
      setIsDeletingLabel(false);
      setLabelPendingDelete(null);
    }
  };

  const handleRenameBox = async (box: BoundingBox, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLayerError("Label name is required.");
      return false;
    }
    setLayerError(null);
    // Same label (names are unique case-insensitively): nothing to change.
    if (labelById.get(box.labelId)?.name.toLowerCase() === trimmed.toLowerCase()) {
      setRenamingBoxId(null);
      return true;
    }
    try {
      await onRenameBox(box.id, trimmed);
      setRenamingBoxId(null);
      return true;
    } catch (error) {
      setLayerError(error instanceof Error ? error.message : "Could not rename annotation.");
      return false;
    }
  };

  const endLayerDrag = () => {
    setDraggingBoxId(null);
    setDropTarget(null);
  };

  const dropLayer = (targetId: string, position: DropTarget["position"]) => {
    const draggedId = draggingBoxId;
    endLayerDrag();
    if (!draggedId || draggedId === targetId) return;
    const order = layers.map((box) => box.id).filter((id) => id !== draggedId);
    const targetPosition = order.indexOf(targetId);
    if (targetPosition < 0) return;
    const listIndex = position === "before" ? targetPosition : targetPosition + 1;
    // List index 0 is the end of the boxes array.
    onReorderBox(draggedId, boxes.length - 1 - listIndex);
  };

  const dropPosition = (event: React.DragEvent<HTMLElement>): DropTarget["position"] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  return (
    <aside className="w-full min-w-0 space-y-4 xl:w-[290px] xl:shrink-0">
      <Tabs defaultValue="labels" className="h-[347px] w-full">
        <TabsList className="grid h-9 w-full grid-cols-2 bg-muted/70 p-1">
          <TabsTrigger value="labels" className="text-xs">Labels</TabsTrigger>
          <TabsTrigger value="layers" className="text-xs">Layers</TabsTrigger>
        </TabsList>

        <TabsContent value="labels" className="mt-2">
          <div className="flex h-[300px] flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={labelQuery} onChange={(event) => setLabelQuery(event.target.value)} placeholder="Search labels..." className="h-9 pl-8 text-xs" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" aria-expanded={showAddLabel} onClick={() => (isAddingLabel && labels.length > 0 ? closeAddLabel() : openAddLabel())} className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"><Plus className="size-3.5" />New label</Button>
              <Select value={labelFilter} onValueChange={(value) => setLabelFilter(value as "all" | "used")}>
                <SelectTrigger className="h-8 w-[112px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Filter: All</SelectItem><SelectItem value="used">Filter: Used</SelectItem></SelectContent>
              </Select>
            </div>
            {showAddLabel ? (
              <form onSubmit={handleCreateLabel} className="flex gap-1.5">
                <Input ref={newLabelInputRef} value={newLabelName} onChange={(event) => setNewLabelName(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Escape" && labels.length > 0) {
                    event.preventDefault();
                    closeAddLabel();
                  }
                }} placeholder="New label name..." aria-label="New label name" className="h-8 text-xs" disabled={isCreatingLabel} />
                <Button type="submit" size="sm" className="h-8 shrink-0" disabled={isCreatingLabel || !newLabelName.trim()}>{isCreatingLabel ? "Adding..." : "Add"}</Button>
                {labels.length > 0 ? <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Cancel new label" onClick={closeAddLabel}><X className="size-3.5" /></Button> : null}
              </form>
            ) : null}
            {labelError ? <p className="text-xs text-destructive">{labelError}</p> : null}
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
              {filteredLabels.map((label) => {
                const count = boxes.filter((box) => box.labelId === label.id).length;
                return (
                  <li key={label.id} className={cn("flex items-center gap-0.5 rounded-md pr-1 hover:bg-muted", label.id === selectedLabelId && "bg-primary/10")}>
                    {editingLabelId === label.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2">
                        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                        <InlineNameInput initialValue={label.name} ariaLabel={`Rename label ${label.name}`} onSubmit={(name) => handleRenameLabel(label.id, name)} onCancel={() => setEditingLabelId(null)} />
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => onSelectLabel(label.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs">
                          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
                          <span className="truncate">{label.name}</span>
                          <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
                        </button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Rename ${label.name}`} onClick={() => { setLabelError(null); setEditingLabelId(label.id); }} className="size-6 shrink-0 text-muted-foreground hover:text-foreground"><Pencil className="size-3.5" /></Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${label.name}`} onClick={() => { setLabelError(null); setLabelPendingDelete(label); }} className="size-6 shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></Button>
                      </>
                    )}
                  </li>
                );
              })}
              {filteredLabels.length === 0 ? <li className="py-4 text-center text-xs text-muted-foreground">{labels.length === 0 ? "No labels yet. Add one above." : "No labels match."}</li> : null}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="layers" className="mt-2">
          <div className="h-[300px] overflow-y-auto rounded-xl border bg-card p-3 shadow-sm">
            {layerError ? <p className="mb-2 text-xs text-destructive">{layerError}</p> : null}
            {boxes.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No annotations yet.</p> : (
              <ul className="space-y-1" onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}>
                {layers.map((box, reverseIndex) => {
                  const label = labelById.get(box.labelId);
                  const name = label?.name ?? "Unknown";
                  const index = boxes.length - reverseIndex;
                  const confidence = suggestionConfidence?.[box.id];
                  return (
                    <li key={box.id} className="relative" onDragOver={(event) => {
                      if (!draggingBoxId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const position = dropPosition(event);
                      setDropTarget((current) => (current?.boxId === box.id && current.position === position ? current : { boxId: box.id, position }));
                    }} onDrop={(event) => {
                      if (!draggingBoxId) return;
                      event.preventDefault();
                      dropLayer(box.id, dropPosition(event));
                    }}>
                      {dropTarget?.boxId === box.id && draggingBoxId !== box.id ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary", dropTarget.position === "before" ? "-top-[3px]" : "-bottom-[3px]")} /> : null}
                      {renamingBoxId === box.id ? (
                        <div className="flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1 text-xs">
                          <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50" />
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: label?.color ?? "#71717a" }} />
                          <InlineNameInput initialValue={label?.name ?? ""} ariaLabel={`Rename ${name} ${index}`} onSubmit={(value) => handleRenameBox(box, value)} onCancel={() => setRenamingBoxId(null)} />
                        </div>
                      ) : (
                        <div role="button" tabIndex={0} onClick={() => onSelectBox(box.id)} onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") onSelectBox(box.id);
                        }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted", box.id === selectedBoxId && "bg-primary/10", draggingBoxId === box.id && "opacity-50")}>
                          <span draggable title="Drag to reorder" aria-hidden onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(LAYER_DRAG_TYPE, box.id);
                            const row = event.currentTarget.closest("li");
                            if (row) event.dataTransfer.setDragImage(row, 16, row.clientHeight / 2);
                            setDraggingBoxId(box.id);
                          }} onDragEnd={endLayerDrag} className="-ml-1 flex shrink-0 cursor-grab items-center rounded p-0.5 text-muted-foreground hover:text-foreground active:cursor-grabbing"><GripVertical className="size-3.5" /></span>
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: label?.color ?? "#71717a" }} />
                          <span className="truncate">{name}<span className="sr-only"> #{index}</span></span>
                          {confidence !== undefined ? (
                            <>
                              <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-violet-600 dark:text-violet-300" title="AI suggestion — not yet accepted"><Sparkles className="size-3" />{Math.round(confidence * 100)}%</span>
                              <Button type="button" variant="ghost" size="icon" className="ml-auto size-6 shrink-0 text-emerald-600 hover:text-emerald-700" aria-label={`Accept ${name} ${index}`} onClick={(event) => { event.stopPropagation(); onAcceptSuggestion?.(box.id); }}><Check className="size-3.5" /></Button>
                              <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0 hover:text-destructive" aria-label={`Reject ${name} ${index}`} onClick={(event) => { event.stopPropagation(); onRejectSuggestion?.(box.id); }}><X className="size-3.5" /></Button>
                            </>
                          ) : null}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className={cn("size-6 shrink-0 text-muted-foreground", confidence === undefined && "ml-auto")} aria-label={`Layer options for ${name} ${index}`} onClick={(event) => event.stopPropagation()}><MoreVertical className="size-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44" onClick={(event) => event.stopPropagation()} onCloseAutoFocus={(event) => {
                              if (keepFocusOnMenuCloseRef.current) {
                                keepFocusOnMenuCloseRef.current = false;
                                event.preventDefault();
                              }
                            }}>
                              <DropdownMenuItem onSelect={() => { keepFocusOnMenuCloseRef.current = true; setLayerError(null); setRenamingBoxId(box.id); }}><SquarePen />Rename</DropdownMenuItem>
                              <DropdownMenuItem disabled={reverseIndex === 0} onSelect={() => onMoveBox(box.id, "front")}><BringToFront />Bring to Front</DropdownMenuItem>
                              <DropdownMenuItem disabled={reverseIndex === 0} onSelect={() => onMoveBox(box.id, "forward")}><ArrowUp />Bring Forward</DropdownMenuItem>
                              <DropdownMenuItem disabled={reverseIndex === boxes.length - 1} onSelect={() => onMoveBox(box.id, "back")}><SendToBack />Send to Back</DropdownMenuItem>
                              <DropdownMenuItem disabled={reverseIndex === boxes.length - 1} onSelect={() => onMoveBox(box.id, "backward")}><ArrowDown />Send Backward</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => onDuplicateBox(box.id)}><Copy />Duplicate</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive [&>svg]:text-destructive" onSelect={() => onDeleteBox(box.id)}><Trash2 />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <section className="space-y-3 rounded-xl border bg-card p-3 shadow-sm" aria-label="Bounding box properties">
        <h2 className="text-sm font-semibold">Properties</h2>
        {selectedBox && selectedConfidence !== undefined ? (
          <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-2 text-xs dark:border-violet-900 dark:bg-violet-950/40">
            <p className="flex items-center gap-1.5 whitespace-nowrap"><Sparkles className="size-3.5 shrink-0 text-violet-600" />AI suggestion · {Math.round(selectedConfidence * 100)}% confident</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="outline" className="h-7 bg-background text-emerald-700 hover:text-emerald-700" onClick={() => onAcceptSuggestion?.(selectedBox.id)}><Check className="size-3.5" />Accept</Button>
              <Button type="button" size="sm" variant="outline" className="h-7 bg-background text-destructive hover:text-destructive" onClick={() => onRejectSuggestion?.(selectedBox.id)}><X className="size-3.5" />Reject</Button>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="box-label-select" className="text-[11px] text-muted-foreground">Label</label>
          <Select value={selectedBox?.labelId ?? ""} disabled={!selectedBox} onValueChange={(labelId) => {
            if (!selectedBox) return;
            onSelectLabel(labelId);
            onUpdateBox(selectedBox.id, { labelId });
          }}>
            <SelectTrigger id="box-label-select" className="h-9 w-full text-xs"><SelectValue placeholder="Select label" /></SelectTrigger>
            <SelectContent>{labels.map((label) => <SelectItem key={label.id} value={label.id}><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: label.color }} />{label.name}</span></SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">Bounding Box</p>
          <div className="grid grid-cols-2 gap-2">
            <CoordinateField label="X" value={selectedBox?.x ?? null} minimum={0} onCommit={(x) => selectedBox && onUpdateBox(selectedBox.id, { x })} />
            <CoordinateField label="Y" value={selectedBox?.y ?? null} minimum={0} onCommit={(y) => selectedBox && onUpdateBox(selectedBox.id, { y })} />
            <CoordinateField label="W" value={selectedBox?.width ?? null} minimum={1} onCommit={(width) => selectedBox && onUpdateBox(selectedBox.id, { width })} />
            <CoordinateField label="H" value={selectedBox?.height ?? null} minimum={1} onCommit={(height) => selectedBox && onUpdateBox(selectedBox.id, { height })} />
          </div>
        </div>
      </section>

      <Dialog open={labelPendingDelete !== null} onOpenChange={(open) => {
        if (!open && !isDeletingLabel) setLabelPendingDelete(null);
      }}>
        <DialogContent className="sm:max-w-sm" showCloseButton={!isDeletingLabel}>
          <DialogHeader>
            <DialogTitle>Delete label “{labelPendingDelete?.name}”?</DialogTitle>
            <DialogDescription>The label is removed from this project. Labels still used by boxes cannot be deleted; relabel or delete those boxes first.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeletingLabel} onClick={() => setLabelPendingDelete(null)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={isDeletingLabel} onClick={() => void confirmDeleteLabel()}>{isDeletingLabel ? "Deleting..." : "Delete label"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
