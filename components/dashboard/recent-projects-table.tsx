"use client";

import Link from "next/link";
import { Folder, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTimeFromDate } from "@/lib/format";
import type { Project } from "@/lib/types/projects";

type RecentProjectsTableProps = {
  projects: Project[];
};

export function RecentProjectsTable({ projects }: RecentProjectsTableProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold">Recent Projects</CardTitle>
          <Button
            variant="outline"
            className="border-primary text-primary hover:bg-primary/5"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="size-4" />
            New Project
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No projects yet. Create your first project to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead className="w-24">Images</TableHead>
                  <TableHead className="w-48">Progress</TableHead>
                  <TableHead className="w-36">Last Modified</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${project.id}`}
                        className="flex items-center gap-3 hover:underline"
                      >
                        <Folder className="size-5 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="font-medium">{project.name}</p>
                          {project.description ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {project.description}
                            </p>
                          ) : null}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>0</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={0} className="h-2" />
                        <span className="text-xs text-muted-foreground">0%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {relativeTimeFromDate(project.updated_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Actions for ${project.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="border-t px-6 py-3 text-center">
            <Link
              href="/projects"
              className="text-sm text-primary hover:underline"
            >
              View all projects →
            </Link>
          </div>
        </CardContent>
      </Card>

      <CreateProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </>
  );
}
