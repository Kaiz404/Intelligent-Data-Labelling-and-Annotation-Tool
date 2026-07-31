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
} from "@/components/ui/sidebar";
import { navSections } from "@/lib/nav";

type AppSidebarProps = {
  userEmail?: string | null;
};

function getInitials(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "U";
}

export function AppSidebar({ userEmail }: AppSidebarProps) {
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const displayEmail = userEmail ?? "user@example.com";
  const displayName = displayEmail.split("@")[0] ?? "User";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 px-2 py-1 group-data-[collapsible=icon]:justify-center"
        >
          <div
            className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md border border-dashed border-primary/40 bg-primary/5 text-[9px] font-bold leading-tight text-primary"
            aria-hidden="true"
          >
            <span>S</span>
            <span>A</span>
            <span>T</span>
            <MousePointer2 className="mt-0.5 size-3" />
          </div>
          <span className="text-lg font-bold text-primary group-data-[collapsible=icon]:hidden">
            SmartAnnoTool
          </span>
        </Link>
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
