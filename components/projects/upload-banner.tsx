"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, CirclePause, CloudUpload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUploadTimeLeft } from "@/hooks/use-upload-time-left";
import { numberFormatter, toPercent } from "@/lib/format";
import { uploadPhase, type UploadQueueStore } from "@/lib/uploads/upload-queue";

const phaseIcons = {
  running: { icon: CloudUpload, className: "size-5 animate-pulse text-primary" },
  paused: { icon: CirclePause, className: "size-5 text-muted-foreground" },
  finished: { icon: CheckCircle2, className: "size-5 text-emerald-600" },
  failed: { icon: AlertCircle, className: "size-5 text-destructive" },
};

type UploadBannerProps = {
  store: UploadQueueStore;
  onViewDetails: () => void;
};

/**
 * Progress of the project's image uploads, then their outcome until
 * dismissed. Subscribes to the queue itself, so the page around it does not
 * re-render on every progress frame.
 */
export function UploadBanner({ store, onViewDetails }: UploadBannerProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const timeLeft = useUploadTimeLeft(store, snapshot.isRunning);
  const phase = uploadPhase(snapshot);
  if (phase === "idle") return null;

  const { counts, items } = snapshot;
  const uploaded = numberFormatter.format(counts.Completed);
  const total = numberFormatter.format(items.length);
  const failedImages = `${numberFormatter.format(counts.Failed)} image${counts.Failed === 1 ? "" : "s"} failed`;
  const { title, detail } = {
    running: {
      title: `Uploading ${uploaded} of ${total} images · ${timeLeft}`,
      detail: `Runs in the background, so you can keep working.${counts.Failed > 0 ? ` ${failedImages} so far.` : ""}`,
    },
    paused: {
      title: `Upload paused: ${uploaded} of ${total} images uploaded.`,
      detail: "View details to resume or cancel the rest.",
    },
    finished: { title: `Uploaded ${uploaded} of ${total} images.`, detail: "All images were uploaded." },
    failed: { title: `Uploaded ${uploaded} of ${total} images.`, detail: `${failedImages}. View details to retry them.` },
  }[phase];
  const { icon: Icon, className } = phaseIcons[phase];
  const done = phase === "finished" || phase === "failed";

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Icon className={className} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onViewDetails}>
          View details
        </Button>
        {done ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Dismiss"
            onClick={() => void store.cancelAll()}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {done ? null : (
        <Progress
          value={toPercent(counts.Completed, items.length)}
          className="h-1.5"
          aria-label="Images uploaded"
        />
      )}
    </div>
  );
}
