"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  CirclePause,
  CircleX,
  CloudUpload,
  ImageIcon,
  Loader2,
  Pause,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import { useUploadQueue } from "@/hooks/use-upload-queue";
import type { UploadQueueItem, UploadTab } from "@/lib/uploads/types";
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
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const uploadTabs = ["All", "Uploading", "Completed", "Failed"] as const;
const PAGE_SIZE = 6;

type UploadImagesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onUploadComplete?: () => void;
};

function statusLabel(status: UploadQueueItem["status"]) {
  if (status === "Queued" || status === "Paused") return "Uploading";
  return status;
}

function StatusCell({ item }: { item: UploadQueueItem }) {
  const label = statusLabel(item.status);
  const isFailed = item.status === "Failed";
  const isCompleted = item.status === "Completed";
  const isActive =
    item.status === "Uploading" ||
    item.status === "Queued" ||
    item.status === "Paused";

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm font-medium",
        isCompleted && "text-emerald-600",
        isFailed && "text-destructive",
        isActive && "text-foreground",
      )}
      title={item.error}
    >
      {isCompleted ? (
        <CheckCircle2 className="size-5 text-emerald-600" />
      ) : isFailed ? (
        <AlertCircle className="size-5 text-destructive" />
      ) : (
        <Loader2
          className={cn(
            "size-5 text-primary",
            item.status === "Uploading" && "animate-spin",
          )}
        />
      )}
      {label}
    </span>
  );
}

export function UploadImagesDialog({
  open,
  onOpenChange,
  projectId,
  onUploadComplete,
}: UploadImagesDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<UploadTab>("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  const {
    items,
    selectedIds,
    isRunning,
    summary,
    addFiles,
    removeItems,
    pauseItem,
    pauseAll,
    cancelAll,
    retryItem,
    startUploads,
    getTabCount,
    matchesTab,
    toggleSelected,
    toggleSelectAll,
  } = useUploadQueue({
    projectId,
    onUploadComplete,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!matchesTab(item, activeTab)) return false;
      if (!q) return true;
      return item.fileName.toLowerCase().includes(q);
    });
  }, [activeTab, items, matchesTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const pageIds = pageItems.map((item) => item.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  useEffect(() => {
    setPage(1);
  }, [activeTab, search]);

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = new Set<number>([1, totalPages, safePage]);
    if (safePage > 1) pages.add(safePage - 1);
    if (safePage < totalPages) pages.add(safePage + 1);
    return [...pages].sort((a, b) => a - b);
  }, [safePage, totalPages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-[960px] flex-col gap-6 overflow-hidden sm:max-w-[960px]">
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-normal">
            Upload Image(s)
          </DialogTitle>
          <DialogDescription>
            Drag and drop files to upload images.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return;
            }
            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-6 rounded-[10px] border border-dashed border-muted-foreground p-6 text-center transition-colors",
            isDragging && "border-primary bg-primary/5",
          )}
        >
          <CloudUpload className="size-[50px] text-muted-foreground" strokeWidth={1.5} />
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-col items-center gap-3">
              <p className="text-[13px] text-foreground">
                Drag & Drop or Choose file to upload
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>JPG or PNG</span>
                <span aria-hidden>·</span>
                <span>Up to 15 GB</span>
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-primary text-primary shadow-sm hover:bg-primary/5 hover:text-primary"
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
              accept="image/png,image/jpeg,.jpg,.jpeg,.png"
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-4 p-2.5 pt-2.5">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-2.5">
                <ImageIcon className="size-10 text-primary" strokeWidth={1.5} />
                <div className="text-sm font-medium leading-5">
                  <p>{summary.totalSelected} files selected</p>
                  <p className="text-[#808080]">
                    Total size: {formatBytes(summary.totalSizeBytes)}
                  </p>
                </div>
              </div>
              <div className="w-full min-w-[200px] space-y-1 sm:w-[300px]">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>
                    {summary.uploaded} / {summary.totalSelected} uploaded (
                    {summary.progress}%)
                  </span>
                </div>
                <Progress value={summary.progress} className="h-2" />
              </div>
            </div>
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-[38px] rounded-[10px] text-muted-foreground shadow-sm"
                onClick={pauseAll}
                disabled={!items.some((i) => i.status === "Uploading" || i.status === "Queued")}
              >
                <CirclePause className="size-5" />
                Pause All
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-[38px] rounded-[10px] text-destructive shadow-sm hover:text-destructive"
                onClick={() => void cancelAll()}
                disabled={items.length === 0}
              >
                <CircleX className="size-5" />
                Cancel All
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2.5">
              {uploadTabs.map((tab) => {
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "rounded-full border border-border px-[15px] py-2 text-sm font-medium transition-colors",
                      active
                        ? "border-border bg-[#d8e9ff] text-primary"
                        : "bg-background text-foreground hover:bg-muted/60",
                    )}
                  >
                    {tab} ({getTabCount(tab)})
                  </button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-[300px]">
              <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
                className="h-[38px] pl-8"
                type="search"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableHead className="w-10 pl-2.5">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={(checked) =>
                        toggleSelectAll(pageIds, checked === true)
                      }
                      aria-label="Select all on page"
                    />
                  </TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[200px]">Progress</TableHead>
                  <TableHead className="w-[84px] text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No files in this view. Browse or drop images to begin.
                    </TableCell>
                  </TableRow>
                ) : (
                  pageItems.map((file) => (
                    <TableRow key={file.id}>
                      <TableCell className="pl-2.5">
                        <Checkbox
                          checked={selectedIds.includes(file.id)}
                          onCheckedChange={(checked) =>
                            toggleSelected(file.id, checked === true)
                          }
                          aria-label={`Select ${file.fileName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="size-10 shrink-0 overflow-hidden rounded-[10px] bg-muted">
                            {file.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={file.previewUrl}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {file.fileName}
                            </p>
                            <p className="text-sm font-medium text-muted-foreground">
                              {formatBytes(file.sizeBytes)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusCell item={file} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Progress
                            value={file.progress}
                            className={cn(
                              "h-2 w-36",
                              file.status === "Failed" &&
                                "[&_[data-slot=progress-indicator]]:bg-destructive",
                            )}
                          />
                          <span className="w-10 text-xs text-muted-foreground">
                            {file.status === "Failed"
                              ? "Failed"
                              : `${file.progress}%`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-3 px-1">
                          {file.status === "Uploading" ||
                          file.status === "Queued" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => pauseItem(file.id)}
                              aria-label={`Pause ${file.fileName}`}
                            >
                              <Pause className="size-4" />
                            </Button>
                          ) : null}
                          {file.status === "Failed" ||
                          file.status === "Paused" ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => retryItem(file.id)}
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
                            onClick={() => void removeItems([file.id])}
                            aria-label={`Remove ${file.fileName}`}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {filtered.length > PAGE_SIZE ? (
            <div className="flex items-center justify-end gap-1 border-t p-2 text-sm">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              {pageNumbers.map((p, index) => {
                const prev = pageNumbers[index - 1];
                const showEllipsis = prev != null && p - prev > 1;
                return (
                  <span key={p} className="contents">
                    {showEllipsis ? (
                      <span className="px-1 text-muted-foreground">…</span>
                    ) : null}
                    <Button
                      type="button"
                      variant={safePage === p ? "default" : "ghost"}
                      size="sm"
                      className="size-8"
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </Button>
                  </span>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => startUploads()}
            disabled={
              isRunning ||
              !items.some(
                (i) =>
                  Boolean(i.file) &&
                  i.status !== "Completed" &&
                  i.status !== "Uploading",
              )
            }
          >
            {isRunning ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
