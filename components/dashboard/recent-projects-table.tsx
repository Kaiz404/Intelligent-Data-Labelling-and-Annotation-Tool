"use client";

import Link from "next/link";
import { Copy, Download, Edit3, Folder, Images, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { AnnotationExportSheet } from "@/components/annotate/annotation-export-sheet";
import { CopyImagesDialog, DeleteProjectDialog, DuplicateProjectDialog, EditProjectDialog } from "@/components/dashboard/project-action-dialogs";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProjectExportData } from "@/lib/actions/projects";
import { relativeTimeFromDate, toPercent } from "@/lib/format";
import type { AnnotationLabel } from "@/lib/types/annotations";
import type { Project, ProjectImage } from "@/lib/types/projects";

type RecentProjectsTableProps = {
  projects: Project[];
  copyDestinations?: Project[];
};
type ProjectAction = "edit" | "duplicate" | "copy" | "delete" | null;
type ExportData = { project: Project; images: ProjectImage[]; labels: AnnotationLabel[] };

export function RecentProjectsTable({
  projects,
  copyDestinations = projects,
}: RecentProjectsTableProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [action, setAction] = useState<ProjectAction>(null);
  const [exportData, setExportData] = useState<ExportData | null>(null);
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openAction = (project: Project, nextAction: Exclude<ProjectAction, null>) => {
    setSelectedProject(project);
    setAction(nextAction);
    setActionError(null);
  };

  const openExport = async (project: Project) => {
    setExportingProjectId(project.id);
    setActionError(null);
    try {
      setExportData(await getProjectExportData(project.id));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not prepare the export.");
    } finally {
      setExportingProjectId(null);
    }
  };

  return (
    <>
      <Card className="overflow-hidden shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b py-4">
          <CardTitle className="text-lg font-semibold">Recent Projects</CardTitle>
          <Button variant="outline" className="border-primary text-primary hover:text-primary" onClick={() => setIsCreateOpen(true)}><Plus className="size-4" />New Project</Button>
        </CardHeader>
        <CardContent className="p-0">
          {actionError ? <p className="mx-4 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</p> : null}
          {projects.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No projects yet. Create your first project to get started.</div>
          ) : (
            <Table>
              <TableHeader><TableRow className="bg-muted/70"><TableHead>Project Name</TableHead><TableHead className="w-30 text-center">Images</TableHead><TableHead className="w-70">Progress</TableHead><TableHead className="w-50 text-center">Last Modified</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {projects.map((project) => {
                  const progress = toPercent(project.annotated_count ?? 0, project.image_count ?? 0);
                  return (
                    <TableRow className="hover:bg-muted/40" key={project.id}>
                      <TableCell>
                        <Link href={`/projects/${project.id}`} className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10"><Folder className="size-5 text-primary" /></span>
                          <div className="min-w-0"><p className="font-medium hover:text-primary">{project.name}</p>{project.description ? <p className="max-w-[320px] truncate text-xs text-muted-foreground">{project.description}</p> : null}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">{project.image_count ?? 0}</TableCell>
                      <TableCell><div className="flex items-center gap-2"><Progress value={progress} className="h-2" /><span className="w-9 text-xs tabular-nums text-muted-foreground">{progress}%</span></div></TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">{relativeTimeFromDate(project.updated_at)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${project.name}`}><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => openAction(project, "edit")}><Edit3 />Edit Project</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openAction(project, "duplicate")}><Copy />Duplicate Project</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openAction(project, "copy")}><Images />Copy Images to Project</DropdownMenuItem>
                            <DropdownMenuItem disabled={exportingProjectId === project.id} onSelect={() => void openExport(project)}><Download />{exportingProjectId === project.id ? "Preparing Export..." : "Export"}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => openAction(project, "delete")}><Trash2 />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <div className="border-t px-6 py-3 text-center hover:bg-muted/40"><Link href="/projects" className="text-sm text-primary hover:underline">View all projects →</Link></div>
        </CardContent>
      </Card>

      <CreateProjectDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
      <EditProjectDialog project={selectedProject} open={action === "edit"} onOpenChange={(open) => !open && setAction(null)} />
      <DuplicateProjectDialog project={selectedProject} open={action === "duplicate"} onOpenChange={(open) => !open && setAction(null)} />
      <CopyImagesDialog project={selectedProject} projects={copyDestinations} open={action === "copy"} onOpenChange={(open) => !open && setAction(null)} />
      <DeleteProjectDialog project={selectedProject} open={action === "delete"} onOpenChange={(open) => !open && setAction(null)} />
      {exportData ? <AnnotationExportSheet key={exportData.project.id} open onOpenChange={(open) => !open && setExportData(null)} projectId={exportData.project.id} projectName={exportData.project.name} images={exportData.images} labels={exportData.labels} /> : null}
    </>
  );
}
