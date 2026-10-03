"use client";

import { useEffect, useState } from "react";
import { Copy, Search } from "lucide-react";
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
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</p>
  ) : null;
}

export function RenameImageDialog({
  image,
  projectId,
  open,
  onOpenChange,
}: {
  image: ProjectImage | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !image) return;
    setName(image.fileName);
    setError(null);
  }, [image, open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!image) return;
    setPending(true);
    setError(null);
    try {
      await renameProjectImage(image.id, projectId, name);
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rename the image.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Rename Image</DialogTitle><DialogDescription>Enter a new file name for this image.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="rename-image">File Name</Label><Input id="rename-image" value={name} onChange={(event) => setName(event.target.value)} autoFocus required /></div>
          <ErrorMessage message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !name.trim()}>{pending ? "Renaming..." : "Rename"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "copy" | "move";
  /** Single source project (project page). Ignored when `sources` is set. */
  sourceProject?: Project;
  projects: Project[];
  imageIds?: string[];
  /**
   * Images grouped by source project, for selections spanning projects. One
   * transfer runs per group; a move skips images already in the destination.
   */
  sources?: ImageTransferSource[];
  /**
   * Called with the IDs that were transferred: once when everything finishes,
   * and also after a partial failure for the groups that already succeeded.
   */
  onComplete: (transferredImageIds: string[]) => void;
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [keepAnnotations, setKeepAnnotations] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Source projects already transferred while this dialog is open. A retry
  // skips them: a moved group has left its project, and a copied group would
  // be duplicated again.
  const [completedProjectIds, setCompletedProjectIds] = useState<string[]>([]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(normalizedSearch),
  );
  const title = mode === "move" ? "Move to Existing Project" : "Add to Existing Project";
  const verb = mode === "move" ? "moved" : "added";
  const groups =
    sources ??
    (sourceProject ? [{ projectId: sourceProject.id, imageIds }] : []);
  const sourceProjectIds = new Set(groups.map((group) => group.projectId));
  const remainingGroups = groups.filter(
    (group) =>
      group.imageIds.length > 0 && !completedProjectIds.includes(group.projectId),
  );
  const countImages = (list: ImageTransferSource[]) =>
    list.reduce((sum, group) => sum + group.imageIds.length, 0);
  const remainingImages = countImages(remainingGroups);
  const groupsFor = (destinationId: string) =>
    remainingGroups.filter(
      (group) => !(mode === "move" && group.projectId === destinationId),
    );
  const skippedImages = targetId ? remainingImages - countImages(groupsFor(targetId)) : 0;

  useEffect(() => {
    if (!open) return;
    setTargetId("");
    setSearch("");
    setKeepAnnotations(true);
    setError(null);
    setCompletedProjectIds([]);
  }, [open, mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!targetId) return;
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
          keepAnnotations,
        );
        transferredIds.push(...group.imageIds);
        setCompletedProjectIds((current) => [...current, group.projectId]);
      }
      onOpenChange(false);
      onComplete(transferredIds);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Images could not be ${verb}.`;
      if (transferredIds.length > 0) {
        // Earlier groups already succeeded; report them and leave only the rest for a retry.
        setError(
          `${transferredIds.length} of ${countImages(pendingGroups)} images were ${verb}; the rest failed: ${message} Submit again to retry only the remaining images.`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[430px]">
        <DialogHeader className="gap-1.5"><DialogTitle className="text-base">{title}</DialogTitle><DialogDescription className="text-xs">{mode === "move" ? "Move" : "Add"} selected image(s) to another project.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary"><Copy className="size-3.5" />{remainingImages} {remainingImages === 1 ? "image" : "images"} will be {verb} to the selected project.</div>
          {skippedImages > 0 ? <p className="text-xs text-muted-foreground">{skippedImages} {skippedImages === 1 ? "image is" : "images are"} already in this project and will be skipped.</p> : null}
          <div className="space-y-2">
            <Label htmlFor={`${mode}-destination-search`}>Destination Project</Label>
            <div className="overflow-hidden rounded-lg border">
              <div className="relative border-b"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id={`${mode}-destination-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search for a project..." className="border-0 pl-9 shadow-none focus-visible:ring-0" /></div>
              <div className="max-h-36 overflow-y-auto p-1">
                {filteredProjects.map((project) => {
                  const disabled = mode === "move" && groupsFor(project.id).length === 0;
                  return <button key={project.id} type="button" disabled={disabled} onClick={() => setTargetId(project.id)} className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${targetId === project.id ? "bg-primary/10 text-primary" : "hover:bg-muted"} disabled:cursor-not-allowed disabled:opacity-45`}><span className="truncate">{project.name}{sourceProjectIds.has(project.id) ? " (current)" : ""}</span><span className="ml-3 shrink-0 text-xs text-muted-foreground">{project.image_count ?? 0} images</span></button>;
                })}
                {filteredProjects.length === 0 ? <p className="px-3 py-5 text-center text-xs text-muted-foreground">No projects found.</p> : null}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3"><Checkbox id={`${mode}-keep-annotations`} checked={keepAnnotations} onCheckedChange={(checked) => setKeepAnnotations(checked === true)} /><div className="space-y-0.5"><Label htmlFor={`${mode}-keep-annotations`} className="cursor-pointer">Keep annotations</Label><p className="text-xs leading-relaxed text-muted-foreground">Copy annotations when the source image is already annotated. Unannotated images still transfer as raw images.</p></div></div>
          <ErrorMessage message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !targetId}>{pending ? `${mode === "move" ? "Moving" : "Adding"}...` : mode === "move" ? "Move" : "Add"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
