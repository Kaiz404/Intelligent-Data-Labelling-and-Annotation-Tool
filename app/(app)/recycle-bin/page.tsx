import { Info } from "lucide-react";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-shell/app-header";
import { RecycleBinClient } from "@/components/recycle-bin/recycle-bin-client";
import { RecycleBinSkeleton } from "@/components/recycle-bin/recycle-bin-skeleton";
import { RecycleBinSetupNotice } from "@/components/recycle-bin/recycle-bin-setup-notice";
import {
  fetchRecycleBin,
  purgeExpiredRecycleBinItems,
  RECYCLE_BIN_MIGRATION,
  RECYCLE_BIN_RETENTION_DAYS,
  RecycleBinUnavailableError,
  requireRecycleBinUser,
} from "@/lib/recycle-bin";
import { createClient } from "@/lib/supabase/server";

async function RecycleBinContent() {
  await connection();

  try {
    // Created up front: after() callbacks in Server Components cannot read cookies.
    const supabase = await createClient();
    const session = requireRecycleBinUser(supabase).then((user) => ({
      supabase,
      userId: user.id,
    }));

    // Lazy retention: purge expired items once the response is sent, so it
    // never delays the page. fetchRecycleBin() already hides expired rows.
    after(async () => {
      try {
        await purgeExpiredRecycleBinItems(await session);
      } catch (error) {
        if (!(error instanceof RecycleBinUnavailableError)) {
          console.error("[recycle-bin] Could not purge expired items", error);
        }
      }
    });

    // RLS scopes the listing, so it loads alongside the sign-in check.
    const [contents] = await Promise.all([fetchRecycleBin({ supabase }), session]);
    return (
      <RecycleBinClient {...contents} retentionDays={RECYCLE_BIN_RETENTION_DAYS} />
    );
  } catch (error) {
    if (error instanceof RecycleBinUnavailableError) {
      return <RecycleBinSetupNotice migration={RECYCLE_BIN_MIGRATION} />;
    }
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Could not load the Recycle Bin."}
      </p>
    );
  }
}

export default function RecycleBinPage() {
  return (
    <>
      <AppHeader segments={[{ label: "Recycle Bin" }]} />
      <div className="flex-1 space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Recycle Bin</h1>
            <p className="text-muted-foreground">
              Recover or permanently delete your deleted projects and images
            </p>
          </div>
          <p className="flex w-fit items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <span>
              Items in the recycle bin are automatically deleted after{" "}
              <strong className="font-semibold">
                {RECYCLE_BIN_RETENTION_DAYS} days
              </strong>
            </span>
          </p>
        </div>
        <Suspense fallback={<RecycleBinSkeleton />}>
          <RecycleBinContent />
        </Suspense>
      </div>
    </>
  );
}
