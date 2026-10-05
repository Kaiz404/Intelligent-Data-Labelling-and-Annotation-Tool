import type { LucideIcon } from "lucide-react";
import {
  Folder,
  LayoutDashboard,
  Route,
  Trash2,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    title: "Platform",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Projects", href: "/projects", icon: Folder },
      {
        label: "Annotate",
        href: "/projects",
        icon: Route,
      },
      {
        label: "Recycle Bin",
        href: "#",
        icon: Trash2,
        disabled: true,
      },
    ],
  },
];
