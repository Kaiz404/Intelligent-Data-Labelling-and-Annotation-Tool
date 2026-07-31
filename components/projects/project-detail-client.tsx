"use client";

import { Pencil, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { ImageCard } from "@/components/projects/image-card";
import {
  reverseSortDirection,
  SortOrderButton,
  type SortDirection,
} from "@/components/projects/sort-order-button";
import { UploadImagesDialog } from "@/components/projects/upload-images-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ImageStatus, Project, ProjectImage } from "@/lib/types/projects";

const imageStatusFilters = [
  "All",
  "In Progress",
  "Annotated",
  "Unannotated",
] as const;

const imageSortOptions = ["Date Added", "Name", "Status"] as const;
const imageFilterOptions = ["All", "Selected"] as const;

type ImageStatusFilter = (typeof imageStatusFilters)[number];
type ImageSortOption = (typeof imageSortOptions)[number];
type ImageFilterOption = (typeof imageFilterOptions)[number];

const defaultImageSortDirections: Record<ImageSortOption, SortDirection> = {
  "Date Added": "ascending",
  Name: "ascending",
  Status: "ascending",
};

type ProjectDetailClientProps = {
  project: Project;
  images: ProjectImage[];
  unsplashError: string | null;
};

export function ProjectDetailClient({
  project,
  images,
  unsplashError,
}: ProjectDetailClientProps) {
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterBy, setFilterBy] = useState<ImageFilterOption>("All");
  const [statusFilter, setStatusFilter] = useState<ImageStatusFilter>("All");
  const [sortBy, setSortBy] = useState<ImageSortOption>("Date Added");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    defaultImageSortDirections["Date Added"],
  );
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const visibleImages = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return images
      .filter((image) =>
        image.fileName.toLowerCase().includes(normalizedSearch),
      )
      .filter((image) =>
        statusFilter === "All" ? true : image.status === statusFilter,
      )
      .filter((image) =>
        filterBy === "Selected"
          ? selectedImageIds.includes(image.id)
          : true,
      )
      .sort((first, second) => {
        let comparison = 0;

        if (sortBy === "Name") {
          comparison = first.fileName.localeCompare(second.fileName);
        } else if (sortBy === "Status") {
          comparison = first.status.localeCompare(second.status);
        } else {
          comparison = first.id.localeCompare(second.id);
        }

        return sortDirection === "ascending" ? comparison : -comparison;
      });
  }, [
    filterBy,
    images,
    search,
    selectedImageIds,
    sortBy,
    sortDirection,
    statusFilter,
  ]);

  function handleSortChange(nextSortBy: ImageSortOption) {
    setSortBy(nextSortBy);
    setSortDirection(defaultImageSortDirections[nextSortBy]);
  }

  function handleSelectionChange(imageId: string, isSelected: boolean) {
    setSelectedImageIds((currentIds) =>
      isSelected
        ? [...currentIds, imageId]
        : currentIds.filter((id) => id !== imageId),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled
                  aria-label="Edit project name (coming soon)"
                >
                  <Pencil className="size-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </div>
          {project.description ? (
            <p className="text-muted-foreground">{project.description}</p>
          ) : null}
          {unsplashError ? (
            <p className="text-xs text-muted-foreground">{unsplashError}</p>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => setIsUploadOpen(true)}>
          <Upload className="size-4" />
          Upload Images
        </Button>
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
            <span className="text-muted-foreground">Filter By:</span>
            <Select
              value={filterBy}
              onValueChange={(v) => setFilterBy(v as ImageFilterOption)}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageFilterOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as ImageStatusFilter)
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageStatusFilters.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort By:</span>
            <Select
              value={sortBy}
              onValueChange={(v) => handleSortChange(v as ImageSortOption)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {imageSortOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SortOrderButton
            direction={sortDirection}
            label="image sort order"
            onToggle={() => setSortDirection(reverseSortDirection)}
          />
        </div>
      </div>

      {visibleImages.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          No images match your filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleImages.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              isSelected={selectedImageIds.includes(image.id)}
              onSelectionChange={handleSelectionChange}
              unsplashError={unsplashError}
            />
          ))}
        </div>
      )}

      <UploadImagesDialog open={isUploadOpen} onOpenChange={setIsUploadOpen} />
    </div>
  );
}
