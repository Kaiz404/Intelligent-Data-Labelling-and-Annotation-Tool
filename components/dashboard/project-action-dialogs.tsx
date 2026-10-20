"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ImageIcon,
  Loader2,
  Search,
  Upload
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  copyProjectImages,
  duplicateProject,
  updateProject
} from "@/lib/actions/projects";
import { moveProjectToRecycleBin } from "@/lib/actions/recycle-bin";
import type { Project } from "@/lib/types/projects";
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
import { Textarea } from "@/components/ui/textarea";

/*
 * Each dialog keeps its form state in a component inside DialogContent, which
 * mounts on open: every open starts from the current project, with no reset
 * effects.
 */

type CommonProps = {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormProps = {
  project: Project;
  onOpenChange: (open: boolean) => void;
};

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

type EditProjectProps = {
  /** Called with the saved row as soon as the details save, before any thumbnail upload or refresh. */
  onSaved?: (project: Project) => void;
};

export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSaved
}: CommonProps & EditProjectProps) {
  const [pending, setPending] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-[480px]"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-base">Edit Project</DialogTitle>
          <DialogDescription>Update the project details.</DialogDescription>
        </DialogHeader>

        {project ? (
          <EditProjectForm
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
            pending={pending}
            setPending={setPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditProjectForm({
  project,
  onOpenChange,
  onSaved,
  pending,
  setPending
}: FormProps &
  EditProjectProps & {
    pending: boolean;
    setPending: React.Dispatch<React.SetStateAction<boolean>>;
  }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    project.thumbnailUrl ?? null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const chooseThumbnail = (file: File | undefined) => {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) {
      setError("Choose a JPG or PNG thumbnail.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The thumbnail must be 5 MB or smaller.");
      return;
    }
    setError(null);
    setThumbnail(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onSaved?.(await updateProject(project.id, name, description));
      if (thumbnail) {
        const formData = new FormData();
        formData.set("thumbnail", thumbnail);
        const response = await fetch(`/api/projects/${project.id}/thumbnail`, {
          method: "POST",
          body: formData
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(body.error ?? "Could not upload the thumbnail.");
      }
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update the project."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={pending} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="edit-project-name">
            Project Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="edit-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-project-description">
            Project Description{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="edit-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </div>
        <div className="space-y-2">
          <Label>
            Project Thumbnail{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <div className="flex items-center gap-3">
            <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Project thumbnail preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <ImageIcon className="size-7 text-muted-foreground/60" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={(event) => chooseThumbnail(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                className="border-primary text-primary hover:text-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending}
              >
                <Upload className="size-4" /> Change Thumbnail
              </Button>
              <p className="text-[11px] text-muted-foreground">
                JPG or PNG&nbsp;&nbsp;·&nbsp;&nbsp;Max 5 MB
              </p>
            </div>
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
            <p className="text-sm font-medium">Saving project changes...</p>

            <p className="text-xs text-muted-foreground">
              Updating your project details and thumbnail. Please wait.
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
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {pending ? "Saving..." : "Save Changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type DuplicateStatus = "idle" | "duplicating" | "opening";

export function DuplicateProjectDialog({
  project,
  open,
  onOpenChange
}: CommonProps) {
  const [status, setStatus] = useState<DuplicateStatus>("idle");

  const isSubmitting = status !== "idle";

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  // Reset the dialog if the browser restores this page
  // from its back/forward cache.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      setStatus("idle");
      onOpenChange(false);
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!isSubmitting}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Duplicate Project</DialogTitle>
          <DialogDescription>
            Set up the details for your duplicated project.
          </DialogDescription>
        </DialogHeader>

        {project ? (
          <DuplicateProjectForm
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            status={status}
            setStatus={setStatus}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DuplicateProjectForm({
  project,
  onOpenChange,
  status,
  setStatus
}: FormProps & {
  status: DuplicateStatus;
  setStatus: React.Dispatch<React.SetStateAction<DuplicateStatus>>;
}) {
  const [name, setName] = useState(`${project.name} Copy`);
  const [description, setDescription] = useState(project.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = status !== "idle";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isSubmitting) return;

    setStatus("duplicating");
    setError(null);

    try {
      const result = await duplicateProject(project.id, name, description);

      // Duplication completed successfully.
      setStatus("opening");

      // Navigate to a fresh project page.
      // This avoids retaining the old dialog state.
      window.location.assign(`/projects/${result.projectId}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not duplicate the project."
      );

      setStatus("idle");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Disable form fields during duplication */}
      <fieldset disabled={isSubmitting} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="duplicate-project-name">
            New Project Name <span className="text-destructive">*</span>
          </Label>

          <Input
            id="duplicate-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="duplicate-project-description">
            New Project Description{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>

          <Textarea
            id="duplicate-project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
          />
        </div>
      </fieldset>

      {isSubmitting && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border border-[#D8E9FF] bg-[#F7FAFF] px-4 py-3"
        >
          {status === "duplicating" ? (
            <Loader2
              className="size-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2
              className="size-5 shrink-0 text-green-600"
              aria-hidden="true"
            />
          )}

          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {status === "duplicating"
                ? "Duplicating project..."
                : "Project duplicated successfully!"}
            </p>

            <p className="text-xs text-muted-foreground">
              {status === "duplicating"
                ? "Creating a copy of your project. Please wait."
                : "Opening your duplicated project... Please wait."}
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
          disabled={isSubmitting}
        >
          Cancel
        </Button>

        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {status === "duplicating"
            ? "Duplicating..."
            : status === "opening"
              ? "Opening..."
              : "Duplicate Project"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type CopyStatus = "idle" | "copying" | "opening";

export function CopyImagesDialog({
  project,
  projects,
  open,
  onOpenChange
}: CommonProps & { projects: Project[] }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  const isSubmitting = status !== "idle";

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  // Reset the dialog when the browser restores
  // this page from its back/forward cache.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;

      setStatus("idle");
      onOpenChange(false);
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-5 sm:max-w-[430px]"
        showCloseButton={!isSubmitting}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-base">
            Copy Images to Project
          </DialogTitle>
          <DialogDescription>
            Copy image(s) from the selected project to another project.
          </DialogDescription>
        </DialogHeader>

        {project ? (
          <CopyImagesForm
            key={project.id}
            project={project}
            projects={projects}
            onOpenChange={onOpenChange}
            status={status}
            setStatus={setStatus}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CopyImagesForm({
  project,
  projects,
  onOpenChange,
  status,
  setStatus
}: FormProps & {
  projects: Project[];
  status: CopyStatus;
  setStatus: React.Dispatch<React.SetStateAction<CopyStatus>>;
}) {
  const destinations = useMemo(
    () => projects.filter((candidate) => candidate.id !== project.id),
    [project.id, projects]
  );

  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [keepAnnotations, setKeepAnnotations] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = status !== "idle";

  const filteredDestinations = destinations.filter((destination) =>
    destination.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isSubmitting || !targetId) return;

    setStatus("copying");
    setError(null);

    try {
      await copyProjectImages(project.id, targetId, keepAnnotations);

      // Copy completed successfully.
      setStatus("opening");

      // Navigate to a fresh destination project page.
      window.location.assign(`/projects/${targetId}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not copy the images."
      );

      setStatus("idle");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Disable all interactive fields during copying */}
      <fieldset disabled={isSubmitting} className="space-y-4">
        <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
          <Copy className="size-3.5" />
          Copy all {project.image_count ?? 0} images from {project.name} to
          another project.
        </div>

        <div className="space-y-2">
          <Label htmlFor="destination-search">Destination Project</Label>

          <div className="overflow-hidden rounded-lg border">
            <div className="relative border-b">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

              <Input
                id="destination-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search for a project..."
                className="border-0 pl-9 shadow-none focus-visible:ring-0"
              />
            </div>

            <div className="max-h-36 overflow-y-auto p-1">
              {filteredDestinations.map((destination) => (
                <button
                  key={destination.id}
                  type="button"
                  onClick={() => setTargetId(destination.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    targetId === destination.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{destination.name}</span>

                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                    {destination.image_count ?? 0} images
                  </span>
                </button>
              ))}

              {filteredDestinations.length === 0 ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                  No destination projects found.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-3">
          <Checkbox
            id="keep-annotations"
            checked={keepAnnotations}
            onCheckedChange={(checked) => setKeepAnnotations(checked === true)}
            disabled={isSubmitting}
          />

          <div className="-mt-1 space-y-0.5">
            <Label
              htmlFor="keep-annotations"
              className={
                isSubmitting
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer"
              }
            >
              Keep annotations
            </Label>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Copy annotations when the source image is already annotated.
              Unannotated images still copy as raw images.
            </p>
          </div>
        </div>
      </fieldset>

      {/* Copy and navigation feedback */}
      {isSubmitting && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border border-[#D8E9FF] bg-[#F7FAFF] px-4 py-3"
        >
          {status === "copying" ? (
            <Loader2
              className="size-5 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2
              className="size-5 shrink-0 text-green-600"
              aria-hidden="true"
            />
          )}

          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {status === "copying"
                ? "Copying images..."
                : "Images copied successfully!"}
            </p>

            <p className="text-xs text-muted-foreground">
              {status === "copying"
                ? "Copying. Please wait."
                : "Opening the destination project... Please wait."}
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
          disabled={isSubmitting}
        >
          Cancel
        </Button>

        <Button type="submit" disabled={isSubmitting || !targetId}>
          {isSubmitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}

          {status === "copying"
            ? "Copying..."
            : status === "opening"
              ? "Opening..."
              : "Copy"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted
}: CommonProps & {
  /** Called once the project is in the Recycle Bin, before the refresh. */
  onDeleted?: (projectId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Recycle Bin?</DialogTitle>
          <DialogDescription>
            “{project?.name}” will be moved to the Recycle Bin with its images,
            labels, and annotations. You can restore it from the Recycle Bin for
            30 days. Unreviewed AI suggestions aren&apos;t kept.
          </DialogDescription>
        </DialogHeader>
        {project ? (
          <DeleteProjectActions
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onDeleted={onDeleted}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectActions({
  project,
  onOpenChange,
  onDeleted
}: FormProps & { onDeleted?: (projectId: string) => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmDelete = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await moveProjectToRecycleBin(project.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onDeleted?.(project.id);
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not move the project to the Recycle Bin."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <>
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
          type="button"
          variant="destructive"
          onClick={confirmDelete}
          disabled={pending}
        >
          {pending ? "Moving..." : "Move to Recycle Bin"}
        </Button>
      </DialogFooter>
    </>
  );
}
