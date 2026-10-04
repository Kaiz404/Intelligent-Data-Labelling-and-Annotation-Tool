import { Suspense } from "react";
import { connection } from "next/server";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import {
  SidebarAccount,
  SidebarAccountSkeleton,
} from "@/components/app-shell/sidebar-account";
import {
  StorageUsageSkeleton,
  StorageUsageWidget,
} from "@/components/app-shell/storage-usage-widget";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";

async function SignedInAccount() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return <SidebarAccount email={data?.claims.email} />;
}

/** The sidebar renders at once; only the account row and storage card wait. */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          storageSlot={
            <Suspense fallback={<StorageUsageSkeleton />}>
              <StorageUsageWidget />
            </Suspense>
          }
          accountSlot={
            <Suspense fallback={<SidebarAccountSkeleton />}>
              <SignedInAccount />
            </Suspense>
          }
        />
        <SidebarInset className="flex flex-col">{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
