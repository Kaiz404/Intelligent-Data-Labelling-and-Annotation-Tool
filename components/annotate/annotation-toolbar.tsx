"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Hand, Maximize2, Minus, MousePointer2, Plus, Redo2, Square, Trash2, Undo2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnnotationTool } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type AnnotationToolbarProps = {
  imageIndex: number;
  imageCount: number;
  tool: AnnotationTool;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToolChange: (tool: AnnotationTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
  onAiAnnotate: () => void;
};

function ToolButton({ label, active, disabled, onClick, children }: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={cn("size-8 rounded-md", active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnnotationToolbar({ imageIndex, imageCount, tool, zoom, canUndo, canRedo, canDelete, onPrev, onNext, onToolChange, onUndo, onRedo, onDelete, onZoomOut, onZoomIn, onFit, onAiAnnotate }: AnnotationToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="icon" className="size-9" onClick={onPrev} disabled={imageIndex <= 0} aria-label="Previous image"><ChevronLeft className="size-4" /></Button>
        <p className="min-w-[3.5rem] text-center text-sm font-medium tabular-nums">{imageIndex + 1} / {imageCount}</p>
        <Button type="button" variant="outline" size="icon" className="size-9" onClick={onNext} disabled={imageIndex >= imageCount - 1} aria-label="Next image"><ChevronRight className="size-4" /></Button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
        <ToolButton label="Select" active={tool === "select"} onClick={() => onToolChange("select")}><MousePointer2 className="size-4" /></ToolButton>
        <ToolButton label="Bounding box" active={tool === "bbox"} onClick={() => onToolChange("bbox")}><Square className="size-4" /></ToolButton>
        <ToolButton label="Pan" active={tool === "pan"} onClick={() => onToolChange("pan")}><Hand className="size-4" /></ToolButton>
        <div className="mx-1 h-6 w-px bg-border" />
        <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 className="size-4" /></ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 className="size-4" /></ToolButton>
        <ToolButton label="Delete selected" disabled={!canDelete} onClick={onDelete}><Trash2 className="size-4" /></ToolButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center shadow-sm">
          <Button type="button" variant="outline" size="icon" className="size-9 rounded-r-none" onClick={onZoomOut} aria-label="Zoom out"><Minus className="size-4" /></Button>
          <div className="flex h-9 min-w-[3.5rem] items-center justify-center border-y px-2 text-sm tabular-nums">{zoom}%</div>
          <Button type="button" variant="outline" size="icon" className="size-9 rounded-l-none" onClick={onZoomIn} aria-label="Zoom in"><Plus className="size-4" /></Button>
        </div>
        <Button type="button" variant="outline" size="icon" className="size-9 rounded-lg" onClick={onFit} aria-label="Fit to view"><Maximize2 className="size-4" /></Button>
        <Button type="button" onClick={onAiAnnotate} className="h-9 gap-1.5 rounded-lg bg-violet-600 px-3 text-sm text-white hover:bg-violet-700"><WandSparkles className="size-4" />AI Annotate</Button>
      </div>
    </div>
  );
}
