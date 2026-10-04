"use client";

import { Laptop, Moon, MoreVertical, Sun } from "lucide-react";
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
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

function getInitials(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "U";
}

function AccountRow({ children }: { children: React.ReactNode }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex w-full items-center gap-2 rounded-md p-2 group-data-[collapsible=icon]:justify-center">
          {children}
        </div>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The signed-in user's row in the sidebar footer, with theme and logout. */
export function SidebarAccount({ email }: { email?: string | null }) {
  const { setTheme } = useTheme();
  const displayEmail = email ?? "user@example.com";
  const displayName = displayEmail.split("@")[0] ?? "User";

  return (
    <AccountRow>
      <Avatar className="size-8">
        <AvatarFallback className="bg-primary/10 text-xs text-primary">
          {getInitials(displayEmail)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
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
    </AccountRow>
  );
}

export function SidebarAccountSkeleton() {
  return (
    <AccountRow>
      <Skeleton className="size-8 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-3.5 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
      <span className="sr-only">Loading account</span>
    </AccountRow>
  );
}
