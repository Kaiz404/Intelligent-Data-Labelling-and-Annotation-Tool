"use client";

import { CopyPlus, Download, FolderInput, Pencil, Search, Trash2, Upload, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useMemo, useState } from "react";
import { moveImagesToRecycleBin } from "@/lib/actions/recycle-bin";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import { AiJobBanner } from "@/components/projects/ai-job-banner";
import { BatchAiAnnotateDialog } from "@/components/projects/batch-ai-annotate-dialog";
import { ImageCard } from "@/components/projects/image-card";
import { ImageTransferDialog, RenameImageDialog } from "@/components/projects/image-action-dialogs";
import {
  reverseSortDirection,
  SortOrderButton,
  type SortDirection
} from "@/components/projects/sort-order-button";
import { UploadImagesDialog } from "@/components/projects/upload-images-dialog";
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
  SelectValue
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAnnotationJob } from "@/hooks/use-annotation-job";
import { useQueryParams } from "@/hooks/use-query-params";
import type {
  AnnotationJobProgress,
  AnnotationLabel,
  ImageAiState,
} from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

const imageStatusFilters = {
  all: "All",
  "in-progress": "In Progress",
  annotated: "Annotated",
  unannotated: "Unannotated",
} as const;

const imageSortOptions = {
  added: { label: "Date Added", defaultDirection: "ascending" },
  name: { label: "Name", defaultDirection: "ascending" },
  status: { label: "Status", defaultDirection: "ascending" },
} as const satisfies Record<string, { label: string; defaultDirection: SortDirection }>;

const imageFilterOptions = {
  all: "All",
  selected: "Selected",
  ai: "AI suggestions",
} as const;

type ImageStatusFilter = keyof typeof imageStatusFilters;
type ImageSortOption = keyof typeof imageSortOptions;
type ImageFilterOption = keyof typeof imageFilterOptions;

/** `dir` is empty while the sort's default direction applies. */
const QUERY_DEFAULTS = { q: "", filter: "all", status: "all", sort: "added", dir: "" };

function optionOr<T extends string>(options: Record<T, unknown>, value: string, fallback: NoInfer<T>): T {
  return Object.hasOwn(options, value) ? (value as T) : fallback;
}

type ProjectDetailClientProps = {
  project: Project;
  images: ProjectImage[];
  projects: Project[];
  labels: AnnotationLabel[];
  initialJob: AnnotationJobProgress | null;
  initialAiStates: Record<string, ImageAiState>;
};

export function ProjectDetailClient({
  project,
  images: serverImages,
  projects,
  labels,
  initialJob,
  initialAiStates,
}: ProjectDetailClientProps) {
  const router = useRouter();
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [query, setQuery] = useQueryParams(QUERY_DEFAULTS);
  // Typed text updates at once; the URL only keeps it for revisits.
  const [search, setSearch] = useState(query.q);
  const filterBy = optionOr(imageFilterOptions, query.filter, "all");
  const statusFilter = optionOr(imageStatusFilters, query.status, "all");
  const sortBy = optionOr(imageSortOptions, query.sort, "added");
  const sortDirection: SortDirection =
    query.dir === "ascending" || query.dir === "descending"
      ? query.dir
      : imageSortOptions[sortBy].defaultDirection;
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectImage | null>(null);
  const [transferMode, setTransferMode] = useState<"copy" | "move" | null>(null);
  const [transferImageIds, setTransferImageIds] = useState<string[]>([]);
  const [exportImages, setExportImages] = useState<ProjectImage[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ProjectImage[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isAiOpen, setIsAiOpen] = useState(false);
  // Applied as soon as an action succeeds; the refresh then confirms them.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [renames, setRenames] = useState<
    ReadonlyMap<string, { from: string; to: string }>
  >(() => new Map());

  const images = useMemo(
    () =>
      serverImages.flatMap((image) => {
        if (removedIds.has(image.id)) return [];
        const rename = renames.get(image.id);
        // Only until the server copy changes: then it is the source of truth.
        return rename && rename.from === image.fileName
          ? [{ ...image, fileName: rename.to }]
          : [image];
      }),
    [removedIds, renames, serverImages],
  );

  const refresh = useCallback(() => {
    // Let client state commit before merging the refreshed Server Component
    // payload into this client boundary.
    startTransition(() => router.refresh());
  }, [router]);

  const {
    job: aiJob,
    states: aiStates,
    isActive: isAiJobActive,
    start: startAiJob,
    cancel: cancelAiJob,
  } = useAnnotationJob({
    initialJob,
    initialStates: initialAiStates,
    onFinished: refresh,
  });

  const imageIds = useMemo(() => images.map((image) => image.id), [images]);
  const reviewImageIds = useMemo(
    () => imageIds.filter((id) => (aiStates[id]?.pendingSuggestions ?? 0) > 0),
    [aiStates, imageIds],
  );
  const failedImageIds = useMemo(
    () => imageIds.filter((id) => aiStates[id]?.status === "failed"),
    [aiStates, imageIds],
  );
  const reviewHref = reviewImageIds[0]
    ? `/projects/${project.id}/annotate/${reviewImageIds[0]}`
    : null;
  const selectedIdSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);

  const visibleImages = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const status = imageStatusFilters[statusFilter];
    // Images arrive oldest first (`created_at`), so their index is the upload order.
    const uploadOrder = new Map(images.map((image, index) => [image.id, index]));

    return images
      .filter((image) =>
        image.fileName.toLowerCase().includes(normalizedSearch)
      )
      .filter((image) =>
        statusFilter === "all" ? true : image.status === status
      )
      .filter((image) =>
        filterBy === "selected"
          ? selectedIdSet.has(image.id)
          : filterBy === "ai"
            ? (aiStates[image.id]?.pendingSuggestions ?? 0) > 0
            : true
      )
      .sort((first, second) => {
        let comparison = 0;

        if (sortBy === "name") {
          comparison = first.fileName.localeCompare(second.fileName);
        } else if (sortBy === "status") {
          comparison = first.status.localeCompare(second.status);
        } else {
          comparison = uploadOrder.get(first.id)! - uploadOrder.get(second.id)!;
        }

        return sortDirection === "ascending" ? comparison : -comparison;
      });
  }, [
    aiStates,
    filterBy,
    images,
    search,
    selectedIdSet,
    sortBy,
    sortDirection,
    statusFilter
  ]);

  function handleSortChange(nextSortBy: ImageSortOption) {
    // Radix Select reports "" when it unmounts during navigation.
    if (!nextSortBy) return;
    setQuery({ sort: nextSortBy, dir: "" });
  }

  function toggleSortDirection() {
    const next = reverseSortDirection(sortDirection);
    setQuery({
      dir: next === imageSortOptions[sortBy].defaultDirection ? "" : next,
    });
  }

  const hideImages = useCallback((ids: string[]) => {
    setRemovedIds((current) => new Set([...current, ...ids]));
    setSelectedImageIds((currentIds) =>
      currentIds.filter((id) => !ids.includes(id)),
    );
  }, []);

  // Stable callbacks, so a memoised card re-renders only when its own props change.
  const handleSelectionChange = useCallback((imageId: string, isSelected: boolean) => {
    setSelectedImageIds((currentIds) =>
      isSelected
        ? [...currentIds, imageId]
        : currentIds.filter((id) => id !== imageId)
    );
  }, []);

  const openTransfer = useCallback((mode: "copy" | "move", targetImages: ProjectImage[]) => {
    setTransferImageIds(targetImages.map((image) => image.id));
    setTransferMode(mode);
  }, []);
  const openMove = useCallback((image: ProjectImage) => openTransfer("move", [image]), [openTransfer]);
  const openAdd = useCallback((image: ProjectImage) => openTransfer("copy", [image]), [openTransfer]);
  const openExport = useCallback((image: ProjectImage) => setExportImages([image]), []);
  const openDelete = useCallback((image: ProjectImage) => {
    setDeleteError(null);
    setDeleteTargets([image]);
  }, []);

  async function handleDeleteImage() {
    if (deleteTargets.length === 0 || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const ids = deleteTargets.map((image) => image.id);
      const result = await moveImagesToRecycleBin(project.id, ids);
      if (!result.ok) {
        setDeleteError(result.error);
        return;
      }
      hideImages(ids);
      setDeleteTargets([]);
      router.refresh();
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Could not move the images to the Recycle Bin.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  const selectedImages = images.filter((image) => selectedIdSet.has(image.id));

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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setIsUploadOpen(true)}
            className="text-primary border-primary hover:text-primary"
          >
            <Upload className="size-4 text-primary" />
            Upload Images
          </Button>
          <Button
            onClick={() => setIsAiOpen(true)}
            disabled={images.length === 0 || isAiJobActive}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            <WandSparkles className="size-4" />
            AI Annotate
          </Button>
        </div>
      </div>

      {aiJob ? (
        <AiJobBanner
          job={aiJob}
          reviewImageCount={reviewImageIds.length}
          reviewHref={reviewHref}
          failedImageIds={failedImageIds}
          onCancel={cancelAiJob}
          onRetryFailed={() => {
            setSelectedImageIds(failedImageIds);
            setIsAiOpen(true);
          }}
        />
      ) : null}

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
            <span className="text-muted-foreground">Filter By:</span>
            <Select
              value={filterBy}
              onValueChange={(value) => {
                if (value) setQuery({ filter: value });
              }}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(imageFilterOptions) as ImageFilterOption[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {imageFilterOptions[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                if (value) setQuery({ status: value });
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(imageStatusFilters) as ImageStatusFilter[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {imageStatusFilters[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sort By:</span>
            <Select
              value={sortBy}
              onValueChange={(value) => handleSortChange(value as ImageSortOption)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(imageSortOptions) as ImageSortOption[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {imageSortOptions[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SortOrderButton
            direction={sortDirection}
            label="image sort order"
            onToggle={toggleSortDirection}
          />
        </div>
      </div>

      {images.length === 0 ? (
        <div
          key="empty-images"
          className="rounded-lg border border-dashed py-16 text-center text-muted-foreground"
        >
          No images have been uploaded to this project yet.
        </div>
      ) : visibleImages.length === 0 ? (
        <div
          key="no-filter-results"
          className="rounded-lg border border-dashed py-16 text-center text-muted-foreground"
        >
          No images match your filters.
        </div>
      ) : (
        <div
          key="image-grid"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {visibleImages.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              projectId={project.id}
              isSelected={selectedIdSet.has(image.id)}
              selectionMode={selectedImageIds.length > 0}
              aiState={aiStates[image.id]}
              onSelectionChange={handleSelectionChange}
              onRename={setRenameTarget}
              onMove={openMove}
              onAdd={openAdd}
              onExport={openExport}
              onDelete={openDelete}
            />
          ))}
        </div>
      )}

      {selectedImages.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border bg-background/95 p-2 shadow-xl backdrop-blur">
          <label className="flex items-center gap-2 px-2 text-sm text-muted-foreground"><Checkbox checked onCheckedChange={(checked) => { if (!checked) setSelectedImageIds([]); }} />{selectedImages.length} Selected</label>
          <Button type="button" size="sm" className="bg-violet-600 text-white hover:bg-violet-700" disabled={isAiJobActive} onClick={() => setIsAiOpen(true)}><WandSparkles className="size-4" />AI Annotate</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openTransfer("move", selectedImages)}><FolderInput className="size-4" />Move to...</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => openTransfer("copy", selectedImages)}><CopyPlus className="size-4" />Add to...</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setExportImages(selectedImages)}><Download className="size-4" />Export</Button>
          <Button type="button" variant="outline" size="sm" className="border-destructive text-destructive hover:text-destructive" onClick={() => { setDeleteError(null); setDeleteTargets(selectedImages); }}><Trash2 className="size-4" />Delete</Button>
        </div>
      ) : null}

      <UploadImagesDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        projectId={project.id}
        onUploadComplete={refresh}
      />

      <BatchAiAnnotateDialog
        open={isAiOpen}
        onOpenChange={setIsAiOpen}
        labels={labels}
        imageIds={imageIds}
        selectedImageIds={selectedImageIds}
        aiStates={aiStates}
        onStart={async (input) => {
          await startAiJob({ projectId: project.id, ...input });
          setSelectedImageIds([]);
        }}
      />

      <RenameImageDialog
        image={renameTarget}
        projectId={project.id}
        open={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        onRenamed={(imageId, fileName) => {
          const from = serverImages.find((image) => image.id === imageId)?.fileName;
          if (from === undefined) return;
          setRenames((current) => new Map(current).set(imageId, { from, to: fileName }));
        }}
      />

      <ImageTransferDialog
        open={transferMode !== null}
        onOpenChange={(open) => { if (!open) setTransferMode(null); }}
        mode={transferMode ?? "copy"}
        sourceProject={project}
        projects={projects}
        imageIds={transferImageIds}
        onComplete={(transferredIds) => {
          if (transferMode === "move") hideImages(transferredIds);
          setSelectedImageIds([]);
        }}
      />

      {exportImages ? (
        <AnnotationExportSheet
          key={exportImages.map((image) => image.id).join(",")}
          open
          onOpenChange={(open) => { if (!open) setExportImages(null); }}
          projectId={project.id}
          projectName={project.name}
          images={exportImages}
          labels={labels}
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
            <DialogTitle>Move to Recycle Bin?</DialogTitle>
            <DialogDescription>
              {deleteTargets.length === 1
                ? `“${deleteTargets[0].fileName}” will be moved to the Recycle Bin with its annotations. You can restore it from the Recycle Bin for 30 days. Unreviewed AI suggestions aren't kept.`
                : `${deleteTargets.length} images will be moved to the Recycle Bin with their annotations. You can restore them from the Recycle Bin for 30 days. Unreviewed AI suggestions aren't kept.`}
            </DialogDescription>
          </DialogHeader>

          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setDeleteTargets([])}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => void handleDeleteImage()}
            >
              {isDeleting ? "Moving..." : "Move to Recycle Bin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
