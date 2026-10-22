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
  Trash2
} from "lucide-react";
import { memo, useState } from "react";
import { ThumbhashImage } from "@/components/thumbhash-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/format";
import { rememberProjectPreview } from "@/lib/projects/preview-cache";
import type { RecentAnnotatedImage } from "@/lib/types/recent-annotations";
import { cn } from "@/lib/utils";

function workspaceHref(image: RecentAnnotatedImage) {
  return `/projects/${image.projectId}/annotate/${image.id}`;
}

type RecentAnnotationCardProps = {
  image: RecentAnnotatedImage;
  now: number;
  reveal?: boolean;
  isSelected: boolean;
  onSelectionChange: (imageId: string, isSelected: boolean) => void;
  onMove: (image: RecentAnnotatedImage) => void;
  onAdd: (image: RecentAnnotatedImage) => void;
  onExport: (image: RecentAnnotatedImage) => void;
  onDelete: (image: RecentAnnotatedImage) => void;
};

/** Memoised: the grid re-renders on every keystroke and selection change. */
export const RecentAnnotationCard = memo(function RecentAnnotationCard({
  image,
  now,
  reveal = false,
  isSelected,
  onSelectionChange,
  onMove,
  onAdd,
  onExport,
  onDelete
}: RecentAnnotationCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const href = workspaceHref(image);

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-card p-2.5 text-card-foreground shadow-sm transition-colors hover:border-primary/40",
        reveal && "animate-in fade-in-0 duration-300",
        isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/20",
      )}
    >
      <div className="aspect-[16/10] overflow-hidden rounded-lg bg-muted">
        {image.url ? (
          <ThumbhashImage
            src={image.url}
            alt=""
            thumbhash={image.thumbhash}
            className="size-full"
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
          prefetch={false}
          onClick={() =>
            rememberProjectPreview({
              id: image.projectId,
              name: image.projectName,
              description: null,
              starred: false,
              created_at: "",
              updated_at: "",
              user_id: null,
            })
          }
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

      <label
        className={cn(
          "absolute left-3.5 top-3.5 z-10 flex cursor-pointer rounded-md p-1 transition-opacity duration-150",
          isSelected
            ? "opacity-100"
            : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) =>
            onSelectionChange(image.id, checked === true)
          }
          aria-label={`Select ${image.fileName}`}
          className="bg-background shadow-sm size-5"
        />
      </label>

      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "absolute right-3.5 top-3.5 z-10 size-6 shadow-sm transition-all duration-150",
              "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
              "group-hover:bg-background hover:bg-background",
              isMenuOpen && "bg-background opacity-100 md:opacity-100"
            )}
            aria-label={`Actions for ${image.fileName}`}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link href={href} prefetch={false}>
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
});
