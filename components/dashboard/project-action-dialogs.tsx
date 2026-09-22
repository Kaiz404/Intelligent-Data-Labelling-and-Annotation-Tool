"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ImageIcon, Search, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  copyProjectImages,
  deleteProject,
  duplicateProject,
  updateProject,
} from "@/lib/actions/projects";
import type { Project } from "@/lib/types/projects";
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
import { Textarea } from "@/components/ui/textarea";

type CommonProps = {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

export function EditProjectDialog({ project, open, onOpenChange }: CommonProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setThumbnail(null);
    setPreviewUrl(project.thumbnailUrl ?? null);
    setError(null);
  }, [open, project]);

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
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      await updateProject(project.id, name, description);
      if (thumbnail) {
        const formData = new FormData();
        formData.set("thumbnail", thumbnail);
        const response = await fetch(`/api/projects/${project.id}/thumbnail`, {
          method: "POST",
          body: formData,
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not upload the thumbnail.");
      }
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the project.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[480px]">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-base">Edit Project</DialogTitle>
          <DialogDescription className="text-xs">Update the project details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="edit-project-name">Project Name <span className="text-destructive">*</span></Label>
            <Input id="edit-project-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-project-description">Project Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="edit-project-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
          </div>
          <div className="space-y-2">
            <Label>Project Thumbnail <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="flex items-center gap-3">
              <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Project thumbnail preview" className="h-full w-full object-cover" />
                ) : <ImageIcon className="size-7 text-muted-foreground/60" />}
              </div>
              <div className="space-y-2">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(event) => chooseThumbnail(event.target.files?.[0])} />
                <Button type="button" variant="outline" className="border-primary text-primary hover:text-primary" onClick={() => fileInputRef.current?.click()} disabled={pending}><Upload className="size-4" /> Change Thumbnail</Button>
                <p className="text-[11px] text-muted-foreground">JPG or PNG&nbsp;&nbsp;·&nbsp;&nbsp;Max 5 MB</p>
              </div>
            </div>
          </div>
          <ErrorMessage message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !name.trim()}>{pending ? "Saving..." : "Save Changes"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateProjectDialog({ project, open, onOpenChange }: CommonProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    setName(`${project.name} Copy`);
    setDescription(project.description ?? "");
    setError(null);
  }, [open, project]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      const result = await duplicateProject(project.id, name, description);
      onOpenChange(false);
      router.push(`/projects/${result.projectId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not duplicate the project.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Duplicate Project</DialogTitle><DialogDescription>Set up the details for your duplicated project.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="duplicate-project-name">New Project Name <span className="text-destructive">*</span></Label><Input id="duplicate-project-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="duplicate-project-description">New Project Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="duplicate-project-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></div>
          <ErrorMessage message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !name.trim()}>{pending ? "Duplicating..." : "Duplicate Project"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CopyImagesDialog({ project, projects, open, onOpenChange }: CommonProps & { projects: Project[] }) {
  const router = useRouter();
  const destinations = useMemo(() => projects.filter((candidate) => candidate.id !== project?.id), [project?.id, projects]);
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [keepAnnotations, setKeepAnnotations] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filteredDestinations = destinations.filter((destination) => destination.name.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setTargetId("");
    setSearch("");
    setKeepAnnotations(true);
    setError(null);
  }, [open, project]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!project || !targetId) return;
    setPending(true);
    setError(null);
    try {
      await copyProjectImages(project.id, targetId, keepAnnotations);
      onOpenChange(false);
      router.push(`/projects/${targetId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy the images.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-[430px]">
        <DialogHeader className="gap-1.5"><DialogTitle className="text-base">Copy Images to Project</DialogTitle><DialogDescription className="text-xs">Copy image(s) from the selected project to another project.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary"><Copy className="size-3.5" />Copy all {project?.image_count ?? 0} images from {project?.name ?? "this project"} to another project.</div>
          <div className="space-y-2">
            <Label htmlFor="destination-search">Destination Project</Label>
            <div className="overflow-hidden rounded-lg border">
              <div className="relative border-b"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="destination-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search for a project..." className="border-0 pl-9 shadow-none focus-visible:ring-0" /></div>
              <div className="max-h-36 overflow-y-auto p-1">
                {filteredDestinations.map((destination) => (
                  <button key={destination.id} type="button" onClick={() => setTargetId(destination.id)} className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${targetId === destination.id ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}><span className="truncate">{destination.name}</span><span className="ml-3 shrink-0 text-xs text-muted-foreground">{destination.image_count ?? 0} images</span></button>
                ))}
                {filteredDestinations.length === 0 ? <p className="px-3 py-5 text-center text-xs text-muted-foreground">No destination projects found.</p> : null}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Checkbox id="keep-annotations" checked={keepAnnotations} onCheckedChange={(checked) => setKeepAnnotations(checked === true)} />
            <div className="space-y-0.5"><Label htmlFor="keep-annotations" className="cursor-pointer">Keep annotations</Label><p className="text-xs leading-relaxed text-muted-foreground">Copy annotations when the source image is already annotated. Unannotated images still copy as raw images.</p></div>
          </div>
          <ErrorMessage message={error} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || !targetId}>{pending ? "Copying..." : "Copy"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({ project, open, onOpenChange }: CommonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) setError(null); }, [open, project]);

  const confirmDelete = async () => {
    if (!project) return;
    setPending(true);
    setError(null);
    try {
      await deleteProject(project.id);
      onOpenChange(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the project.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Delete Project?</DialogTitle><DialogDescription>This permanently deletes “{project?.name}”, its images from S3, labels, and annotations. This action cannot be undone.</DialogDescription></DialogHeader>
        <ErrorMessage message={error} />
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button><Button type="button" variant="destructive" onClick={confirmDelete} disabled={pending}>{pending ? "Deleting..." : "Delete Project"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
