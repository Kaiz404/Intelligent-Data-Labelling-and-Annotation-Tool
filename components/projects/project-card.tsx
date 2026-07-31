"use client";

import Link from "next/link";
import { Clock, ImageIcon, MoreHorizontal, Star } from "lucide-react";
import { toggleProjectStar } from "@/lib/actions/projects";
import {
  numberFormatter,
  relativeTimeFromDate,
  toPercent,
} from "@/lib/format";
import type { Project } from "@/lib/types/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type ProjectCardProps = {
  project: Project;
};

export function ProjectCard({ project }: ProjectCardProps) {
  const progress = 0;

  async function handleStarToggle() {
    await toggleProjectStar(project.id, !project.starred);
  }

  return (
    <Card className="overflow-hidden shadow-sm">
      <div className="relative aspect-[4/3] bg-muted">
        <div className="absolute right-2 top-2 flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 bg-background/80"
            onClick={handleStarToggle}
            aria-label={
              project.starred ? "Remove from favourites" : "Add to favourites"
            }
          >
            <Star
              className={cn(
                "size-4",
                project.starred
                  ? "fill-primary text-primary"
                  : "text-muted-foreground",
              )}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 bg-background/80"
            aria-label={`Menu for ${project.name}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>
      <CardContent className="p-4">
        <Link href={`/projects/${project.id}`} className="block space-y-1">
          <h3 className="font-semibold hover:text-primary">{project.name}</h3>
          {project.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </p>
          ) : null}
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <ImageIcon className="size-3.5" />
            {numberFormatter.format(0)} images
          </span>
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            Edited {relativeTimeFromDate(project.updated_at)}
          </span>
        </div>
        <div className="mt-4 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>Progress</span>
            <span>{toPercent(progress, 100)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}
