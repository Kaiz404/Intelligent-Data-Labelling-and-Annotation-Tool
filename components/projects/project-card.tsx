"use client";

import Link from "next/link";
import {
  Clock,
  Copy,
  Download,
  Edit3,
  ImageIcon,
  Images,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { numberFormatter, relativeTimeFromDate, toPercent } from "@/lib/format";
import type { Project } from "@/lib/types/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";

export type ProjectCardAction = "edit" | "duplicate" | "copy" | "delete";

type ProjectCardProps = {
  project: Project;
  exporting?: boolean;
  onAction: (project: Project, action: ProjectCardAction) => void;
  onExport: (project: Project) => void;
};

export function ProjectCard({
  project,
  exporting = false,
  onAction,
  onExport,
}: ProjectCardProps) {
  const imageCount = project.image_count ?? 0;
  const annotatedCount = project.annotated_count ?? 0;
  const progress = toPercent(annotatedCount, imageCount);

  return (
    <Card className="overflow-hidden py-0 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex min-h-[262px] flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/projects/${project.id}`}
            className="block size-16 shrink-0 overflow-hidden rounded-lg bg-muted"
            aria-label={`Open ${project.name}`}
          >
            {project.thumbnailUrl ? (
              <>
                {/* Signed private S3 URLs are generated dynamically server-side. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={project.thumbnailUrl}
                  alt={`${project.name} thumbnail`}
                  className="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
                />
              </>
            ) : null}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${project.name}`}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => onAction(project, "edit")}><Edit3 />Edit Project</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(project, "duplicate")}><Copy />Duplicate Project</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction(project, "copy")}><Images />Copy Images to Project</DropdownMenuItem>
              <DropdownMenuItem disabled={exporting} onSelect={() => onExport(project)}><Download />{exporting ? "Preparing Export..." : "Export"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onAction(project, "delete")}><Trash2 />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Link href={`/projects/${project.id}`} className="mt-3 block space-y-1">
          <h3 className="font-semibold hover:text-primary">{project.name}</h3>
          <p className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
            {project.description || "No project description."}
          </p>
        </Link>

        <div className="mt-auto border-t pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><ImageIcon className="size-3.5" />{numberFormatter.format(imageCount)} images</span>
            <span className="flex items-center gap-1"><Clock className="size-3.5" />Edited {relativeTimeFromDate(project.updated_at)}</span>
          </div>
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-xs"><span>Progress</span><span>{progress}%</span></div>
            <Progress value={progress} className="h-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
