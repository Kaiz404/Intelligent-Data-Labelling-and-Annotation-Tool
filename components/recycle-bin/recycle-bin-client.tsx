"use client";

import Link from "next/link";
import { RotateCcw, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useMemo, useState } from "react";
import {
  reverseSortDirection,
  SortOrderButton,
  type SortDirection,
} from "@/components/projects/sort-order-button";
import {
  RecycleBinImageCard,
  restoreBlockedReason,
} from "@/components/recycle-bin/recycle-bin-image-card";
import { RecycleBinProjectRow } from "@/components/recycle-bin/recycle-bin-project-row";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import {
  deleteRecycleBinItemsPermanently,
  restoreRecycleBinItems,
} from "@/lib/actions/recycle-bin";
import { numberFormatter } from "@/lib/format";
import type {
  RecycleBinContents,
  RecycleBinImage,
  RecycleBinProject,
} from "@/lib/types/recycle-bin";
import { cn } from "@/lib/utils";

type Tab = "projects" | "images";

const ALL_PROJECTS = "all";

const sortOptions = {
  deletedAt: { label: "Deleted Date", defaultDirection: "descending" },
  name: { label: "Name", defaultDirection: "ascending" },
} as const satisfies Record<string, { label: string; defaultDirection: SortDirection }>;

type SortOption = keyof typeof sortOptions;
type SortState = { by: SortOption; direction: SortDirection };

const DEFAULT_SORT: SortState = {
  by: "deletedAt",
  direction: sortOptions.deletedAt.defaultDirection,
};

type Notice = {
  tone: "success" | "error";
  text: string;
  link?: { href: string; label: string };
};

type PendingAction = { kind: "restore" | "delete"; ids: string[] };

// Underline tabs (Figma): primary text + primary underline on the active tab.
const tabTriggerClassName =
  "flex-none rounded-none px-5 pb-2.5 pt-1.5 after:bg-primary group-data-[orientation=horizontal]/tabs:after:bottom-[-1px] data-[state=active]:text-primary dark:data-[state=active]:text-primary";

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function sortItems<T extends { deletedAt: string }>(
  items: T[],
  sort: SortState,
  nameOf: (item: T) => string,
) {
  const byDeletedAt = (a: T, b: T) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt);
  return [...items].sort((a, b) => {
    let comparison =
      sort.by === "name"
        ? nameOf(a).localeCompare(nameOf(b), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : byDeletedAt(a, b);
    if (sort.direction === "descending") comparison = -comparison;
    // Ties: most recently deleted first.
    return comparison || byDeletedAt(b, a);
  });
}

function countLabel(projectCount: number, imageCount: number) {
  const parts: string[] = [];
  if (projectCount > 0) {
    parts.push(`${projectCount} ${projectCount === 1 ? "project" : "projects"}`);
  }
  if (imageCount > 0) {
    parts.push(`${imageCount} ${imageCount === 1 ? "image" : "images"}`);
  }
  return parts.join(" and ") || "0 items";
}

function SortControls({
  sort,
  label,
  onChange,
}: {
  sort: SortState;
  label: string;
  onChange: (sort: SortState) => void;
}) {
  return (
    <>
      <Select
        value={sort.by}
        onValueChange={(value) => {
          const by = value as SortOption;
          onChange({ by, direction: sortOptions[by].defaultDirection });
        }}
      >
        <SelectTrigger aria-label={`Sort ${label}`}>
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
        direction={sort.direction}
        label={`${label} sort direction`}
        onToggle={() =>
          onChange({ ...sort, direction: reverseSortDirection(sort.direction) })
        }
      />
    </>
  );
}

function SearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder.replace(/\.+$/, "")}
        className="pl-9"
        type="search"
      />
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Trash2 className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function NoMatches({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center text-muted-foreground">
      <p>{text}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

type RecycleBinClientProps = RecycleBinContents & {
  retentionDays: number;
};

export function RecycleBinClient({
  projects,
  images,
  serverNow,
  retentionDays,
}: RecycleBinClientProps) {
  const router = useRouter();
  const now = useNow(Date.parse(serverNow));
  const [tab, setTab] = useState<Tab>(
    projects.length === 0 && images.length > 0 ? "images" : "projects",
  );
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSort, setProjectSort] = useState<SortState>(DEFAULT_SORT);
  const [imageSearch, setImageSearch] = useState("");
  const [imageProjectFilter, setImageProjectFilter] = useState(ALL_PROJECTS);
  const [imageSort, setImageSort] = useState<SortState>(DEFAULT_SORT);
  const [selectedIds, setSelectedIds] = useState<Record<Tab, string[]>>({
    projects: [],
    images: [],
  });
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const imagesById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images],
  );

  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return sortItems(
      projects.filter(
        (project) =>
          !query ||
          project.name.toLowerCase().includes(query) ||
          (project.description ?? "").toLowerCase().includes(query),
      ),
      projectSort,
      (project) => project.name,
    );
  }, [projectSearch, projectSort, projects]);

  const imageProjectOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const image of images) options.set(image.projectId, image.projectName);
    return [...options]
      .map(([projectId, projectName]) => ({ projectId, projectName }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [images]);
  // The filtered project can disappear after a restore/delete; fall back to all.
  const activeImageProjectFilter = imageProjectOptions.some(
    (option) => option.projectId === imageProjectFilter,
  )
    ? imageProjectFilter
    : ALL_PROJECTS;

  const visibleImages = useMemo(() => {
    const query = imageSearch.trim().toLowerCase();
    return sortItems(
      images
        .filter((image) => image.fileName.toLowerCase().includes(query))
        .filter(
          (image) =>
            activeImageProjectFilter === ALL_PROJECTS ||
            image.projectId === activeImageProjectFilter,
        ),
      imageSort,
      (image) => image.fileName,
    );
  }, [activeImageProjectFilter, imageSearch, imageSort, images]);

  // Derived from the current props, so items that vanished after a refresh drop out.
  const selectedProjects = projects.filter((project) =>
    selectedIds.projects.includes(project.id),
  );
  const selectedImages = images.filter((image) =>
    selectedIds.images.includes(image.id),
  );
  const tabSelectionIds =
    tab === "projects"
      ? selectedProjects.map((project) => project.id)
      : selectedImages.map((image) => image.id);
  const blockedReasons = new Set(
    tab === "images"
      ? selectedImages.flatMap((image) => restoreBlockedReason(image) ?? [])
      : selectedProjects.flatMap((project) =>
          project.deletionPending ? ["Deletion didn't finish"] : [],
        ),
  );
  const canRestoreSelection =
    tab === "projects"
      ? selectedProjects.some((project) => !project.deletionPending)
      : selectedImages.some((image) => restoreBlockedReason(image) === null);

  function toggleSelection(target: Tab, id: string, isSelected: boolean) {
    setSelectedIds((current) => {
      const ids = current[target];
      return {
        ...current,
        [target]: isSelected
          ? ids.includes(id) ? ids : [...ids, id]
          : ids.filter((candidate) => candidate !== id),
      };
    });
  }

  function clearSelection(target?: Tab) {
    setSelectedIds((current) =>
      target ? { ...current, [target]: [] } : { projects: [], images: [] },
    );
  }

  function setErrorsFor(ids: string[], failures: Array<{ id: string; error?: string }>, fallback: string) {
    setItemErrors((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      for (const failure of failures) next[failure.id] = failure.error ?? fallback;
      return next;
    });
  }

  function itemName(id: string) {
    const project = projectsById.get(id);
    if (project) return `“${project.name}”`;
    const image = imagesById.get(id);
    return image ? `“${image.fileName}”` : "this item";
  }

  function countItems(ids: string[]) {
    return countLabel(
      ids.filter((id) => projectsById.has(id)).length,
      ids.filter((id) => imagesById.has(id)).length,
    );
  }

  async function restore(ids: string[]) {
    if (ids.length === 0 || pending) return;
    setPending({ kind: "restore", ids });
    setNotice(null);
    try {
      const results = await restoreRecycleBinItems(ids);
      const failures = results.filter((result) => !result.ok);
      const restored = results.filter((result) => result.ok);
      setErrorsFor(ids, failures, "Could not restore this item.");

      if (failures.length === 0) {
        const projectIds = new Set(restored.flatMap((result) => result.projectId ?? []));
        const [onlyProjectId] = projectIds;
        const subject = ids.length === 1 ? itemName(ids[0]) : countItems(ids);
        setNotice({
          tone: "success",
          text: `Restored ${subject}.`,
          link:
            projectIds.size === 1 && onlyProjectId
              ? { href: `/projects/${onlyProjectId}`, label: "Open project" }
              : undefined,
        });
      } else if (ids.length > 1) {
        // A single failure is already explained inline on its row/card.
        setNotice({
          tone: "error",
          text: `Restored ${restored.length} of ${results.length} items. ${failures.length} couldn't be restored; see the message on each item.`,
        });
      }
      clearSelection();
      refresh();
    } catch (cause) {
      setNotice({
        tone: "error",
        text: errorMessage(cause, "Could not restore the selected items."),
      });
    } finally {
      setPending(null);
    }
  }

  function requestDelete(ids: string[]) {
    if (ids.length === 0 || pending) return;
    setDeleteError(null);
    setDeleteIds(ids);
  }

  async function confirmDelete() {
    if (!deleteIds || deleteIds.length === 0 || pending) return;
    const ids = deleteIds;
    setPending({ kind: "delete", ids });
    setDeleteError(null);
    setNotice(null);
    try {
      const { failed, skipped } = await deleteRecycleBinItemsPermanently(ids);
      setErrorsFor(ids, failed, "Could not delete this item.");
      const unfinished = new Set([...failed.map((failure) => failure.id), ...skipped]);
      const deletedIds = ids.filter((id) => !unfinished.has(id));

      const parts: string[] = [];
      if (deletedIds.length > 0) {
        parts.push(
          `Permanently deleted ${
            deletedIds.length === 1 ? itemName(deletedIds[0]) : countItems(deletedIds)
          }.`,
        );
      }
      if (skipped.length > 0) {
        parts.push(
          `${skipped.length} ${
            skipped.length === 1 ? "item was" : "items were"
          } no longer in the Recycle Bin.`,
        );
      }
      if (failed.length > 0) {
        parts.push(
          `${failed.length} couldn't be fully deleted: ${failed[0].error}`,
        );
      }
      setNotice({
        tone: failed.length > 0 || deletedIds.length === 0 ? "error" : "success",
        text: parts.join(" "),
      });
      setDeleteIds(null);
      clearSelection();
      refresh();
    } catch (cause) {
      setDeleteError(errorMessage(cause, "Could not delete the selected items."));
    } finally {
      setPending(null);
    }
  }

  const deleteProjects = (deleteIds ?? []).flatMap((id) => projectsById.get(id) ?? []);
  const deleteImages = (deleteIds ?? []).flatMap((id) => imagesById.get(id) ?? []);
  const deleteCount = deleteProjects.length + deleteImages.length;
  let deleteTitle = `Delete ${countLabel(deleteProjects.length, deleteImages.length)} permanently?`;
  let deleteDescription = `These ${countLabel(deleteProjects.length, deleteImages.length)} will be deleted permanently and their files removed from storage.${
    deleteProjects.length > 0
      ? " Images from these projects that are still in the Recycle Bin are deleted too."
      : ""
  } This can't be undone.`;
  if (deleteCount === 1 && deleteProjects[0]) {
    const project = deleteProjects[0];
    deleteTitle = `Delete “${project.name}” permanently?`;
    deleteDescription = `“${project.name}” and its ${numberFormatter.format(project.imageCount)} ${
      project.imageCount === 1 ? "image" : "images"
    } will be deleted permanently and their files removed from storage. Any of its images still in the Recycle Bin are deleted too. This can't be undone.`;
  } else if (deleteCount === 1 && deleteImages[0]) {
    deleteTitle = `Delete “${deleteImages[0].fileName}” permanently?`;
    deleteDescription = `“${deleteImages[0].fileName}” will be deleted permanently and its file removed from storage, along with its annotations. This can't be undone.`;
  }

  const isBusy = pending !== null;
  const pendingFor = (id: string) =>
    pending?.ids.includes(id) ? pending.kind : null;

  return (
    <div className={tabSelectionIds.length > 0 ? "space-y-4 pb-20" : "space-y-4"}>
      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm",
            notice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
          )}
        >
          <p>
            {notice.text}
            {notice.link ? (
              <>
                {" "}
                <Link
                  href={notice.link.href}
                  className="font-medium underline underline-offset-4"
                >
                  {notice.link.label}
                </Link>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded-sm opacity-70 hover:opacity-100"
            aria-label="Dismiss message"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-5">
        <TabsList
          variant="line"
          className="w-full justify-start gap-0 border-b p-0 group-data-[orientation=horizontal]/tabs:h-auto"
        >
          <TabsTrigger value="projects" className={tabTriggerClassName}>
            Projects ({numberFormatter.format(projects.length)})
          </TabsTrigger>
          <TabsTrigger value="images" className={tabTriggerClassName}>
            Images ({numberFormatter.format(images.length)})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="space-y-4">
          {projects.length === 0 ? (
            <EmptyState
              title="Nothing in the Recycle Bin"
              description={`Deleted projects appear here for ${retentionDays} days, so you can restore them.`}
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SearchInput
                  value={projectSearch}
                  placeholder="Search deleted projects..."
                  onChange={setProjectSearch}
                />
                <div className="flex items-center gap-2">
                  <SortControls sort={projectSort} label="projects" onChange={setProjectSort} />
                </div>
              </div>

              {visibleProjects.length === 0 ? (
                <NoMatches
                  text="No deleted projects match your search."
                  onClear={() => setProjectSearch("")}
                />
              ) : (
                <div className="space-y-3">
                  {visibleProjects.map((project) => (
                    <RecycleBinProjectRow
                      key={project.id}
                      project={project}
                      now={now}
                      isSelected={selectedIds.projects.includes(project.id)}
                      disabled={isBusy}
                      pendingAction={pendingFor(project.id)}
                      error={itemErrors[project.id]}
                      onSelectionChange={(id, isSelected) =>
                        toggleSelection("projects", id, isSelected)
                      }
                      onRestore={(target: RecycleBinProject) => void restore([target.id])}
                      onDelete={(target: RecycleBinProject) => requestDelete([target.id])}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          {images.length === 0 ? (
            <EmptyState
              title="Nothing in the Recycle Bin"
              description={`Deleted images appear here for ${retentionDays} days, so you can restore them.`}
            />
          ) : (
            <>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <SearchInput
                  value={imageSearch}
                  placeholder="Search images..."
                  onChange={setImageSearch}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={activeImageProjectFilter}
                    onValueChange={setImageProjectFilter}
                  >
                    <SelectTrigger className="w-[180px]" aria-label="Filter by project">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_PROJECTS}>All Projects</SelectItem>
                      {imageProjectOptions.map((option) => (
                        <SelectItem key={option.projectId} value={option.projectId}>
                          {option.projectName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <SortControls sort={imageSort} label="images" onChange={setImageSort} />
                </div>
              </div>

              {visibleImages.length === 0 ? (
                <NoMatches
                  text="No deleted images match your filters."
                  onClear={() => {
                    setImageSearch("");
                    setImageProjectFilter(ALL_PROJECTS);
                  }}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleImages.map((image) => (
                    <RecycleBinImageCard
                      key={image.id}
                      image={image}
                      now={now}
                      isSelected={selectedIds.images.includes(image.id)}
                      disabled={isBusy}
                      pendingAction={pendingFor(image.id)}
                      error={itemErrors[image.id]}
                      onSelectionChange={(id, isSelected) =>
                        toggleSelection("images", id, isSelected)
                      }
                      onRestore={(target: RecycleBinImage) => void restore([target.id])}
                      onDelete={(target: RecycleBinImage) => requestDelete([target.id])}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {tabSelectionIds.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border bg-background/95 p-2 shadow-xl backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 px-2 text-sm text-muted-foreground">
            <Checkbox
              checked
              onCheckedChange={(checked) => {
                if (!checked) clearSelection(tab);
              }}
              aria-label="Clear selection"
            />
            {tabSelectionIds.length} Selected
          </label>
          <Separator
            orientation="vertical"
            className="hidden data-[orientation=vertical]:h-6 sm:block"
          />
          {canRestoreSelection ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => void restore(tabSelectionIds)}
            >
              <RotateCcw className="size-4" />
              {pending?.kind === "restore" ? "Restoring..." : "Restore"}
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Disabled buttons swallow pointer events; the span keeps the tooltip working. */}
                <span tabIndex={0} className="rounded-md">
                  <Button type="button" variant="outline" size="sm" disabled>
                    <RotateCcw className="size-4" />
                    Restore
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {blockedReasons.size === 1
                  ? [...blockedReasons][0]
                  : "None of the selected items can be restored"}
              </TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive text-destructive hover:text-destructive"
            disabled={isBusy}
            onClick={() => requestDelete(tabSelectionIds)}
          >
            <Trash2 className="size-4" />
            Delete Permanently
          </Button>
        </div>
      ) : null}

      <Dialog
        open={deleteIds !== null}
        onOpenChange={(open) => {
          if (!open && pending?.kind !== "delete") {
            setDeleteIds(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words">{deleteTitle}</DialogTitle>
            <DialogDescription className="break-words">{deleteDescription}</DialogDescription>
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
              disabled={pending?.kind === "delete"}
              onClick={() => {
                setDeleteIds(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending !== null || deleteCount === 0}
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="size-4" />
              {pending?.kind === "delete" ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
