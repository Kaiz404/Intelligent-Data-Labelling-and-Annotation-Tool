"use client";

import Link from "next/link";
import {
  ArrowRightToLine,
  FolderInput,
  Layers,
  Route,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import {
  ImageTransferDialog,
  type ImageTransferSource,
} from "@/components/projects/image-action-dialogs";
import {
  reverseSortDirection,
  SortOrderButton,
  type SortDirection,
} from "@/components/projects/sort-order-button";
import { RecentAnnotationCard } from "@/components/recent-annotations/recent-annotation-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { deleteProjectImages } from "@/lib/actions/images";
import { getProjectExportData } from "@/lib/actions/projects";
import type { AnnotationLabel } from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";
import type { RecentAnnotatedImage } from "@/lib/types/recent-annotations";

const ALL_PROJECTS = "all";

const sortOptions = {
  lastAnnotated: { label: "Last Annotated", defaultDirection: "descending" },
  name: { label: "Name", defaultDirection: "ascending" },
  annotationCount: { label: "Annotations", defaultDirection: "descending" },
} as const satisfies Record<string, { label: string; defaultDirection: SortDirection }>;

type SortOption = keyof typeof sortOptions;

type ProjectGroup = {
  projectId: string;
  projectName: string;
  images: RecentAnnotatedImage[];
};

type ExportState = {
  projectId: string;
  projectName: string;
  images: ProjectImage[];
  labels: AnnotationLabel[];
};

function groupByProject(images: RecentAnnotatedImage[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const image of images) {
    const group = groups.get(image.projectId) ?? {
      projectId: image.projectId,
      projectName: image.projectName,
      images: [],
    };
    group.images.push(image);
    groups.set(image.projectId, group);
  }
  return [...groups.values()];
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

/** Server render time advanced by client-side elapsed time (immune to clock skew). */
function useNow(serverNow: number) {
  const [tick, setTick] = useState({ base: serverNow, elapsed: 0 });
  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setTick({ base: serverNow, elapsed: Date.now() - startedAt }),
      60_000,
    );
    return () => window.clearInterval(id);
  }, [serverNow]);
  return serverNow + (tick.base === serverNow ? tick.elapsed : 0);
}

type RecentAnnotationsClientProps = {
  images: RecentAnnotatedImage[];
  /** Every owned project, as Move/Add destinations. */
  projects: Project[];
  limit: number;
  isCapped: boolean;
  serverNow: number;
};

export function RecentAnnotationsClient({
  images,
  projects,
  limit,
  isCapped,
  serverNow,
}: RecentAnnotationsClientProps) {
  const router = useRouter();
  const now = useNow(serverNow);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [sortBy, setSortBy] = useState<SortOption>("lastAnnotated");
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    sortOptions.lastAnnotated.defaultDirection,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const [transfer, setTransfer] = useState<{
    mode: "copy" | "move";
    imageIds: string[];
    sources: ImageTransferSource[];
  } | null>(null);
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [isExportLoading, setIsExportLoading] = useState(false);

  const [deleteTargets, setDeleteTargets] = useState<RecentAnnotatedImage[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const projectOptions = useMemo(
    () =>
      groupByProject(images)
        .map(({ projectId, projectName }) => ({ projectId, projectName }))
        .sort((a, b) => a.projectName.localeCompare(b.projectName)),
    [images],
  );
  // A filtered project can disappear after a move/delete; fall back to all.
  const activeProjectFilter = projectOptions.some(
    (option) => option.projectId === projectFilter,
  )
    ? projectFilter
    : ALL_PROJECTS;

  const visibleImages = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const byLastAnnotated = (a: RecentAnnotatedImage, b: RecentAnnotatedImage) =>
      Date.parse(a.lastAnnotatedAt) - Date.parse(b.lastAnnotatedAt);

    return images
      .filter((image) => image.fileName.toLowerCase().includes(normalizedSearch))
      .filter(
        (image) =>
          activeProjectFilter === ALL_PROJECTS ||
          image.projectId === activeProjectFilter,
      )
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === "name") {
          comparison = a.fileName.localeCompare(b.fileName, undefined, {
            numeric: true,
            sensitivity: "base",
          });
        } else if (sortBy === "annotationCount") {
          comparison = a.annotationCount - b.annotationCount;
        } else {
          comparison = byLastAnnotated(a, b);
        }
        if (sortDirection === "descending") comparison = -comparison;
        // Ties: most recently annotated first.
        return comparison || byLastAnnotated(b, a);
      });
  }, [activeProjectFilter, images, search, sortBy, sortDirection]);

  const selectedImages = useMemo(
    () => images.filter((image) => selectedIds.includes(image.id)),
    [images, selectedIds],
  );
  const selectedProjectCount = new Set(
    selectedImages.map((image) => image.projectId),
  ).size;
  const hasFilters = search.trim() !== "" || activeProjectFilter !== ALL_PROJECTS;

  function handleSortChange(next: SortOption) {
    setSortBy(next);
    setSortDirection(sortOptions[next].defaultDirection);
  }

  function handleSelectionChange(imageId: string, isSelected: boolean) {
    setSelectedIds((current) =>
      isSelected
        ? current.includes(imageId) ? current : [...current, imageId]
        : current.filter((id) => id !== imageId),
    );
  }

  function deselect(imageIds: string[]) {
    setSelectedIds((current) => current.filter((id) => !imageIds.includes(id)));
  }

  function openTransfer(mode: "copy" | "move", targets: RecentAnnotatedImage[]) {
    if (targets.length === 0) return;
    setActionError(null);
    setTransfer({
      mode,
      imageIds: targets.map((image) => image.id),
      sources: groupByProject(targets).map((group) => ({
        projectId: group.projectId,
        imageIds: group.images.map((image) => image.id),
      })),
    });
    setIsTransferOpen(true);
  }

  async function openExport(targets: RecentAnnotatedImage[]) {
    const [first] = targets;
    if (!first || isExportLoading) return;
    if (targets.some((image) => image.projectId !== first.projectId)) {
      setActionError("Select images from one project to export.");
      return;
    }

    setIsExportLoading(true);
    setActionError(null);
    try {
      // Fresh signed URLs, saved annotations, and the project's label list.
      const data = await getProjectExportData(first.projectId);
      const targetIds = new Set(targets.map((image) => image.id));
      const exportImages = data.images.filter((image) => targetIds.has(image.id));
      if (exportImages.length === 0) {
        throw new Error("The selected images no longer exist.");
      }
      setExportState({
        projectId: data.project.id,
        projectName: data.project.name,
        images: exportImages,
        labels: data.labels,
      });
    } catch (cause) {
      setActionError(errorMessage(cause, "Could not prepare the export."));
    } finally {
      setIsExportLoading(false);
    }
  }

  function openDelete(targets: RecentAnnotatedImage[]) {
    if (targets.length === 0) return;
    setActionError(null);
    setDeleteError(null);
    setDeleteTargets(targets);
  }

  async function handleDelete() {
    if (deleteTargets.length === 0 || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);

    const deleted: string[] = [];
    try {
      // deleteProjectImages verifies ownership per project, so run one call per group.
      for (const group of groupByProject(deleteTargets)) {
        const ids = group.images.map((image) => image.id);
        await deleteProjectImages(ids, group.projectId);
        deleted.push(...ids);
      }
      deselect(deleted);
      setDeleteTargets([]);
      refresh();
    } catch (cause) {
      const message = errorMessage(cause, "Could not delete the images.");
      if (deleted.length > 0) {
        // Keep the remaining images in the dialog so the user can retry them.
        setDeleteError(
          `${deleted.length} of ${deleteTargets.length} images were deleted before an error: ${message}`,
        );
        deselect(deleted);
        setDeleteTargets((current) =>
          current.filter((image) => !deleted.includes(image.id)),
        );
        refresh();
      } else {
        setDeleteError(message);
      }
    } finally {
      setIsDeleting(false);
    }
  }

  const deleteProjectCount = new Set(deleteTargets.map((image) => image.projectId)).size;
  const deleteSubject =
    deleteTargets.length === 1
      ? deleteTargets[0].fileName
      : `${deleteTargets.length} images`;
  const deleteScope =
    deleteProjectCount > 1
      ? `from ${deleteProjectCount} projects`
      : deleteTargets[0]
        ? `from ${deleteTargets[0].projectName}`
        : "";

  if (images.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Route className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="font-medium">No annotated images yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Open a project and annotate an image. Your latest work across all
            projects will show up here.
          </p>
        </div>
        <Button asChild className="mt-2">
          <Link href="/projects">Go to Projects</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={selectedImages.length > 0 ? "space-y-4 pb-20" : "space-y-4"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search images..."
            aria-label="Search images by file name"
            className="pl-9"
            type="search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={activeProjectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="w-[180px]" aria-label="Filter by project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PROJECTS}>All Projects</SelectItem>
              {projectOptions.map((option) => (
                <SelectItem key={option.projectId} value={option.projectId}>
                  {option.projectName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(value) => handleSortChange(value as SortOption)}
          >
            <SelectTrigger aria-label="Sort images">
              <span className="text-muted-foreground">Sort By:</span>
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
          <SortOrderButton
            direction={sortDirection}
            label="sort direction"
            onToggle={() => setSortDirection(reverseSortDirection)}
          />
        </div>
      </div>

      {isCapped ? (
        <p className="text-xs text-muted-foreground">
          Showing the {limit} most recently annotated images.
        </p>
      ) : null}

      {actionError ? (
        <div className="flex items-start justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{actionError}</p>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 rounded-sm opacity-70 hover:opacity-100"
            aria-label="Dismiss error"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {visibleImages.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          <p>No images match your filters.</p>
          {hasFilters ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setProjectFilter(ALL_PROJECTS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleImages.map((image) => (
            <RecentAnnotationCard
              key={image.id}
              image={image}
              now={now}
              isSelected={selectedIds.includes(image.id)}
              onSelectionChange={handleSelectionChange}
              onMove={(target) => openTransfer("move", [target])}
              onAdd={(target) => openTransfer("copy", [target])}
              onExport={(target) => void openExport([target])}
              onDelete={(target) => openDelete([target])}
            />
          ))}
        </div>
      )}

      {selectedImages.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border bg-background/95 p-2 shadow-xl backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 px-2 text-sm text-muted-foreground">
            <Checkbox
              checked
              onCheckedChange={(checked) => {
                if (!checked) setSelectedIds([]);
              }}
              aria-label="Clear selection"
            />
            {selectedImages.length} Selected
          </label>
          <Separator orientation="vertical" className="hidden h-6 sm:block" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openTransfer("move", selectedImages)}
          >
            <FolderInput className="size-4" />
            Move to...
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openTransfer("copy", selectedImages)}
          >
            <Layers className="size-4" />
            Add to...
          </Button>
          {selectedProjectCount === 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isExportLoading}
              onClick={() => void openExport(selectedImages)}
            >
              <ArrowRightToLine className="size-4" />
              {isExportLoading ? "Preparing..." : "Export"}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons swallow pointer events; the span keeps the tooltip working. */}
                <span tabIndex={0} className="rounded-md">
                  <Button type="button" variant="outline" size="sm" disabled>
                    <ArrowRightToLine className="size-4" />
                    Export
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Select images from one project to export</TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:text-destructive"
            onClick={() => openDelete(selectedImages)}
          >
            <Trash2 className="size-4" />
            Delete
          </Button>
        </div>
      ) : null}

      {transfer ? (
        <ImageTransferDialog
          open={isTransferOpen}
          onOpenChange={setIsTransferOpen}
          mode={transfer.mode}
          projects={projects}
          sources={transfer.sources}
          onComplete={deselect}
        />
      ) : null}

      {exportState ? (
        <AnnotationExportSheet
          key={exportState.images.map((image) => image.id).join(",")}
          open
          onOpenChange={(open) => {
            if (!open) setExportState(null);
          }}
          projectId={exportState.projectId}
          projectName={exportState.projectName}
          images={exportState.images}
          labels={exportState.labels}
        />
      ) : null}

      <Dialog
        open={deleteTargets.length > 0}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteTargets([]);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {deleteTargets.length === 1 ? "image" : "images"}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete {deleteSubject} {deleteScope},
              including {deleteTargets.length === 1 ? "its" : "their"}{" "}
              annotations. There is no Recycle Bin yet, so this cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => {
                setDeleteTargets([]);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting
                ? "Deleting..."
                : `Delete ${deleteTargets.length === 1 ? "image" : `${deleteTargets.length} images`}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
