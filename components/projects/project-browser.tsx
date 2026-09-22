"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import {
  CopyImagesDialog,
  DeleteProjectDialog,
  DuplicateProjectDialog,
  EditProjectDialog,
} from "@/components/dashboard/project-action-dialogs";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import {
  ProjectCard,
  type ProjectCardAction,
} from "@/components/projects/project-card";
import {
  reverseSortDirection,
  SortOrderButton,
  type SortDirection,
} from "@/components/projects/sort-order-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/lib/types/projects";
import type { AnnotationLabel } from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";
import { getProjectExportData } from "@/lib/actions/projects";

const sortOptions = ["Date Edited", "Name", "Images", "Favourite"] as const;

type SortOption = (typeof sortOptions)[number];

const defaultSortDirections: Record<SortOption, SortDirection> = {
  "Date Edited": "descending",
  Name: "ascending",
  Images: "descending",
  Favourite: "descending",
};

type ProjectBrowserProps = {
  initialProjects: Project[];
};

type ExportData = {
  project: Project;
  images: ProjectImage[];
  labels: AnnotationLabel[];
};

export function ProjectBrowser({ initialProjects }: ProjectBrowserProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Date Edited");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    defaultSortDirections["Date Edited"],
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [action, setAction] = useState<ProjectCardAction | null>(null);
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = projects.filter((project) => {
      const name = project.name ?? "";
      const description = project.description ?? "";
      const matchesSearch =
        !normalizedSearch ||
        name.toLowerCase().includes(normalizedSearch) ||
        description.toLowerCase().includes(normalizedSearch);
      const matchesFavourite =
        sortBy !== "Favourite" || project.starred === true;

      return matchesSearch && matchesFavourite;
    });

    return [...filtered].sort((first, second) => {
      let comparison = 0;

      if (sortBy === "Name") {
        comparison = (first.name ?? "").localeCompare(second.name ?? "");
      } else if (sortBy === "Images") {
        comparison = (first.image_count ?? 0) - (second.image_count ?? 0);
      } else if (sortBy === "Favourite") {
        comparison =
          new Date(second.updated_at ?? 0).getTime() -
          new Date(first.updated_at ?? 0).getTime();
      } else {
        comparison =
          new Date(second.updated_at ?? 0).getTime() -
          new Date(first.updated_at ?? 0).getTime();
      }

      return sortDirection === "ascending" ? comparison : -comparison;
    });
  }, [projects, search, sortBy, sortDirection]);

  function handleSortChange(nextSortBy: SortOption) {
    setSortBy(nextSortBy);
    setSortDirection(defaultSortDirections[nextSortBy]);
  }

  function openAction(project: Project, nextAction: ProjectCardAction) {
    setSelectedProject(project);
    setAction(nextAction);
    setActionError(null);
  }

  async function openExport(project: Project) {
    setExportingProjectId(project.id);
    setActionError(null);
    try {
      setExportData(await getProjectExportData(project.id));
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Could not prepare the export.",
      );
    } finally {
      setExportingProjectId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Projects</h1>
        <p className="text-muted-foreground">
          Manage and organize all your projects
        </p>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects..."
            className="pl-9"
            type="search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort By:</span>
            <Select
              value={sortBy}
              onValueChange={(value) => handleSortChange(value as SortOption)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SortOrderButton
            direction={sortDirection}
            label="project sort order"
            onToggle={() => setSortDirection(reverseSortDirection)}
          />
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="size-4" />
            New Project
          </Button>
        </div>
      </div>

      {actionError ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {visibleProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-muted-foreground">No projects found.</p>
          <Button
            variant="link"
            className="mt-2"
            onClick={() => setIsCreateOpen(true)}
          >
            Create a new project
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              exporting={exportingProjectId === project.id}
              onAction={openAction}
              onExport={(selected) => void openExport(selected)}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      <EditProjectDialog project={selectedProject} open={action === "edit"} onOpenChange={(open) => !open && setAction(null)} />
      <DuplicateProjectDialog project={selectedProject} open={action === "duplicate"} onOpenChange={(open) => !open && setAction(null)} />
      <CopyImagesDialog project={selectedProject} projects={projects} open={action === "copy"} onOpenChange={(open) => !open && setAction(null)} />
      <DeleteProjectDialog project={selectedProject} open={action === "delete"} onOpenChange={(open) => !open && setAction(null)} />
      {exportData ? (
        <AnnotationExportSheet
          key={exportData.project.id}
          open
          onOpenChange={(open) => !open && setExportData(null)}
          projectId={exportData.project.id}
          projectName={exportData.project.name}
          images={exportData.images}
          labels={exportData.labels}
        />
      ) : null}
    </div>
  );
}
