import { Suspense } from "react";
import { connection } from "next/server";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";

async function AppSidebarWithUser() {
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <AppSidebar userEmail={user?.email} />;
}

function SidebarFallback() {
  return (
    <div className="hidden w-64 border-r p-4 md:block">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mt-6 h-40 w-full" />
    </div>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Suspense fallback={<SidebarFallback />}>
          <AppSidebarWithUser />
        </Suspense>
        <SidebarInset className="flex flex-col">{children}</SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
