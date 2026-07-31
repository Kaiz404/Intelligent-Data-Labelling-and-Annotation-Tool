"use client";

import { MoreHorizontal } from "lucide-react";
import { formatFileSize } from "@/lib/format";
import type { ImageStatus, ProjectImage } from "@/lib/types/projects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type ImageCardProps = {
  image: ProjectImage;
  isSelected: boolean;
  onSelectionChange: (imageId: string, isSelected: boolean) => void;
  unsplashError?: string | null;
};

function statusClass(status: ImageStatus) {
  return {
    "In Progress": "bg-primary/10 text-primary border-primary/20",
    Annotated: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
    Unannotated: "bg-destructive/10 text-destructive border-destructive/20",
  }[status];
}

export function ImageCard({
  image,
  isSelected,
  onSelectionChange,
  unsplashError,
}: ImageCardProps) {
  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="relative aspect-[4/3] bg-muted">
        {image.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.thumbnailUrl}
            alt={image.fileName}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            {unsplashError ? "No preview" : "Loading..."}
          </div>
        )}
        <div className="absolute left-2 top-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) =>
              onSelectionChange(image.id, checked === true)
            }
            aria-label={`Select ${image.fileName}`}
            className="bg-background"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-8 bg-background/80"
          aria-label={`Menu for ${image.fileName}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </div>
      <CardContent className="space-y-2 p-3">
        <p className="truncate text-sm font-medium">{image.fileName}</p>
        <Badge
          variant="outline"
          className={cn("text-xs", statusClass(image.status))}
        >
          {image.status}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(image.sizeMb)} · {image.capturedAt}
        </p>
      </CardContent>
    </Card>
  );
}
