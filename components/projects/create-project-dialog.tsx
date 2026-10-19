"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { createProject } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
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

type CreateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type CreationStatus = "idle" | "creating" | "opening";

export function CreateProjectDialog({
  open,
  onOpenChange
}: CreateProjectDialogProps) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  const [status, setStatus] = useState<CreationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const isSubmitting = status !== "idle";

  // Reset the dialog when navigation completes.
  useEffect(() => {
    formRef.current?.reset();
    setStatus("idle");
    setError(null);
    onOpenChange(false);
  }, [pathname, onOpenChange]);

  function handleOpenChange(nextOpen: boolean) {
    // Prevent closing during creation or navigation.
    if (isSubmitting) return;

    if (!nextOpen) {
      formRef.current?.reset();
      setError(null);
    }

    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    setStatus("creating");
    setError(null);

    try {
      const formData = new FormData(event.currentTarget);

      // Stage 1: Save the project.
      const result = await createProject(formData);

      // Stage 2: Project saved. Navigate to its page.
      setStatus("opening");
      router.push(`/projects/${result.projectId}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      setError("Could not create your project. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Set up your project details to get started
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={isSubmitting} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">
                Project Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="project-name"
                name="name"
                placeholder="Enter project name..."
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">
                Project Description (optional)
              </Label>
              <Textarea
                id="project-description"
                name="description"
                placeholder="Enter project description..."
                rows={4}
              />
            </div>
          </fieldset>

          {/* Creation and navigation feedback */}
          {isSubmitting && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-3 rounded-md bg-muted/60 p-3"
            >
              {status === "creating" ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-blue-600"
                  aria-hidden
                />
              ) : (
                <CheckCircle2
                  className="size-4 shrink-0 text-green-600"
                  aria-hidden
                />
              )}

              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {status === "creating"
                    ? "Creating your project..."
                    : "Project created successfully!"}
                </p>

                <p className="text-xs text-muted-foreground">
                  {status === "creating"
                    ? "Please wait while we save your project."
                    : "Opening your new project..."}
                </p>
              </div>
            </div>
          )}

          {/* Error feedback */}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}

              {status === "creating"
                ? "Creating..."
                : status === "opening"
                  ? "Opening..."
                  : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
