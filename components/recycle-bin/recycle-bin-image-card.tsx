"use client";

import {
  Clock,
  Folder,
  FolderX,
  MoreVertical,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  daysLeftLabel,
  deletedLabel,
} from "@/components/recycle-bin/recycle-bin-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  RecycleBinImage,
  RecycleBinProjectState,
} from "@/lib/types/recycle-bin";
import { cn } from "@/lib/utils";

/** Why an image cannot be restored right now, or null when it can. */
export function restoreBlockedReason(state: RecycleBinProjectState) {
  if (state === "in_bin") return "Restore project first";
  if (state === "gone") return "Project was permanently deleted";
  return null;
}

const projectStateDetails: Record<
  Exclude<RecycleBinProjectState, "active">,
  { label: string; tooltip: string; className: string }
> = {
  in_bin: {
    label: "Project is in the Recycle Bin",
    tooltip:
      "Restore this image's project from the Projects tab first, then restore the image.",
    className: "text-amber-600 dark:text-amber-500",
  },
  gone: {
    label: "Project permanently deleted",
    tooltip:
      "This image's project was permanently deleted, so the image can't be restored. You can still delete it permanently.",
    className: "text-destructive",
  },
};

type RecycleBinImageCardProps = {
  image: RecycleBinImage;
  now: number;
  isSelected: boolean;
  /** Another bin action is running; actions are disabled. */
  disabled: boolean;
  pendingAction: "restore" | "delete" | null;
  error?: string;
  onSelectionChange: (id: string, isSelected: boolean) => void;
  onRestore: (image: RecycleBinImage) => void;
  onDelete: (image: RecycleBinImage) => void;
};

export function RecycleBinImageCard({
  image,
  now,
  isSelected,
  disabled,
  pendingAction,
  error,
  onSelectionChange,
  onRestore,
  onDelete,
}: RecycleBinImageCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const blockedReason = restoreBlockedReason(image.projectState);
  const stateDetails =
    image.projectState === "active" ? null : projectStateDetails[image.projectState];

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card p-2.5 text-card-foreground shadow-sm transition-colors",
        isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/20",
      )}
    >
      <div className="aspect-[16/10] overflow-hidden rounded-lg bg-muted">
        {image.thumbnailUrl ? (
          // Signed S3 URLs are not configured for next/image optimisation.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            Preview unavailable
          </div>
        )}
      </div>

      <div className="space-y-1.5 px-0.5 pb-0.5 pt-3">
        <p className="truncate text-sm font-medium" title={image.fileName}>
          {image.fileName}
        </p>
        <Badge
          variant="outline"
          className="rounded-full border-transparent bg-primary/10 px-2 text-[11px] font-medium text-primary"
        >
          {pendingAction === "restore"
            ? "Restoring..."
            : pendingAction === "delete"
              ? "Deleting..."
              : daysLeftLabel(image.expiresAt, now)}
        </Badge>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate" title={image.projectName}>
            {image.projectName}
          </span>
        </p>
        {stateDetails ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                tabIndex={0}
                className={cn(
                  "flex w-fit items-center gap-1.5 rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  stateDetails.className,
                )}
              >
                <FolderX className="size-3.5 shrink-0" aria-hidden="true" />
                {stateDetails.label}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{stateDetails.tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <time dateTime={image.deletedAt}>{deletedLabel(image.deletedAt, now)}</time>
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <label className="absolute left-3.5 top-3.5 z-10 flex cursor-pointer p-1">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelectionChange(image.id, checked === true)}
          aria-label={`Select ${image.fileName}`}
          className="bg-background shadow-sm"
        />
      </label>

      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className={cn(
              "absolute right-3.5 top-3.5 z-10 size-7 text-foreground/70 hover:bg-background/80",
              isMenuOpen && "bg-background/80",
            )}
            aria-label={`Actions for ${image.fileName}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            disabled={blockedReason !== null}
            onSelect={() => onRestore(image)}
          >
            <RotateCcw />
            <span className="flex flex-col">
              Restore
              {blockedReason ? (
                <span className="text-[11px] text-muted-foreground">
                  {blockedReason}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(image)}
          >
            <Trash2 />
            Delete Permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
