"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { renameProjectImage } from "@/lib/actions/images";
import { transferProjectImages } from "@/lib/actions/projects";
import type { Project, ProjectImage } from "@/lib/types/projects";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

export function RenameImageDialog({
  image,
  projectId,
  open,
  onOpenChange,
  onRenamed
}: {
  image: ProjectImage | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved name, before the refresh. */
  onRenamed?: (imageId: string, fileName: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Image</DialogTitle>
          <DialogDescription>
            Enter a new file name for this image.
          </DialogDescription>
        </DialogHeader>
        {image ? (
          <RenameImageForm
            key={image.id}
            image={image}
            projectId={projectId}
            onOpenChange={onOpenChange}
            onRenamed={onRenamed}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounts with the dialog content, so each open starts from the image's name. */
function RenameImageForm({
  image,
  projectId,
  onOpenChange,
  onRenamed
}: {
  image: ProjectImage;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onRenamed?: (imageId: string, fileName: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(image.fileName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await renameProjectImage(image.id, projectId, name);
      onRenamed?.(image.id, name.trim());
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not rename the image."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="rename-image">File Name</Label>
        <Input
          id="rename-image"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          required
        />
      </div>
      <ErrorMessage message={error} />
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Renaming..." : "Rename"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Images that live in one source project. */
export type ImageTransferSource = { projectId: string; imageIds: string[] };

export function ImageTransferDialog({
  open,
  onOpenChange,
  mode,
  sourceProject,
  projects,
  imageIds = [],
  sources,
  onComplete
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "copy" | "move";
  sourceProject?: Project;
  projects: Project[];
  imageIds?: string[];
  sources?: ImageTransferSource[];
  onComplete: (transferredImageIds: string[]) => void;
}) {
  const [pending, setPending] = useState(false);

  const title =
    mode === "move" ? "Move to Existing Project" : "Add to Existing Project";

  const groups =
    sources ??
    (sourceProject ? [{ projectId: sourceProject.id, imageIds }] : []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-[430px]"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>
            {mode === "move" ? "Move" : "Add"} selected image(s) to another
            project.
          </DialogDescription>
        </DialogHeader>

        {open && (
          <ImageTransferForm
            key={mode}
            mode={mode}
            groups={groups}
            projects={projects}
            onOpenChange={onOpenChange}
            onComplete={onComplete}
            pending={pending}
            setPending={setPending}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounts with the dialog content, so each open starts with no destination. */
function ImageTransferForm({
  mode,
  groups,
  projects,
  onOpenChange,
  onComplete,
  pending,
  setPending
}: {
  mode: "copy" | "move";
  groups: ImageTransferSource[];
  projects: Project[];
  onOpenChange: (open: boolean) => void;
  onComplete: (transferredImageIds: string[]) => void;
  pending: boolean;
  setPending: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [keepAnnotations, setKeepAnnotations] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    count: number;
    projectName: string;
  } | null>(null);
  // Source projects already transferred while this dialog is open. A retry
  // skips them: a moved group has left its project, and a copied group would
  // be duplicated again.
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(normalizedSearch)
  );
  const verb = mode === "move" ? "moved" : "added";
  const sourceProjectIds = new Set(groups.map((group) => group.projectId));
  const remainingGroups = groups.filter(
    (group) =>
      group.imageIds.length > 0 &&
      !completedProjectIds.includes(group.projectId)
  );
  const countImages = (list: ImageTransferSource[]) =>
    list.reduce((sum, group) => sum + group.imageIds.length, 0);
  const remainingImages = countImages(remainingGroups);
  const groupsFor = (destinationId: string) =>
    remainingGroups.filter(
      (group) => !(mode === "move" && group.projectId === destinationId)
    );
  const skippedImages = targetId
    ? remainingImages - countImages(groupsFor(targetId))
    : 0;
  const targetProject = projects.find((project) => project.id === targetId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !targetId || groupsFor(targetId).length === 0) return;
    setPending(true);
    setError(null);
    const pendingGroups = groupsFor(targetId);
    const transferredIds: string[] = [];
    try {
      for (const group of pendingGroups) {
        await transferProjectImages(
          group.projectId,
          targetId,
          group.imageIds,
          mode,
          keepAnnotations
        );
        transferredIds.push(...group.imageIds);

        setCompletedProjectIds((current) => [...current, group.projectId]);
        setCompletedCount((current) => current + group.imageIds.length);
      }
      setSuccess({
        count: completedCount + transferredIds.length,
        projectName: targetProject?.name ?? "the selected project"
      });
      onComplete(transferredIds);
      router.refresh();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : `Images could not be ${verb}.`;
      if (transferredIds.length > 0) {
        // Earlier groups already succeeded; report them and leave only the rest for a retry.
        setError(
          `${transferredIds.length} of ${countImages(pendingGroups)} images were ${verb}; the rest failed: ${message} Submit again to retry only the remaining images.`
        );
        onComplete(transferredIds);
        router.refresh();
      } else {
        setError(message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {success ? (
        <>
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
          >
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {mode === "move"
                  ? "Images moved successfully!"
                  : "Images added successfully!"}
              </p>

              <p className="text-xs text-emerald-800/80 dark:text-emerald-200/80">
                {success.count}{" "}
                {success.count === 1 ? "image has" : "images have been"} {verb}{" "}
                to <span className="font-medium">{success.projectName}</span>.{" "}
                You can continue working in your current project.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <fieldset disabled={pending} className="space-y-4">
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
              <Copy className="size-3.5" />
              {remainingImages} {remainingImages === 1 ? "image" : "images"}{" "}
              will be {verb} to the selected project.
            </div>
            {skippedImages > 0 ? (
              <p className="text-xs text-muted-foreground">
                {skippedImages}{" "}
                {skippedImages === 1 ? "image is" : "images are"} already in
                this project and will be skipped.
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`${mode}-destination-search`}>
                Destination Project
              </Label>
              <div className="overflow-hidden rounded-lg border">
                <div className="relative border-b">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id={`${mode}-destination-search`}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search for a project..."
                    disabled={pending || completedProjectIds.length > 0}
                    className="border-0 pl-9 shadow-none focus-visible:ring-0"
                  />
                </div>
                <div className="max-h-36 overflow-y-auto p-1">
                  {filteredProjects.map((project) => {
                    const disabled =
                      pending ||
                      (completedProjectIds.length > 0 &&
                        project.id !== targetId) ||
                      (mode === "move" && groupsFor(project.id).length === 0);
                    return (
                      <button
                        key={project.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setTargetId(project.id)}
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${targetId === project.id ? "bg-primary/10 text-primary" : "hover:bg-muted"} disabled:cursor-not-allowed disabled:opacity-45`}
                      >
                        <span className="truncate">
                          {project.name}
                          {sourceProjectIds.has(project.id) ? " (current)" : ""}
                        </span>
                        <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                          {project.image_count ?? 0} images
                        </span>
                      </button>
                    );
                  })}
                  {filteredProjects.length === 0 ? (
                    <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                      No projects found.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Checkbox
                id={`${mode}-keep-annotations`}
                checked={keepAnnotations}
                onCheckedChange={(checked) =>
                  setKeepAnnotations(checked === true)
                }
              />
              <div className="space-y-0.5 -mt-1">
                <Label
                  htmlFor={`${mode}-keep-annotations`}
                  className="cursor-pointer"
                >
                  Keep annotations
                </Label>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Copy annotations when the source image is already annotated.
                  Unannotated images still transfer as raw images.
                </p>
              </div>
            </div>
          </fieldset>

          {pending && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 rounded-lg border border-[#D8E9FF] bg-[#F7FAFF] px-4 py-3"
            >
              <Loader2
                className="size-5 shrink-0 animate-spin text-primary"
                aria-hidden="true"
              />

              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {mode === "move" ? "Moving images..." : "Adding images..."}
                </p>

                <p className="text-xs text-muted-foreground">
                  {mode === "move"
                    ? "Moving your selected images to the destination project. Please wait."
                    : "Adding your selected images to the destination project. Please wait."}
                </p>
              </div>
            </div>
          )}

          <ErrorMessage message={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending || !targetId || groupsFor(targetId).length === 0
              }
            >
              {pending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}

              {pending
                ? `${mode === "move" ? "Moving" : "Adding"}...`
                : mode === "move"
                  ? "Move"
                  : "Add"}
            </Button>
          </DialogFooter>
        </>
      )}
    </form>
  );
}
