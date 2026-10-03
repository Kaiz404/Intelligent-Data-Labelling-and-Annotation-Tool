import { DatabaseZap } from "lucide-react";

/** Shown instead of the bin when its database migration is not applied yet. */
export function RecycleBinSetupNotice({ migration }: { migration: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <DatabaseZap className="size-5" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">The Recycle Bin isn&apos;t set up yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          The Recycle Bin database migration hasn&apos;t been applied yet. Run{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            npx supabase db push
          </code>{" "}
          to apply{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {migration}
          </code>
          , then reload this page. Until then, deleting projects or images is
          blocked so nothing is lost.
        </p>
      </div>
    </div>
  );
}
