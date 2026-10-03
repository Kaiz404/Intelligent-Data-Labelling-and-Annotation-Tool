"use client";

import Link from "next/link";
import {
  ArrowRightToLine,
  Clock,
  Folder,
  FolderInput,
  Layers,
  MoreVertical,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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
import { formatRelativeTime } from "@/lib/format";
import type { RecentAnnotatedImage } from "@/lib/types/recent-annotations";
import { cn } from "@/lib/utils";

function workspaceHref(image: RecentAnnotatedImage) {
  return `/projects/${image.projectId}/annotate/${image.id}`;
}

type RecentAnnotationCardProps = {
  image: RecentAnnotatedImage;
  now: number;
  isSelected: boolean;
  onSelectionChange: (imageId: string, isSelected: boolean) => void;
  onMove: (image: RecentAnnotatedImage) => void;
  onAdd: (image: RecentAnnotatedImage) => void;
  onExport: (image: RecentAnnotatedImage) => void;
  onDelete: (image: RecentAnnotatedImage) => void;
};

export function RecentAnnotationCard({
  image,
  now,
  isSelected,
  onSelectionChange,
  onMove,
  onAdd,
  onExport,
  onDelete,
}: RecentAnnotationCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const href = workspaceHref(image);

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card p-2.5 text-card-foreground shadow-sm transition-colors hover:border-primary/40",
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
        {/* Stretched link: the whole card opens the workspace. */}
        <Link
          href={href}
          className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          title={image.fileName}
        >
          {image.fileName}
        </Link>
        <Badge
          variant="outline"
          className="rounded-full border-transparent bg-primary/10 px-2 text-[11px] font-medium text-primary"
        >
          {image.annotationCount}{" "}
          {image.annotationCount === 1 ? "annotation" : "annotations"}
        </Badge>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{image.projectName}</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          <time dateTime={image.lastAnnotatedAt}>
            {formatRelativeTime(image.lastAnnotatedAt, now)}
          </time>
        </p>
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
            className={cn(
              "absolute right-3.5 top-3.5 z-10 size-7 text-foreground/70 hover:bg-background/80",
              isMenuOpen && "bg-background/80",
            )}
            aria-label={`Actions for ${image.fileName}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={href}>
              <SquarePen />
              Open in workspace
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onMove(image)}>
            <FolderInput />
            Move to...
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd(image)}>
            <Layers />
            Add to...
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport(image)}>
            <ArrowRightToLine />
            Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onDelete(image)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
