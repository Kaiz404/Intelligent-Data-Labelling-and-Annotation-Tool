"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Laptop, Moon, MousePointer2, MoreVertical, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { LogoutButton } from "@/components/logout-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
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
import { navSections } from "@/lib/nav";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  userEmail?: string | null;
};

function getInitials(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "U";
}

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

export function AppSidebar({ userEmail }: AppSidebarProps) {
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const displayEmail = userEmail ?? "user@example.com";
  const displayName = displayEmail.split("@")[0] ?? "User";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        {navSections.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    !item.disabled &&
                    (item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.href));

                  return (
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
                          isActive={isActive}
                          tooltip={item.label}
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className="rounded-lg border bg-card p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Storage used</span>
            <span className="font-medium">10 GB / 100 GB</span>
          </div>
          <Progress value={10} className="mt-2 h-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">10% used</p>
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex w-full items-center gap-2 rounded-md p-2 group-data-[collapsible=icon]:justify-center">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {getInitials(displayEmail)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {displayEmail}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-1 hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
                    aria-label="Account menu"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="size-4" />
                    Light
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="size-4" />
                    Dark
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Laptop className="size-4" />
                    System
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="p-0">
                    <LogoutButton className="w-full px-2" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
