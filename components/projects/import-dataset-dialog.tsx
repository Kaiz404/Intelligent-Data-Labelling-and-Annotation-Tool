"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, CloudUpload, FileArchive, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDatasetImportActions, useDatasetImportRun } from "@/components/projects/dataset-import-provider";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, numberFormatter } from "@/lib/format";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { isImportActive, type DatasetImportRun, type DatasetImportState } from "@/lib/uploads/dataset-import";
import { readCocoDatasetZip } from "@/lib/uploads/dataset-zip";
import { readYoloDatasetZip } from "@/lib/uploads/yolo-dataset-zip";
import { readVocDatasetZip } from "@/lib/uploads/voc-dataset-zip";
import type { VocCoordinateProfile } from "@/lib/annotations/voc-import";
import { cn } from "@/lib/utils";

type ImportDatasetDialogProps = {
  projectId: string;
  /** Shown on the progress pill while the user is on other pages. */
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Selection =
  | { status: "validating"; filename: string }
  | { status: "error"; filename?: string; error: string }
  | { status: "ready"; filename: string; plan: ValidatedDatasetImportPlan };

type DatasetFormat = "coco" | "yolo" | "voc";
const formatNames = { coco: "COCO", yolo: "YOLO", voc: "Pascal VOC" } as const;
const profileNames = {
  "app-native": "App-native",
  "one-based-inclusive": "Standard Pascal VOC (1-based inclusive)",
} as const;

/**
 * Picks and validates a dataset, then hands it to the app-level import, which
 * keeps running after this dialog closes. While the project has a run, the
 * dialog shows its progress or outcome instead of the picker.
 */
export function ImportDatasetDialog({ projectId, projectName, open, onOpenChange }: ImportDatasetDialogProps) {
  const run = useDatasetImportRun(projectId);
  const { startDatasetImport, dismissDatasetImport } = useDatasetImportActions();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-6 overflow-hidden sm:max-w-[720px]">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-normal">Import dataset</DialogTitle>
          <DialogDescription className="break-all">
            {run
              ? isImportActive(run.state)
                ? `Importing ${run.fileName} into this project.`
                : `Finished importing ${run.fileName}.`
              : "Choose a format and ZIP. Validate and preview your dataset, then import it into this project."}
          </DialogDescription>
        </DialogHeader>
        {run ? (
          <ImportRunDetails
            run={run}
            onClose={() => onOpenChange(false)}
            onImportAnother={() => dismissDatasetImport(projectId)}
          />
        ) : (
          <DatasetSelection
            onClose={() => onOpenChange(false)}
            onStart={(plan, fileName) => startDatasetImport({ projectId, projectName, fileName, plan })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportRunDetails({ run, onClose, onImportAnother }: {
  run: DatasetImportRun;
  onClose: () => void;
  onImportAnother: () => void;
}) {
  const active = isImportActive(run.state);
  return (
    <>
      <div className="min-h-0 overflow-y-auto">
        <ImportOutcome state={run.state} />
      </div>
      <DialogFooter>
        {active ? null : <Button type="button" variant="outline" onClick={onImportAnother}>Import another dataset</Button>}
        <Button type="button" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}

function DatasetSelection({ onClose, onStart }: {
  onClose: () => void;
  onStart: (plan: ValidatedDatasetImportPlan, fileName: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const validationVersion = useRef(0);
  // Retained input handlers must use the new format even before React re-renders.
  const formatRef = useRef<DatasetFormat>("coco");
  const [format, setFormat] = useState<DatasetFormat>("coco");
  const profileRef = useRef<VocCoordinateProfile>("app-native");
  const [coordinateProfile, setCoordinateProfile] = useState<VocCoordinateProfile>("app-native");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Invalidates pending work on unmount (including closing the dialog).
  useEffect(() => () => { validationVersion.current += 1; }, []);

  function removeSelection() {
    validationVersion.current += 1;
    setSelection(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function changeFormat(value: string) {
    if ((value !== "coco" && value !== "yolo" && value !== "voc") || value === formatRef.current) return;
    formatRef.current = value;
    setFormat(value);
    removeSelection();
    setIsDragging(false);
  }

  function changeProfile(value: string) {
    if (formatRef.current !== "voc" ||
        (value !== "app-native" && value !== "one-based-inclusive") || value === profileRef.current) return;
    profileRef.current = value;
    setCoordinateProfile(value);
    removeSelection();
    setIsDragging(false);
  }

  async function selectFiles(files: File[]) {
    if (files.length === 0) return;
    const version = ++validationVersion.current;
    const selectedFormat = formatRef.current;
    const formatName = formatNames[selectedFormat];
    if (files.length !== 1) {
      setSelection({ status: "error", error: `Choose one ${formatName} ZIP at a time.` });
      return;
    }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setSelection({ status: "error", filename: file.name, error: `Choose a .zip file containing your ${formatName} dataset.` });
      return;
    }
    setSelection({ status: "validating", filename: file.name });
    try {
      // Keep the complete plan; importing only starts from the explicit action.
      const plan = await (selectedFormat === "coco" ? readCocoDatasetZip(file)
        : selectedFormat === "yolo" ? readYoloDatasetZip(file)
          : readVocDatasetZip(file, { coordinateProfile: profileRef.current }));
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
        error: error instanceof Error ? error.message : `Could not validate this dataset. Choose another ${formatName} ZIP.`,
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

  const ready = selection?.status === "ready" ? selection : null;
  const plan = ready?.plan ?? null;
  const boxCount = plan?.images.reduce((total, image) => total + image.boxes.length, 0) ?? 0;
  const imageBytes = plan?.images.reduce((total, image) => total + image.file.size, 0) ?? 0;
  const renderedVersion = validationVersion.current;

  return (
    <>
      <div className="min-h-0 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <label htmlFor="dataset-format" className="text-sm font-medium">Dataset format</label>
          <Select value={format} onValueChange={changeFormat}>
            <SelectTrigger id="dataset-format" aria-label="Dataset format" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="coco">COCO</SelectItem>
              <SelectItem value="yolo">YOLO</SelectItem>
              <SelectItem value="voc">Pascal VOC</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {format === "coco"
              ? "Expected ZIP: one COCO annotation JSON and its referenced JPEG/PNG images."
              : format === "yolo"
                ? "Supports classes.txt with images/labels, or data.yaml datasets with train/val/valid/test image and label folders. JPEG/PNG object detection only. Dataset splits are combined into this project."
                : "Expected ZIP: images/ and annotations/, or JPEGImages/ and Annotations/. Each image must have an XML annotation file; XML files with zero objects are valid. pose/truncated/difficult metadata is not preserved."}
          </p>
        </div>
        {format === "voc" ? <div className="space-y-2">
          <label htmlFor="voc-coordinate-profile" className="text-sm font-medium">Coordinate profile</label>
          <Select value={coordinateProfile} onValueChange={changeProfile}>
            <SelectTrigger id="voc-coordinate-profile" aria-label="Coordinate profile" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="app-native">{profileNames["app-native"]}</SelectItem>
              <SelectItem value="one-based-inclusive">{profileNames["one-based-inclusive"]}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {coordinateProfile === "app-native"
              ? "Compatible with Pascal VOC datasets exported by this application."
              : "For traditional VOC datasets using one-based inclusive pixel coordinates."}
          </p>
        </div> : null}
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
            <p className="text-[13px]">Drag & Drop or Choose a {formatNames[format]} ZIP</p>
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
            className="hidden" aria-label={`Choose ${formatNames[format]} ZIP`} onChange={handleFileInput} />
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
            <p className="text-sm">Format: <Badge variant="secondary">{formatNames[format]}</Badge></p>
            {format === "voc" ? <p className="text-sm">Coordinate profile: {profileNames[coordinateProfile]}</p> : null}
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
            <p className="break-all text-xs text-muted-foreground">Annotation source: {plan.annotationPath}</p>
            {format === "yolo" && !!plan.missingLabelImagePaths?.length ? (
              <p role="note" className="text-sm text-muted-foreground">
                {numberFormatter.format(plan.missingLabelImagePaths.length)} {plan.missingLabelImagePaths.length === 1 ? "image has" : "images have"} no label file and will be imported without annotations.
              </p>
            ) : null}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Category names</h3>
              {plan.categories.length ? (
                <div className="flex flex-wrap gap-2">
                  {plan.categories.map((category) => <Badge key={category.id} variant="secondary" className="max-w-full whitespace-normal break-all">{category.name}</Badge>)}
                </div>
              ) : <p className="text-sm text-muted-foreground">No categories in this dataset.</p>}
            </div>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">No images, labels, or annotations have been imported yet.</p>
              <Button type="button" onClick={() => {
                // Reject a click retained from an older preview, even before a re-render.
                if (renderedVersion !== validationVersion.current || !ready) return;
                onStart(ready.plan, ready.filename);
              }}>Import</Button>
            </div>
          </section>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}

const imageStatusLabels = {
  queued: "Pending", uploading: "Uploading", saving_annotations: "Saving annotations",
  succeeded: "Success", failed: "Failed",
} as const;

function ImportOutcome({ state }: { state: DatasetImportState }) {
  const active = isImportActive(state);
  const status = active
    ? state.status === "resolving_labels" ? "Preparing labels..." : "Import is still running..."
    : state.status === "completed" ? "Import complete"
      : state.status === "completed_with_errors" ? "Import finished with failures" : "Import failed";
  return (
    <section aria-label="Import progress and outcome" className="space-y-4 rounded-lg border p-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        {active ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}{status}
      </p>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-muted-foreground">Completed images</dt><dd>{state.completedImageCount} / {state.totalImageCount}</dd></div>
        <div><dt className="text-muted-foreground">Successful images</dt><dd>{state.successfulImageCount}</dd></div>
        <div><dt className="text-muted-foreground">Failed images</dt><dd>{state.failedImageCount}</dd></div>
      </dl>
      <div className="space-y-2">
        <p className="text-sm">Upload progress (by image bytes): {Math.round(state.uploadProgress)}%</p>
        <Progress value={state.uploadProgress} aria-label="Byte-weighted upload progress" />
        <p className="text-xs text-muted-foreground">100% uploaded does not mean the import is complete. Images succeed only after their annotations are saved.</p>
      </div>
      {active ? <p className="text-sm text-muted-foreground">
        The import keeps running in the background and images appear in the project as they finish. You can close this dialog and keep working; keep this tab open until it finishes.
      </p> : null}
      {state.status === "failed" ? <div role="alert" className="space-y-1 text-sm text-destructive">
        {state.labelResolutionFailed ? <p>Label preparation failed. No image uploads were started; some labels may already have been created.</p> : null}
        <p>{state.error ?? "An unexpected import error occurred."}</p>
      </div> : null}
      {!active && state.status !== "completed" ? <p className="text-sm text-muted-foreground">
        Existing uploads and successful saves are kept. Importing the same dataset again may create duplicate images.
      </p> : null}
      {state.images.length ? <Table>
        <TableHeader><TableRow><TableHead>Image</TableHead><TableHead>Status</TableHead><TableHead>Upload</TableHead></TableRow></TableHeader>
        <TableBody>{state.images.map((image) => <TableRow key={image.sourceImageId}>
          <TableCell className="max-w-[300px] whitespace-normal break-all">
            {image.path}
            {image.status === "failed" ? <>
              {image.failureStage === "annotations" ? <p className="mt-1 text-xs text-destructive">Image uploaded, but its annotations were not imported.</p> : null}
              <p className="mt-1 text-xs text-destructive">{image.error}</p>
            </> : null}
          </TableCell>
          <TableCell><Badge variant={image.status === "failed" ? "destructive" : "secondary"}>{imageStatusLabels[image.status]}</Badge></TableCell>
          <TableCell>{Math.round(image.uploadProgress)}%</TableCell>
        </TableRow>)}</TableBody>
      </Table> : null}
    </section>
  );
}
