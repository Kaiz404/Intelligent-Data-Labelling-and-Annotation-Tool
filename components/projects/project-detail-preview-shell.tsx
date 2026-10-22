"use client";

import {
  FileArchive,
  Pencil,
  Search,
  Upload,
  WandSparkles,
} from "lucide-react";
import { ProjectImageGridSkeleton } from "@/components/projects/project-image-grid-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StreamingLoadBanner } from "@/components/ui/streaming-load-banner";
import { numberFormatter } from "@/lib/format";
import type { Project } from "@/lib/types/projects";

const imageFilterOptions = { all: "All" } as const;
const imageStatusFilters = { all: "All" } as const;
const imageSortOptions = { added: "Date Added" } as const;

/**
 * Instant project-detail chrome from list preview data. Does not fetch workspace
 * data — the page segment owns a single client load when it mounts.
 */
export function ProjectDetailPreviewShell({ project }: { project: Project }) {
  const expected = project.image_count ?? 8;

  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading project">
      <StreamingLoadBanner
        title="Loading project images…"
        description="Your filters and actions are ready. Thumbnails will appear as they arrive."
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled
              aria-label="Edit project"
            >
              <Pencil className="size-4 text-muted-foreground" />
            </Button>
          </div>
          {project.description ? (
            <p className="text-muted-foreground">{project.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled className="text-primary border-primary">
            <Upload className="size-4 text-primary" />
            Upload Images
          </Button>
          <Button type="button" variant="outline" disabled className="text-primary border-primary">
            <FileArchive className="size-4 text-primary" />
            Import Dataset
          </Button>
          <Button disabled className="bg-violet-600 text-white hover:bg-violet-700">
            <WandSparkles className="size-4" />
            AI Annotate
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            disabled
            placeholder="Search images..."
            className="pl-9"
            type="search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filter By:</span>
          <Select disabled value="all">
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(imageFilterOptions).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">Status:</span>
          <Select disabled value="all">
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(imageStatusFilters).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">Sort By:</span>
          <Select disabled value="added">
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(imageSortOptions).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>Select all</span>
          <span>
            Loading {numberFormatter.format(expected)} images…
          </span>
        </div>
        <ProjectImageGridSkeleton count={Math.min(expected || 8, 8)} />
      </div>
    </div>
  );
}
