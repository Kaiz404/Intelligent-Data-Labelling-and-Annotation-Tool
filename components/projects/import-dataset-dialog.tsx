"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, CloudUpload, FileArchive, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, numberFormatter } from "@/lib/format";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { readCocoDatasetZip } from "@/lib/uploads/dataset-zip";
import { cn } from "@/lib/utils";

type ImportDatasetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Selection =
  | { status: "validating"; filename: string }
  | { status: "error"; filename?: string; error: string }
  | { status: "ready"; filename: string; plan: ValidatedDatasetImportPlan };

export function ImportDatasetDialog({ open, onOpenChange }: ImportDatasetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-6 overflow-hidden sm:max-w-[720px]">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-normal">Import COCO dataset</DialogTitle>
          <DialogDescription>
            Choose a ZIP containing one COCO JSON document and its JPEG or PNG images.
            This step validates and previews your dataset.
          </DialogDescription>
        </DialogHeader>
        {/* A fresh form on each open; no import hook or mutations yet. */}
        {open ? <DatasetSelection onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DatasetSelection({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const validationVersion = useRef(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Invalidates pending work on unmount (including closing the dialog).
  useEffect(() => () => { validationVersion.current += 1; }, []);

  function removeSelection() {
    validationVersion.current += 1;
    setSelection(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectFiles(files: File[]) {
    if (files.length === 0) return;
    const version = ++validationVersion.current;
    if (files.length !== 1) {
      setSelection({ status: "error", error: "Choose one COCO ZIP at a time." });
      return;
    }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setSelection({ status: "error", filename: file.name, error: "Choose a .zip file containing your COCO dataset." });
      return;
    }
    setSelection({ status: "validating", filename: file.name });
    try {
      // Retain the complete validated plan for the future startImport(plan) step.
      const plan = await readCocoDatasetZip(file);
      if (version !== validationVersion.current) return;
      if (plan.images.length === 0) {
        setSelection({ status: "error", filename: file.name, error: "The dataset contains no images. Choose a ZIP with at least one referenced image." });
        return;
      }
      setSelection({ status: "ready", filename: file.name, plan });
    } catch (error) {
      if (version !== validationVersion.current) return;
      setSelection({
        status: "error", filename: file.name,
        error: error instanceof Error ? error.message : "Could not validate this dataset. Choose another COCO ZIP.",
      });
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    void selectFiles(Array.from(event.currentTarget.files ?? []));
    // Selecting the same file again must still trigger validation.
    event.currentTarget.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void selectFiles(Array.from(event.dataTransfer.files));
  }

  const plan = selection?.status === "ready" ? selection.plan : null;
  const boxCount = plan?.images.reduce((total, image) => total + image.boxes.length, 0) ?? 0;
  const imageBytes = plan?.images.reduce((total, image) => total + image.file.size, 0) ?? 0;

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto">
        <div
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "flex min-h-40 flex-col items-center justify-center gap-4 rounded-[10px] border border-dashed border-muted-foreground p-4 text-center transition-colors",
            isDragging && "border-primary bg-primary/5",
          )}
        >
          <CloudUpload className="size-[50px] text-muted-foreground" strokeWidth={1.5} />
          <div className="space-y-1">
            <p className="text-[13px]">Drag & Drop or Choose a COCO ZIP</p>
            <p className="text-xs text-muted-foreground">Bounding boxes only · JPEG and PNG images</p>
          </div>
          <Button
            type="button" variant="outline"
            className="h-9 border-primary text-primary shadow-sm hover:bg-primary/5 hover:text-primary"
            onClick={() => inputRef.current?.click()}
          >
            {selection ? "Replace ZIP" : "Browse files"}
          </Button>
          <input ref={inputRef} type="file" accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden" aria-label="Choose COCO ZIP" onChange={handleFileInput} />
        </div>

        {selection ? (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <FileArchive className="size-8 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 break-all text-sm font-medium">{selection.filename ?? "No ZIP selected"}</p>
            <Button type="button" variant="ghost" size="icon" onClick={removeSelection} aria-label="Remove selected ZIP">
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        {selection?.status === "validating" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />Validating...
          </p>
        ) : null}

        {selection?.status === "error" ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{selection.error}</p>
          </div>
        ) : null}

        {plan ? (
          <section aria-label="Dataset preview" className="space-y-4 rounded-lg border p-4">
            <p role="status" className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />Dataset validated
            </p>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Images", numberFormatter.format(plan.images.length)],
                ["Bounding boxes", numberFormatter.format(boxCount)],
                ["Categories", numberFormatter.format(plan.categories.length)],
                ["Extracted image size", formatBytes(imageBytes)],
              ].map(([label, value]) => (
                <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>
              ))}
            </dl>
            <p className="break-all text-xs text-muted-foreground">Annotation document: {plan.annotationPath}</p>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Category names</h3>
              {plan.categories.length ? (
                <div className="flex flex-wrap gap-2">
                  {plan.categories.map((category) => <Badge key={category.id} variant="secondary" className="max-w-full whitespace-normal break-all">{category.name}</Badge>)}
                </div>
              ) : <p className="text-sm text-muted-foreground">No categories in this dataset.</p>}
            </div>
            <p className="text-xs text-muted-foreground">Preview only. No images, labels, or annotations have been imported.</p>
          </section>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}
