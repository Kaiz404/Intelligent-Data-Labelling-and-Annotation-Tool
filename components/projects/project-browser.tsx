"use client";

import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
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

export function ProjectBrowser({ initialProjects }: ProjectBrowserProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Date Edited");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    defaultSortDirections["Date Edited"],
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
        comparison = 0;
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visibleProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <CreateProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
