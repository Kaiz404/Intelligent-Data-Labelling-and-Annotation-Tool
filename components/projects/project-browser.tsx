"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AnnotationExportSheet,
  fetchExportData,
} from "@/components/annotate/annotation-export-sheet";
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
import { useQueryParams } from "@/hooks/use-query-params";
import type { Project, ProjectExportData } from "@/lib/types/projects";

const sortOptions = {
  edited: { label: "Date Edited", defaultDirection: "descending" },
  name: { label: "Name", defaultDirection: "ascending" },
  images: { label: "Images", defaultDirection: "descending" },
  favourite: { label: "Favourite", defaultDirection: "descending" },
} as const satisfies Record<string, { label: string; defaultDirection: SortDirection }>;

type SortOption = keyof typeof sortOptions;

/** `dir` is empty while the sort's default direction applies. */
const QUERY_DEFAULTS = { q: "", sort: "edited", dir: "" };

type ProjectBrowserProps = {
  projects: Project[];
};

export function ProjectBrowser({ projects: allProjects }: ProjectBrowserProps) {
  const [query, setQuery] = useQueryParams(QUERY_DEFAULTS);
  const sortBy: SortOption = Object.hasOwn(sortOptions, query.sort)
    ? (query.sort as SortOption)
    : "edited";
  const sortDirection: SortDirection =
    query.dir === "ascending" || query.dir === "descending"
      ? query.dir
      : sortOptions[sortBy].defaultDirection;
  // Typed text updates at once; the URL only keeps it for revisits.
  const [search, setSearch] = useState(query.q);
  // Hidden as soon as they reach the Recycle Bin, before the refresh lands.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const projects = useMemo(
    () => allProjects.filter((project) => !removedIds.has(project.id)),
    [allProjects, removedIds],
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [action, setAction] = useState<ProjectCardAction | null>(null);
  const [exportData, setExportData] = useState<ProjectExportData | null>(null);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
        sortBy !== "favourite" || project.starred === true;

      return matchesSearch && matchesFavourite;
    });

    return [...filtered].sort((first, second) => {
      let comparison = 0;

      if (sortBy === "name") {
        comparison = (first.name ?? "").localeCompare(second.name ?? "");
      } else if (sortBy === "images") {
        comparison = (first.image_count ?? 0) - (second.image_count ?? 0);
      } else {
        comparison =
          new Date(first.updated_at ?? 0).getTime() -
          new Date(second.updated_at ?? 0).getTime();
      }

      return sortDirection === "ascending" ? comparison : -comparison;
    });
  }, [projects, search, sortBy, sortDirection]);

  function handleSortChange(nextSortBy: SortOption) {
    // Radix Select reports "" when it unmounts during navigation.
    if (!nextSortBy) return;
    setQuery({ sort: nextSortBy, dir: "" });
  }

  function toggleSortDirection() {
    const next = reverseSortDirection(sortDirection);
    setQuery({ dir: next === sortOptions[sortBy].defaultDirection ? "" : next });
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
      setExportData(await fetchExportData(project.id));
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setQuery({ q: event.target.value });
            }}
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
                {(Object.keys(sortOptions) as SortOption[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {sortOptions[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SortOrderButton
            direction={sortDirection}
            label="project sort order"
            onToggle={toggleSortDirection}
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
      <DeleteProjectDialog project={selectedProject} open={action === "delete"} onOpenChange={(open) => !open && setAction(null)} onDeleted={(id) => setRemovedIds((current) => new Set(current).add(id))} />
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
