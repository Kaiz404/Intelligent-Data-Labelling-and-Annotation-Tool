"use client";

import Link from "next/link";
import {
  CopyPlus,
  Download,
  FolderInput,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import type { ImageStatus, ProjectImage } from "@/lib/types/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type ImageCardProps = {
  image: ProjectImage;
  projectId: string;
  isSelected: boolean;
  onSelectionChange: (imageId: string, isSelected: boolean) => void;
  onRename: (image: ProjectImage) => void;
  onMove: (image: ProjectImage) => void;
  onAdd: (image: ProjectImage) => void;
  onExport: (image: ProjectImage) => void;
  onDelete: (image: ProjectImage) => void;
};

function statusClass(status: ImageStatus) {
  return {
    "In Progress": "border-primary/20 bg-primary/10 text-primary",
    Annotated: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
    Unannotated: "border-destructive/20 bg-destructive/10 text-destructive",
  }[status];
}

export function ImageCard({
  image,
  projectId,
  isSelected,
  onSelectionChange,
  onRename,
  onMove,
  onAdd,
  onExport,
  onDelete,
}: ImageCardProps) {
  const annotateHref = `/projects/${projectId}/annotate/${image.id}`;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <Card className={cn("group overflow-hidden shadow-sm", isSelected && "border-primary ring-1 ring-primary/20")}>
      <div className="relative aspect-[4/3] bg-muted">
        <Link href={annotateHref} className="absolute inset-0 z-0" aria-label={`Annotate ${image.fileName}`}>
          {image.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.thumbnailUrl} alt={image.fileName} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Preview unavailable</div>
          )}
        </Link>

        <div className={cn("pointer-events-none absolute left-2 top-2 z-10 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100", isSelected && "pointer-events-auto opacity-100")}>
          <Checkbox checked={isSelected} onCheckedChange={(checked) => onSelectionChange(image.id, checked === true)} aria-label={`Select ${image.fileName}`} className="m-1 size-6 bg-background" />
        </div>

        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={cn("pointer-events-none absolute right-3 top-3 z-10 size-6 bg-background opacity-0 shadow-sm transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100", isMenuOpen && "pointer-events-auto opacity-100")} aria-label={`Actions for ${image.fileName}`}><MoreVertical className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onRename(image)}><Pencil />Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(image)}><FolderInput />Move to Existing Project</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAdd(image)}><CopyPlus />Add to Existing Project</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport(image)}><Download />Export</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(image)}><Trash2 />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <CardContent className="space-y-2 p-3">
        <Link href={annotateHref} className="block truncate text-sm font-medium hover:underline">{image.fileName}</Link>
        <Badge variant="outline" className={cn("text-xs", statusClass(image.status))}>{image.status}</Badge>
        <p className="text-xs text-muted-foreground">{formatBytes(image.sizeBytes)} · {image.capturedAt}</p>
      </CardContent>
    </Card>
  );
}
