"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

type BreadcrumbSegment = {
  label: string;
  href?: string;
};

type AppHeaderProps = {
  projectName?: string;
  projectId?: string;
  fileName?: string;
  segments?: BreadcrumbSegment[];
};

function buildBreadcrumbs(
  pathname: string,
  options: {
    projectName?: string;
    projectId?: string;
    fileName?: string;
  },
): BreadcrumbSegment[] {
  if (options.projectName && options.fileName && options.projectId) {
    return [
      { label: "Projects", href: "/projects" },
      {
        label: options.projectName,
        href: `/projects/${options.projectId}`,
      },
      { label: options.fileName },
    ];
  }

  if (pathname === "/dashboard") {
    return [{ label: "Dashboard" }];
  }

  if (pathname === "/projects") {
    return [{ label: "Projects" }];
  }

  const annotateMatch = pathname.match(
    /^\/projects\/([^/]+)\/annotate\/([^/]+)$/,
  );
  if (annotateMatch) {
    return [
      { label: "Projects", href: "/projects" },
      {
        label: options.projectName ?? "Project",
        href: `/projects/${annotateMatch[1]}`,
      },
      { label: options.fileName ?? "Image" },
    ];
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    return [
      { label: "Projects", href: "/projects" },
      { label: options.projectName ?? "Project" },
    ];
  }

  return [{ label: "Dashboard", href: "/dashboard" }];
}

export function AppHeader({
  projectName,
  projectId,
  fileName,
  segments: segmentsProp,
}: AppHeaderProps) {
  const pathname = usePathname();
  const segments =
    segmentsProp ??
    buildBreadcrumbs(pathname, { projectName, projectId, fileName });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {segments.map((segment, index) => {
            const isLast = index === segments.length - 1;

            return (
              <span key={`${segment.label}-${index}`} className="contents">
                <BreadcrumbItem>
                  {isLast || !segment.href ? (
                    <BreadcrumbPage>{segment.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link href={segment.href}>{segment.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast ? <BreadcrumbSeparator /> : null}
              </span>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
