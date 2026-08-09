"use client";

import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  WandSparkles,
  Plus,
  Redo2,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
};

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "size-10 rounded-md",
            active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnnotationToolbar({
  imageIndex,
  imageCount,
  tool,
  zoom,
  canUndo,
  canRedo,
  canDelete,
  onPrev,
  onNext,
  onToolChange,
  onUndo,
  onRedo,
  onDelete,
  onZoomOut,
  onZoomIn,
  onFit,
}: AnnotationToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          onClick={onPrev}
          disabled={imageIndex <= 0}
          aria-label="Previous image"
        >
          <ChevronLeft className="size-5" />
        </Button>
        <p className="min-w-[4.5rem] text-center text-lg font-medium tabular-nums">
          {imageIndex + 1} / {imageCount}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11"
          onClick={onNext}
          disabled={imageIndex >= imageCount - 1}
          aria-label="Next image"
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-[10px] border bg-card p-2 shadow-sm">
        <ToolButton
          label="Select"
          active={tool === "select"}
          onClick={() => onToolChange("select")}
        >
          <MousePointer2 className="size-5" />
        </ToolButton>
        <ToolButton
          label="Bounding box"
          active={tool === "bbox"}
          onClick={() => onToolChange("bbox")}
        >
          <Square className="size-5" />
        </ToolButton>
        <ToolButton
          label="Pan"
          active={tool === "pan"}
          onClick={() => onToolChange("pan")}
        >
          <Hand className="size-5" />
        </ToolButton>
        <div className="mx-1 h-8 w-px bg-border" />
        <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="size-5" />
        </ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="size-5" />
        </ToolButton>
        <ToolButton
          label="Delete selected"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 className="size-5" />
        </ToolButton>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center shadow-sm">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-[50px] rounded-r-none"
            onClick={onZoomOut}
            aria-label="Zoom out"
          >
            <Minus className="size-5" />
          </Button>
          <div className="flex h-[50px] min-w-[4.5rem] items-center justify-center border-y px-3 text-lg tabular-nums">
            {zoom}%
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-[50px] rounded-l-none"
            onClick={onZoomIn}
            aria-label="Zoom in"
          >
            <Plus className="size-5" />
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-[50px] rounded-[10px]"
          onClick={onFit}
          aria-label="Fit to view"
        >
          <Maximize2 className="size-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              className="h-[50px] gap-2 rounded-[10px] bg-violet-600 px-4 text-base text-white hover:bg-violet-700"
            >
              <WandSparkles className="size-5" />
              AI Annotate
              <ChevronDown className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>Coming soon</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
