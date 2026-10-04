import "server-only";

import { fetchAllRows, forEachRowPage } from "@/lib/supabase/rows";
import { createClient } from "@/lib/supabase/server";
import {
  createImageReadUrl,
  objectKeyBelongsToProject,
} from "@/lib/uploads/s3-server";
import type { BoundingBox } from "@/lib/types/annotations";
import type { ImageStatus, ProjectImage } from "@/lib/types/projects";
import type { RecentAnnotationsResult } from "@/lib/types/recent-annotations";

type ImageRow = {
  id: string;
  name: string;
  object_key: string;
  size_bytes: number;
  created_at: string;
  modified_at: string | null;
  annotation: unknown;
  thumbhash: string | null;
};

const IMAGE_COLUMNS =
  "id, name, object_key, size_bytes, created_at, modified_at, annotation, thumbhash";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function annotationStatus(annotation: unknown): {
  status: ImageStatus;
  progress: number;
} {
  const hasAnnotations =
    Array.isArray(annotation) ? annotation.length > 0 : annotation != null;

  return hasAnnotations
    ? { status: "Annotated", progress: 100 }
    : { status: "Unannotated", progress: 0 };
}

async function toProjectImage(
  row: ImageRow,
  projectId: string,
): Promise<ProjectImage> {
  // `images.object_key` is not constrained by RLS, so only sign keys under the
  // row's own project; anything else gets no URL rather than another object.
  const url = objectKeyBelongsToProject(row.object_key, projectId)
    ? await createImageReadUrl(row.object_key)
    : null;
  const { status, progress } = annotationStatus(row.annotation);

  return {
    id: row.id,
    fileName: row.name,
    sizeBytes: row.size_bytes,
    capturedAt: dateFormatter.format(new Date(row.created_at)),
    modifiedAt: row.modified_at,
    status,
    progress,
    url,
    thumbhash: row.thumbhash,
    annotations: parseAnnotations(row.annotation),
  };
}

/** Every image of a project, oldest upload first, paged past the PostgREST row cap. */
export async function fetchProjectImages(
  projectId: string,
): Promise<ProjectImage[]> {
  const supabase = await createClient();
  const rows = await fetchAllRows<ImageRow>("project images", (count) =>
    supabase
      .from("images")
      .select(IMAGE_COLUMNS, count)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      // Breaks upload-time ties, so pages never overlap.
      .order("id", { ascending: true }),
  );

  return Promise.all(rows.map((row) => toProjectImage(row, projectId)));
}

type RecentImageRow = ImageRow & {
  project_id: string;
  projects: { name: string } | { name: string }[] | null;
};

export const RECENT_ANNOTATIONS_LIMIT = 200;

/**
 * The current user's annotated images across all projects (RLS-filtered),
 * newest annotation save first. An image counts as annotated once its
 * `annotation` column has been written, even if every box was later removed.
 * `modified_at` is bumped by `saveImageAnnotations`; rows saved before that
 * fall back to `created_at`.
 */
export async function fetchRecentlyAnnotatedImages(
  limit = RECENT_ANNOTATIONS_LIMIT,
): Promise<RecentAnnotationsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("images")
    .select(`${IMAGE_COLUMNS}, project_id, projects(name)`)
    .not("annotation", "is", null)
    .order("modified_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    // One extra row tells us whether the list was capped.
    .limit(limit + 1);

  if (error) {
    throw new Error(`Could not load recent annotations: ${error.message}`);
  }

  const rows = (data ?? []) as RecentImageRow[];
  const images = await Promise.all(
    rows.slice(0, limit).map(async (row) => {
      const { annotations, ...image } = await toProjectImage(row, row.project_id);
      const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
      return {
        ...image,
        projectId: row.project_id,
        projectName: project?.name ?? "Untitled project",
        annotationCount: annotations.length,
        lastAnnotatedAt: row.modified_at ?? row.created_at,
      };
    }),
  );

  return { images, limit, isCapped: rows.length > limit };
}

type ImageStatsRow = {
  project_id: string;
  /** First saved box only: enough to tell annotated from not, at a fraction of the bytes. */
  first_box: unknown;
  created_at: string;
  modified_at: string | null;
};

export type ImageStats = {
  total: number;
  annotated: number;
  unannotated: number;
  byProject: Record<
    string,
    {
      total: number;
      annotated: number;
      /** Latest upload or annotation save among the project's images (epoch ms). */
      lastActivityMs: number;
    }
  >;
};

/**
 * Image counts and latest image activity for every project the user owns
 * (RLS-filtered), paged past the PostgREST row cap.
 */
export async function fetchImageStats(): Promise<ImageStats> {
  const supabase = await createClient();
  const byProject: ImageStats["byProject"] = {};
  let total = 0;
  let annotated = 0;

  await forEachRowPage<ImageStatsRow>(
    supabase,
    "images",
    "project_id, first_box:annotation->0, created_at, modified_at",
    (rows) => {
      for (const row of rows) {
        const projectStats = byProject[row.project_id] ?? {
          total: 0,
          annotated: 0,
          lastActivityMs: 0,
        };
        projectStats.total += 1;
        total += 1;
        if (annotationStatus(row.first_box).status === "Annotated") {
          projectStats.annotated += 1;
          annotated += 1;
        }
        const activityMs = Math.max(
          Date.parse(row.created_at),
          row.modified_at ? Date.parse(row.modified_at) : 0,
        );
        if (activityMs > projectStats.lastActivityMs) {
          projectStats.lastActivityMs = activityMs;
        }
        byProject[row.project_id] = projectStats;
      }
    },
  );

  return { total, annotated, unannotated: total - annotated, byProject };
}

function parseAnnotations(annotation: unknown): BoundingBox[] {
  if (!Array.isArray(annotation)) return [];

  return annotation.filter((candidate): candidate is BoundingBox => {
    if (!candidate || typeof candidate !== "object") return false;
    const box = candidate as Record<string, unknown>;
    return (
      typeof box.id === "string" &&
      typeof box.labelId === "string" &&
      typeof box.x === "number" && Number.isFinite(box.x) &&
      typeof box.y === "number" && Number.isFinite(box.y) &&
      typeof box.width === "number" && Number.isFinite(box.width) &&
      typeof box.height === "number" && Number.isFinite(box.height)
    );
  });
}
