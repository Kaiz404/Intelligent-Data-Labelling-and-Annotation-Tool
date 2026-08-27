"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { ImageStatus, ProjectImage } from "@/lib/types/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type ImageCardProps = {
  image: ProjectImage;
  projectId: string;
  isSelected: boolean;
  onSelectionChange: (imageId: string, isSelected: boolean) => void;
};

function statusClass(status: ImageStatus) {
  return {
    "In Progress": "bg-primary/10 text-primary border-primary/20",
    Annotated: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
    Unannotated: "bg-destructive/10 text-destructive border-destructive/20"
  }[status];
}

export function ImageCard({
  image,
  projectId,
  isSelected,
  onSelectionChange,
}: ImageCardProps) {
  const annotateHref = `/projects/${projectId}/annotate/${image.id}`;

  return (
    <Card className="group overflow-hidden shadow-sm">
      <div className="relative aspect-[4/3] bg-muted">
        <Link
          href={annotateHref}
          className="absolute inset-0 z-0"
          aria-label={`Annotate ${image.fileName}`}
        >
          {image.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.thumbnailUrl}
              alt={image.fileName}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
              Preview unavailable
            </div>
          )}
        </Link>

        <div className="pointer-events-none absolute left-2 top-2 z-10 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) =>
              onSelectionChange(image.id, checked === true)
            }
            aria-label={`Select ${image.fileName}`}
            className="bg-background size-6 m-1"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-10 size-6 bg-background opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          aria-label={`Menu for ${image.fileName}`}
        >
          <MoreVertical className="size-4" />
        </Button>
      </div>
      <CardContent className="space-y-2 p-3">
        <Link
          href={annotateHref}
          className="block truncate text-sm font-medium hover:underline"
        >
          {image.fileName}
        </Link>
        <Badge
          variant="outline"
          className={cn("text-xs", statusClass(image.status))}
        >
          {image.status}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {formatBytes(image.sizeBytes)} · {image.capturedAt}
        </p>
      </CardContent>
    </Card>
  );
}
