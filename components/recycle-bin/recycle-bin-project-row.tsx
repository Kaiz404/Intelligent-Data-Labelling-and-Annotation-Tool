"use client";

import { CircleAlert, Clock, ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import {
  DELETION_PENDING_LABEL,
  DELETION_PENDING_TOOLTIP,
} from "@/components/recycle-bin/recycle-bin-image-card";
import {
  daysLeftLabel,
  deletedLabel,
  LocalDateTime,
} from "@/components/recycle-bin/recycle-bin-time";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { numberFormatter } from "@/lib/format";
import type { RecycleBinProject } from "@/lib/types/recycle-bin";
import { cn } from "@/lib/utils";

type RecycleBinProjectRowProps = {
  project: RecycleBinProject;
  now: number;
  isSelected: boolean;
  /** Another bin action is running; actions are disabled. */
  disabled: boolean;
  /** The action currently running on this row, if any. */
  pendingAction: "restore" | "delete" | null;
  error?: string;
  onSelectionChange: (id: string, isSelected: boolean) => void;
  onRestore: (project: RecycleBinProject) => void;
  onDelete: (project: RecycleBinProject) => void;
};

export function RecycleBinProjectRow({
  project,
  now,
  isSelected,
  disabled,
  pendingAction,
  error,
  onSelectionChange,
  onRestore,
  onDelete,
}: RecycleBinProjectRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors sm:flex-row sm:items-center",
        isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/20",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <label className="flex shrink-0 cursor-pointer p-1">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelectionChange(project.id, checked === true)}
            aria-label={`Select ${project.name}`}
          />
        </label>
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
          {project.thumbnailUrl ? (
            // Signed S3 URLs are not configured for next/image optimisation.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={project.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="truncate font-semibold" title={project.name}>
            {project.name}
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {project.description || "No project description."}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {numberFormatter.format(project.imageCount)}{" "}
              {project.imageCount === 1 ? "image" : "images"}
            </span>
            <span aria-hidden="true" className="hidden h-3.5 w-px bg-border sm:block" />
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {deletedLabel(project.deletedAt, now)}{" "}
                <span className="text-muted-foreground/80">
                  (<LocalDateTime iso={project.deletedAt} />)
                </span>
              </span>
            </span>
          </div>
          {project.deletionPending ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              {DELETION_PENDING_LABEL}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 pl-10 sm:items-end sm:pl-0">
        <p className="text-xs text-muted-foreground">
          {daysLeftLabel(project.expiresAt, now)}
        </p>
        <div className="flex flex-wrap gap-2">
          {project.deletionPending ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons swallow pointer events; the span keeps the tooltip working. */}
                <span tabIndex={0} className="rounded-md">
                  <Button type="button" variant="outline" size="sm" disabled>
                    <RotateCcw className="size-4" />
                    Restore
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{DELETION_PENDING_TOOLTIP}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onRestore(project)}
            >
              <RotateCcw className="size-4" />
              {pendingAction === "restore" ? "Restoring..." : "Restore"}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={disabled}
            onClick={() => onDelete(project)}
          >
            <Trash2 className="size-4" />
            {pendingAction === "delete" ? "Deleting..." : "Delete Permanently"}
          </Button>
        </div>
      </div>
    </div>
  );
}
