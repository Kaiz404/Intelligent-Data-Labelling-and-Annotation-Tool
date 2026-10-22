import type { Project } from "@/lib/types/projects";

/** List-page fields enough to paint the project detail shell before the server responds. */
export type ProjectPreview = Pick<
  Project,
  | "id"
  | "name"
  | "description"
  | "starred"
  | "created_at"
  | "updated_at"
  | "user_id"
  | "image_count"
  | "annotated_count"
  | "last_activity_at"
>;

const previews = new Map<string, ProjectPreview>();

export function rememberProjectPreview(project: ProjectPreview) {
  previews.set(project.id, project);
}

export function readProjectPreview(projectId: string): ProjectPreview | undefined {
  return previews.get(projectId);
}
