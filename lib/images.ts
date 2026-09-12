import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createImageReadUrl } from "@/lib/uploads/s3-server";
import type { BoundingBox } from "@/lib/types/annotations";
import type { ImageStatus, ProjectImage } from "@/lib/types/projects";

type ImageRow = {
  id: string;
  name: string;
  object_key: string;
  size_bytes: number;
  created_at: string;
  annotation: unknown;
};

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

export async function fetchProjectImages(
  projectId: string,
): Promise<ProjectImage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("images")
    .select("id, name, object_key, size_bytes, created_at, annotation")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load project images: ${error.message}`);
  }

  return Promise.all(
    ((data ?? []) as ImageRow[]).map(async (row) => {
      const signedUrl = await createImageReadUrl(row.object_key);
      const { status, progress } = annotationStatus(row.annotation);

      return {
        id: row.id,
        fileName: row.name,
        sizeBytes: row.size_bytes,
        capturedAt: dateFormatter.format(new Date(row.created_at)),
        status,
        progress,
        thumbnailUrl: signedUrl,
        imageUrl: signedUrl,
        annotations: parseAnnotations(row.annotation),
      };
    }),
  );
}
type ImageStatsRow = {
  project_id: string;
  annotation: unknown;
};

export type ImageStats = {
  total: number;
  annotated: number;
  unannotated: number;
  byProject: Record<string, { total: number; annotated: number }>;
};

export async function fetchImageStats(
  projectIds?: string[],
): Promise<ImageStats> {
  if (projectIds?.length === 0) {
    return { total: 0, annotated: 0, unannotated: 0, byProject: {} };
  }

  const supabase = await createClient();
  let query = supabase.from("images").select("project_id, annotation");
  if (projectIds) {
    query = query.in("project_id", projectIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load image statistics: ${error.message}`);
  }

  const byProject: ImageStats["byProject"] = {};
  let annotated = 0;

  for (const row of (data ?? []) as ImageStatsRow[]) {
    const projectStats = byProject[row.project_id] ?? {
      total: 0,
      annotated: 0,
    };
    projectStats.total += 1;
    if (annotationStatus(row.annotation).status === "Annotated") {
      projectStats.annotated += 1;
      annotated += 1;
    }
    byProject[row.project_id] = projectStats;
  }

  const total = data?.length ?? 0;
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
