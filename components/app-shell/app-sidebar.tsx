"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { MousePointer2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { navSections, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  /** Streamed in their own Suspense boundaries, so the rest renders at once. */
  storageSlot?: React.ReactNode;
  accountSlot?: React.ReactNode;
};

function SidebarBrand() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Link
      href="/dashboard"
      aria-label="SmartAnnoTool"
      className="flex flex-col items-center py-2.5 px-2.5"
    >
      <div className="relative shrink-0" aria-hidden="true">
        <div
          className="flex h-9 w-12 items-center justify-center rounded-sm border border-dashed border-muted-foreground/40 bg-background"
        >
          <span className="text-[10px] font-bold leading-none tracking-[0.22em] text-foreground">
            S A T
          </span>
        </div>
        <MousePointer2
          className="absolute -bottom-2 -right-2 size-4 fill-background text-muted-foreground"
          strokeWidth={1.5}
        />
      </div>
      <span
        className={cn(
          "overflow-hidden whitespace-nowrap text-base font-bold text-primary transition-all duration-200 ease-linear",
          isCollapsed
            ? "mt-0 max-h-0 opacity-0 -translate-y-1"
            : "mt-2 max-h-10 opacity-100 translate-y-0"
        )}
      >
        SmartAnnoTool
      </span>
    </Link>
  );
}

function isActiveItem(item: NavItem, pathname: string | null) {
  if (item.disabled || pathname === null) return false;
  if (item.label === "Annotate") {
    // Recent Annotations hub or an image workspace.
    return pathname === item.href || pathname.includes("/annotate/");
  }
  if (item.href === "/dashboard") return pathname === "/dashboard";
  if (item.href === "/projects") {
    return (
      (pathname === "/projects" || /^\/projects\/[^/]+$/.test(pathname)) &&
      !pathname.includes("/annotate/")
    );
  }
  return pathname.startsWith(item.href);
}

/** `pathname` is null in the prerendered shell, before the URL is known. */
function NavSections({ pathname }: { pathname: string | null }) {
  return navSections.map((section) => (
    <SidebarGroup key={section.title}>
      <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {section.items.map((item) => (
            <SidebarMenuItem key={item.label}>
              {item.disabled ? (
                <SidebarMenuButton
                  disabled
                  className="cursor-not-allowed opacity-50"
                  tooltip={item.label}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  asChild
                  isActive={isActiveItem(item, pathname)}
                  tooltip={item.label}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
}

function ActiveNavSections() {
  return <NavSections pathname={usePathname()} />;
}

export function AppSidebar({ storageSlot, accountSlot }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        <Suspense fallback={<NavSections pathname={null} />}>
          <ActiveNavSections />
        </Suspense>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {storageSlot}

        {accountSlot}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
