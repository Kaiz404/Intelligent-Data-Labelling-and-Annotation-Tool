"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Hand, ImageIcon, Images, Maximize, Minimize, Minus, MousePointer2, Plus, Redo2, Square, Trash2, Undo2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnnotationTool } from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

/** Which images an AI Annotate run should cover when the dialog opens. */
export type AiAnnotateScope = "current" | "range";

type AnnotationToolbarProps = {
  imageIndex: number;
  imageCount: number;
  tool: AnnotationTool;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  isFullscreen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToolChange: (tool: AnnotationTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  /** Reset zoom and position so the whole image fits the canvas. */
  onResetView: () => void;
  onToggleFullscreen: () => void;
  onAiAnnotate: (scope: AiAnnotateScope) => void;
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

export function AnnotationToolbar({ imageIndex, imageCount, tool, zoom, canUndo, canRedo, canDelete, isFullscreen, onPrev, onNext, onToolChange, onUndo, onRedo, onDelete, onZoomOut, onZoomIn, onResetView, onToggleFullscreen, onAiAnnotate }: AnnotationToolbarProps) {
  const fullscreenLabel = isFullscreen ? "Exit full screen" : "Full screen";
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
        <div className="flex h-9 items-center gap-0.5 rounded-lg border bg-card px-1 shadow-sm">
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onZoomOut} aria-label="Zoom out"><Minus className="size-4" /></Button>
          <div className="min-w-[3.25rem] text-center text-sm tabular-nums">{zoom}%</div>
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onZoomIn} aria-label="Zoom in"><Plus className="size-4" /></Button>
          <Button type="button" variant="ghost" className="h-7 px-2 text-[11px] font-semibold tracking-wide" onClick={onResetView} aria-label="Reset view to fit image">RESET</Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="size-9 rounded-lg" onClick={onToggleFullscreen} aria-label={fullscreenLabel} aria-pressed={isFullscreen}>{isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</Button>
          </TooltipTrigger>
          <TooltipContent>{fullscreenLabel}</TooltipContent>
        </Tooltip>
        <div className="flex h-9 items-stretch overflow-hidden rounded-lg bg-violet-600 text-white shadow-sm">
          <Button type="button" onClick={() => onAiAnnotate("current")} className="h-9 gap-1.5 rounded-none bg-transparent px-3 text-sm text-white shadow-none hover:bg-violet-700"><WandSparkles className="size-4" />AI Annotate</Button>
          {/* Non-modal so the AI Annotate dialog can take focus as this menu closes. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" aria-label="AI Annotate options" className="h-9 w-8 rounded-none border-l border-white/25 bg-transparent px-0 text-white shadow-none hover:bg-violet-700 data-[state=open]:bg-violet-700"><ChevronDown className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => onAiAnnotate("current")}><ImageIcon />Annotate this image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAiAnnotate("range")}><Images />Annotate multiple images…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
