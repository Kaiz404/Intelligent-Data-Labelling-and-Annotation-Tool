"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  Pause,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { MOCK_UPLOAD_FILES } from "@/lib/mock/image-metadata";
import { formatFileSize, toPercent } from "@/lib/format";
import type { UploadFile, UploadStatus } from "@/lib/types/projects";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const uploadTabs = ["All", "Uploading", "Completed", "Failed"] as const;
type UploadTab = (typeof uploadTabs)[number];

type UploadImagesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function getUploadSummary(files: UploadFile[]) {
  const uploading = files.filter((f) => f.status === "Uploading").length;
  const completed = files.filter((f) => f.status === "Completed").length;
  const failed = files.filter((f) => f.status === "Failed").length;
  const totalSelected = files.length;
  const uploaded = completed + Math.round(uploading * 0.54);
  const totalSizeGb = Math.max(
    files.reduce((sum, f) => sum + f.sizeMb, 0) / 1024,
    9.2,
  );

  return {
    uploading,
    completed,
    failed,
    totalSelected: totalSelected || 126,
    uploaded: uploaded || 82,
    totalSizeGb,
    progress: toPercent(uploaded || 82, totalSelected || 126),
  };
}

function getTabCount(tab: UploadTab, summary: ReturnType<typeof getUploadSummary>) {
  if (tab === "All") return summary.totalSelected;
  if (tab === "Uploading") return summary.uploading || 82;
  if (tab === "Completed") return summary.completed || 38;
  return summary.failed || 6;
}

export function UploadImagesDialog({
  open,
  onOpenChange,
}: UploadImagesDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<UploadFile[]>(MOCK_UPLOAD_FILES);
  const [activeTab, setActiveTab] = useState<UploadTab>("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(2);
  const summary = getUploadSummary(queue);

  const visibleQueue = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return queue
      .filter((file) => file.fileName.toLowerCase().includes(normalizedSearch))
      .filter((file) =>
        activeTab === "All" ? true : file.status === activeTab,
      );
  }, [activeTab, queue, search]);

  function appendFiles(fileList: FileList | null) {
    if (!fileList?.length) return;

    const nextFiles: UploadFile[] = Array.from(fileList).map((file, index) => ({
      id: `upload-local-${Date.now()}-${index}`,
      fileName: file.name,
      sizeMb: Math.max(file.size / 1024 / 1024, 0.1),
      status: "Uploading" as const,
      progress: 0,
    }));

    setQueue((current) => [...nextFiles, ...current]);
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    appendFiles(event.dataTransfer.files);
  }

  function handleStatusChange(fileId: string, status: UploadStatus) {
    setQueue((current) =>
      current.map((file) =>
        file.id === fileId
          ? {
              ...file,
              status,
              progress: status === "Completed" ? 100 : file.progress,
            }
          : file,
      ),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Image(s)</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Drag and drop files to upload images.
          </p>
        </DialogHeader>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className="rounded-lg border border-dashed p-8 text-center"
        >
          <CloudUpload className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-3 font-medium">
            Drag & Drop or Choose file to upload
          </p>
          <p className="text-sm text-muted-foreground">JPG or PNG · Up to 15 GB</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 border-primary text-primary"
            onClick={() => inputRef.current?.click()}
          >
            Browse files
          </Button>
          <input
            ref={inputRef}
            className="hidden"
            multiple
            onChange={handleFileInput}
            type="file"
            accept="image/png,image/jpeg"
          />
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <p className="font-medium">{summary.totalSelected} files selected</p>
              <p className="text-muted-foreground">
                Total size: {summary.totalSizeGb.toFixed(1)} GB
              </p>
            </div>
            <div className="flex-1 space-y-1 min-w-[200px]">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>
                  {summary.uploaded} / {summary.totalSelected} uploaded (
                  {summary.progress}%)
                </span>
              </div>
              <Progress value={summary.progress} className="h-2" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm">
                <Pause className="size-4" />
                Pause All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setQueue([])}
              >
                Cancel All
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as UploadTab)}
            >
              <TabsList>
                {uploadTabs.map((tab) => (
                  <TabsTrigger key={tab} value={tab}>
                    {tab} ({getTabCount(tab, summary)})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="pl-9"
                type="search"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>File Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="w-24">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleQueue.map((file) => (
                <TableRow key={file.id}>
                  <TableCell>
                    <input type="checkbox" aria-label={`Select ${file.fileName}`} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded bg-muted" />
                      <div>
                        <p className="font-medium">{file.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(file.sizeMb)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "flex items-center gap-1 text-sm",
                        file.status === "Completed" && "text-emerald-600",
                        file.status === "Failed" && "text-destructive",
                        file.status === "Uploading" && "text-primary",
                      )}
                    >
                      {file.status === "Completed" ? (
                        <CheckCircle2 className="size-4" />
                      ) : file.status === "Failed" ? (
                        <AlertCircle className="size-4" />
                      ) : (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      {file.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress
                        value={file.status === "Failed" ? 0 : file.progress}
                        className={cn(
                          "h-1.5 w-24",
                          file.status === "Failed" && "[&>div]:bg-destructive",
                        )}
                      />
                      <span className="text-xs text-muted-foreground">
                        {file.status === "Failed" ? "Failed" : `${file.progress}%`}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {file.status === "Uploading" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() =>
                            handleStatusChange(file.id, "Completed")
                          }
                          aria-label={`Pause ${file.fileName}`}
                        >
                          <Pause className="size-4" />
                        </Button>
                      ) : null}
                      {file.status === "Failed" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() =>
                            handleStatusChange(file.id, "Uploading")
                          }
                          aria-label={`Retry ${file.fileName}`}
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() =>
                          setQueue((current) =>
                            current.filter((item) => item.id !== file.id),
                          )
                        }
                        aria-label={`Remove ${file.fileName}`}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-end gap-1 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            {[1, 2, 3].map((p) => (
              <Button
                key={p}
                type="button"
                variant={page === p ? "default" : "ghost"}
                size="sm"
                className="size-8"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <span className="px-1 text-muted-foreground">…</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8"
              onClick={() => setPage(7)}
            >
              7
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
