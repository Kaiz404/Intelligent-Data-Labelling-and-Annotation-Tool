"use client";

import { useState } from "react";
import { FileArchive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createCocoExport,
  createVocExport,
  createYoloClasses,
  createYoloExport,
  exportStem,
  nameExportImages,
} from "@/lib/annotations/export";
import { loadAnnotations } from "@/lib/annotations/storage";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";
import type { ProjectExportData, ProjectImage } from "@/lib/types/projects";
import { cn } from "@/lib/utils";

type ExportFormat = "coco" | "yolo" | "voc";
type ExportContent = "labels" | "images";

type ExportImage = ProjectImage & {
  boxes: BoundingBox[];
  width: number;
  height: number;
};

const formats: Array<{ id: ExportFormat; name: string; extension: string }> = [
  { id: "coco", name: "COCO", extension: ".json" },
  { id: "yolo", name: "YOLO", extension: ".txt" },
  { id: "voc", name: "Pascal VOC", extension: ".xml" },
];

const contentOptions: Array<{ id: ExportContent; name: string; description: string }> = [
  { id: "labels", name: "Labels only", description: "Export annotation labels only" },
  { id: "images", name: "Labels with images", description: "Export labels and source images" },
];

function RadioIndicator({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", checked && "border-primary bg-primary text-primary-foreground", className)}>
      {checked ? <span className="size-1.5 rounded-full bg-current" /> : null}
    </span>
  );
}

function safeName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "annotations";
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getDimensions(url: string | null) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    if (!url) return reject(new Error("An image is unavailable. Refresh the page and try again."));
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("Could not read an image's dimensions. Refresh the page and try again."));
    image.src = url;
  });
}

/** Loads a project's export data (fresh signed URLs, saved annotations, labels). */
export async function fetchExportData(projectId: string): Promise<ProjectExportData> {
  const response = await fetch(`/api/projects/${projectId}/export`, {
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (ProjectExportData & { error?: string })
    | null;
  if (!response.ok || !body?.project) {
    throw new Error(body?.error ?? "Could not prepare the export.");
  }
  return body;
}

export function AnnotationExportSheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  images,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  images: ProjectImage[];
  labels: AnnotationLabel[];
}) {
  const [fileName, setFileName] = useState(projectName);
  const [format, setFormat] = useState<ExportFormat>("coco");
  const [content, setContent] = useState<ExportContent>("labels");
  const [compress, setCompress] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-image YOLO/VOC labels and source images need one ZIP; a COCO JSON
  // remains a single file regardless of how many images it describes.
  const zipRequired = content === "images" || format !== "coco";
  const exportAsZip = zipRequired || compress;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      // Loaded on demand: only exports need it.
      const { default: JSZip } = await import("jszip");
      const exportImages = nameExportImages(await Promise.all(images.map(async (image): Promise<ExportImage> => ({
        ...image,
        boxes: loadAnnotations(projectId, image.id, image.annotations),
        ...await getDimensions(image.url),
      }))));
      const baseName = safeName(fileName);
      const zip = new JSZip();

      if (format === "coco") {
        zip.file("annotations.json", createCocoExport(exportImages, labels));
      } else if (format === "yolo") {
        zip.file("classes.txt", createYoloClasses(labels));
        exportImages.forEach((image) => zip.file(`labels/${exportStem(image.exportFileName)}.txt`, createYoloExport(image, labels)));
      } else {
        exportImages.forEach((image) => zip.file(`annotations/${exportStem(image.exportFileName)}.xml`, createVocExport(image, labels)));
      }

      if (content === "images") {
        await Promise.all(exportImages.map(async (image) => {
          if (!image.url) return;
          // Not from the HTTP cache: copies cached by no-CORS <img> loads lack
          // the CORS headers a fetch needs.
          const response = await fetch(image.url, { cache: "no-store" });
          if (!response.ok) throw new Error(`Could not download ${image.fileName}.`);
          zip.file(`images/${image.exportFileName}`, await response.blob());
        }));
      }

      if (exportAsZip) {
        download(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `${baseName}.zip`);
      } else {
        download(new Blob([createCocoExport(exportImages, labels)], { type: "application/json" }), `${baseName}.json`);
      }
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[390px] max-w-[92vw] gap-0 sm:max-w-[390px]">
        <SheetHeader className="border-b px-5 py-5">
          <SheetTitle className="text-base">Export Dataset</SheetTitle>
          <SheetDescription className="text-xs">Export your annotations in your preferred format.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="space-y-2">
            <label htmlFor="export-name" className="text-xs font-medium">File name</label>
            <Input id="export-name" value={fileName} onChange={(event) => setFileName(event.target.value)} className="h-9 text-xs" />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Select format</legend>
            <p className="text-[11px] text-muted-foreground">Choose the annotation format.</p>
            {formats.map((item) => (
              <button key={item.id} type="button" aria-pressed={format === item.id} onClick={() => setFormat(item.id)} className={cn("flex w-full items-center rounded-lg border px-3 py-3 text-xs", format === item.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                <RadioIndicator checked={format === item.id} className="mr-3" />
                <span>{item.name}</span><span className="ml-auto text-muted-foreground">{item.extension}</span>
              </button>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Export content</legend>
            <p className="text-[11px] text-muted-foreground">What would you like to export?</p>
            {contentOptions.map((item) => (
              <button key={item.id} type="button" aria-pressed={content === item.id} onClick={() => setContent(item.id)} className={cn("flex w-full items-start rounded-lg border px-3 py-3 text-left", content === item.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                <RadioIndicator checked={content === item.id} className="mr-3 mt-0.5" />
                <span><span className="block text-xs font-medium">{item.name}</span><span className="text-[11px] text-muted-foreground">{item.description}</span></span>
              </button>
            ))}
          </fieldset>

          <div className="space-y-2">
            <p className="text-xs font-medium">Compress export</p>
            <label className={cn("flex items-start gap-3 text-xs", zipRequired && "cursor-not-allowed")}>
              <Checkbox checked={exportAsZip} disabled={zipRequired} onCheckedChange={(checked) => setCompress(checked === true)} />
              <span>
                <span className={cn("block font-medium", zipRequired && "text-muted-foreground")}>Export as ZIP file</span>
                <span className="text-[11px] text-muted-foreground">{zipRequired ? "Required when exporting multiple files" : "Package all selected files in a .zip archive"}</span>
              </span>
            </label>
          </div>
          {error ? <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</p> : null}
        </div>
        <SheetFooter className="border-t px-5 py-4">
          <Button type="button" onClick={handleExport} disabled={exporting || !fileName.trim()}>
            <FileArchive className="size-4" /> {exporting ? "Exporting..." : "Export Dataset"}
          </Button>
          <SheetClose asChild><Button type="button" variant="outline">Close</Button></SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
