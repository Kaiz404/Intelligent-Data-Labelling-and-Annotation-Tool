import { Loader2 } from "lucide-react";

type StreamingLoadBannerProps = {
  title: string;
  description?: string;
};

/** Lightweight status while async data streams in after the shell has rendered. */
export function StreamingLoadBanner({
  title,
  description,
}: StreamingLoadBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-lg border border-[#D8E9FF] bg-[#F7FAFF] px-4 py-3 dark:border-primary/20 dark:bg-primary/5"
    >
      <Loader2
        className="size-5 shrink-0 animate-spin text-primary"
        aria-hidden="true"
      />
      <div className="space-y-0.5">
        <p className="text-md font-medium">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
