import type { LucideIcon } from "lucide-react";
import {
  CircleHelp,
  Clock,
  Database,
  Folder,
  LayoutDashboard,
  Route,
  Settings,
  Star,
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
        label: "Datasets",
        href: "#",
        icon: Database,
        disabled: true,
      },
      {
        label: "Annotate",
        href: "#",
        icon: Route,
        disabled: true,
      },
    ],
  },
  {
    title: "Pages",
    items: [
      {
        label: "Recent Files",
        href: "#",
        icon: Clock,
        disabled: true,
      },
      {
        label: "Starred",
        href: "#",
        icon: Star,
        disabled: true,
      },
      {
        label: "Recycle Bin",
        href: "#",
        icon: Trash2,
        disabled: true,
      },
    ],
  },
  {
    title: "Misc",
    items: [
      {
        label: "Settings",
        href: "#",
        icon: Settings,
        disabled: true,
      },
      {
        label: "Get Help",
        href: "#",
        icon: CircleHelp,
        disabled: true,
      },
    ],
  },
];
