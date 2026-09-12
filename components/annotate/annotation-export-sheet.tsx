"use client";

import { useState } from "react";
import JSZip from "jszip";
import { CheckCircle2, FileArchive, ImageIcon } from "lucide-react";
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
import { loadAnnotations } from "@/lib/annotations/storage";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";
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
  return new Promise<{ width: number; height: number }>((resolve) => {
    if (!url) return resolve({ width: 1, height: 1 });
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => resolve({ width: 1, height: 1 });
    image.src = url;
  });
}

function xmlEscape(value: string) {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
  })[character] ?? character);
}

function createCoco(images: ExportImage[], labels: AnnotationLabel[]) {
  let annotationId = 1;
  return JSON.stringify({
    info: { description: "SmartAnnoTool export", date_created: new Date().toISOString() },
    images: images.map((image, index) => ({ id: index + 1, file_name: image.fileName, width: image.width, height: image.height })),
    categories: labels.map((label, index) => ({ id: index + 1, name: label.name, supercategory: "object" })),
    annotations: images.flatMap((image, imageIndex) => image.boxes.map((box) => ({
      id: annotationId++,
      image_id: imageIndex + 1,
      category_id: Math.max(labels.findIndex((label) => label.id === box.labelId) + 1, 1),
      bbox: [box.x, box.y, box.width, box.height],
      area: box.width * box.height,
      iscrowd: 0,
    }))),
  }, null, 2);
}

function createYolo(image: ExportImage, labels: AnnotationLabel[]) {
  return image.boxes.map((box) => {
    const classIndex = Math.max(labels.findIndex((label) => label.id === box.labelId), 0);
    const centerX = (box.x + box.width / 2) / image.width;
    const centerY = (box.y + box.height / 2) / image.height;
    return [classIndex, centerX, centerY, box.width / image.width, box.height / image.height]
      .map((value, index) => index === 0 ? String(value) : Number(value).toFixed(6))
      .join(" ");
  }).join("\n");
}

function createVoc(image: ExportImage, labels: AnnotationLabel[]) {
  const objects = image.boxes.map((box) => {
    const label = labels.find((item) => item.id === box.labelId)?.name ?? "unknown";
    return `  <object>\n    <name>${xmlEscape(label)}</name>\n    <pose>Unspecified</pose>\n    <truncated>0</truncated>\n    <difficult>0</difficult>\n    <bndbox>\n      <xmin>${Math.round(box.x)}</xmin>\n      <ymin>${Math.round(box.y)}</ymin>\n      <xmax>${Math.round(box.x + box.width)}</xmax>\n      <ymax>${Math.round(box.y + box.height)}</ymax>\n    </bndbox>\n  </object>`;
  }).join("\n");
  return `<annotation>\n  <filename>${xmlEscape(image.fileName)}</filename>\n  <size>\n    <width>${image.width}</width>\n    <height>${image.height}</height>\n    <depth>3</depth>\n  </size>\n${objects}\n</annotation>`;
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

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const exportImages: ExportImage[] = await Promise.all(images.map(async (image) => ({
        ...image,
        boxes: loadAnnotations(projectId, image.id, image.annotations),
        ...await getDimensions(image.imageUrl ?? image.thumbnailUrl),
      })));
      const baseName = safeName(fileName);
      const zip = new JSZip();

      if (format === "coco") {
        zip.file("annotations.json", createCoco(exportImages, labels));
      } else if (format === "yolo") {
        zip.file("classes.txt", labels.map((label) => label.name).join("\n"));
        exportImages.forEach((image) => zip.file(`labels/${safeName(image.fileName.replace(/\.[^.]+$/, ""))}.txt`, createYolo(image, labels)));
      } else {
        exportImages.forEach((image) => zip.file(`annotations/${safeName(image.fileName.replace(/\.[^.]+$/, ""))}.xml`, createVoc(image, labels)));
      }

      if (content === "images") {
        await Promise.all(exportImages.map(async (image) => {
          const url = image.imageUrl ?? image.thumbnailUrl;
          if (!url) return;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Could not download ${image.fileName}.`);
          zip.file(`images/${image.fileName}`, await response.blob());
        }));
      }

      const requiresZip = compress || content === "images" || format !== "coco" || images.length > 1;
      if (requiresZip) {
        download(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), `${baseName}.zip`);
      } else {
        download(new Blob([createCoco(exportImages, labels)], { type: "application/json" }), `${baseName}.json`);
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
              <button key={item.id} type="button" onClick={() => setFormat(item.id)} className={cn("flex w-full items-center rounded-lg border px-3 py-3 text-xs", format === item.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                <span className={cn("mr-3 flex size-4 items-center justify-center rounded-full border", format === item.id && "border-primary bg-primary text-primary-foreground")}>
                  {format === item.id ? <span className="size-1.5 rounded-full bg-current" /> : null}
                </span>
                <span>{item.name}</span><span className="ml-auto text-muted-foreground">{item.extension}</span>
              </button>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Export content</legend>
            <p className="text-[11px] text-muted-foreground">What would you like to export?</p>
            <button type="button" onClick={() => setContent("labels")} className={cn("flex w-full items-start rounded-lg border px-3 py-3 text-left", content === "labels" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
              <CheckCircle2 className="mr-3 mt-0.5 size-4 text-primary" /><span><span className="block text-xs font-medium">Labels only</span><span className="text-[11px] text-muted-foreground">Export annotation labels only</span></span>
            </button>
            <button type="button" onClick={() => setContent("images")} className={cn("flex w-full items-start rounded-lg border px-3 py-3 text-left", content === "images" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
              <ImageIcon className="mr-3 mt-0.5 size-4 text-primary" /><span><span className="block text-xs font-medium">Labels with images</span><span className="text-[11px] text-muted-foreground">Export labels and source images</span></span>
            </button>
          </fieldset>

          <div className="space-y-2">
            <p className="text-xs font-medium">Compress export</p>
            <label className="flex items-start gap-3 text-xs">
              <Checkbox checked={compress} onCheckedChange={(checked) => setCompress(checked === true)} />
              <span><span className="block font-medium">Export as ZIP file</span><span className="text-[11px] text-muted-foreground">Package all selected files in a .zip archive</span></span>
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
