import "server-only";

import {
  detectSuggestionsForImage,
  type DetectionLabel,
} from "@/lib/annotations/auto-label";
import { MAX_JOB_IMAGES } from "@/lib/annotations/job-config";
import { RoboflowError } from "@/lib/roboflow/config";
import { createClient } from "@/lib/supabase/server";
import { UploadApiError } from "@/lib/uploads/s3-server";
import type {
  AnnotationJobItemStatus,
  AnnotationJobProgress,
  AnnotationJobStatus,
  AnnotationSuggestion,
  ImageAiState,
  ImageSuggestionSet,
} from "@/lib/types/annotations";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Parallel Roboflow requests per worker drain. */
const WORKER_CONCURRENCY = 4;
/** Stop claiming new work this long after a drain starts (route maxDuration is 300s). */
const DRAIN_BUDGET_MS = 240_000;
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 3;

export class AnnotationJobError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function annotationJobErrorResponse(error: unknown) {
  if (error instanceof AnnotationJobError || error instanceof UploadApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  console.error("AI annotation job API error", error);
  return Response.json({ error: "AI annotation request failed." }, { status: 500 });
}

/** Resolves the signed-in user's Supabase client, or throws 401. */
export async function requireSignedIn(): Promise<Supabase> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AnnotationJobError("You must be signed in.", 401);
  }
  return supabase;
}

type JobRow = {
  id: string;
  project_id: string;
  status: AnnotationJobStatus;
  labels: DetectionLabel[];
  confidence: number;
  total_items: number;
  created_at: string;
  finished_at: string | null;
};

type ClaimedItem = {
  id: string;
  job_id: string;
  image_id: string;
  attempts: number;
};

const JOB_COLUMNS =
  "id, project_id, status, labels, confidence, total_items, created_at, finished_at";

export async function createAnnotationJob(
  supabase: Supabase,
  input: {
    projectId: string;
    imageIds: string[];
    labelIds: string[];
    confidence: number;
  },
): Promise<string> {
  const imageIds = Array.from(new Set(input.imageIds));
  if (imageIds.length === 0) {
    throw new AnnotationJobError("Choose at least one image.", 400);
  }
  if (imageIds.length > MAX_JOB_IMAGES) {
    throw new AnnotationJobError(
      `A single AI run can include at most ${MAX_JOB_IMAGES} images.`,
      400,
    );
  }

  const [{ data: labels, error: labelsError }, { data: images, error: imagesError }] =
    await Promise.all([
      supabase
        .from("project_labels")
        .select("id, name")
        .eq("project_id", input.projectId)
        .in("id", input.labelIds),
      supabase
        .from("images")
        .select("id, created_at")
        .eq("project_id", input.projectId)
        .in("id", imageIds)
        .order("created_at", { ascending: true }),
    ]);

  if (labelsError || imagesError) {
    throw new AnnotationJobError("Could not load the project data.", 500);
  }
  if (!labels || labels.length === 0) {
    throw new AnnotationJobError(
      "None of the selected labels belong to this project.",
      400,
    );
  }
  if (!images || images.length === 0) {
    throw new AnnotationJobError("None of the images belong to this project.", 400);
  }

  const { data: job, error: jobError } = await supabase
    .from("annotation_jobs")
    .insert({
      project_id: input.projectId,
      labels,
      confidence: input.confidence,
      total_items: images.length,
    })
    .select("id")
    .single();

  if (jobError) {
    throw new AnnotationJobError(
      jobError.code === "23505"
        ? "An AI run is already in progress for this project."
        : "Could not create the AI run.",
      jobError.code === "23505" ? 409 : 500,
    );
  }

  const { error: itemsError } = await supabase.from("annotation_job_items").insert(
    images.map((image, position) => ({
      job_id: job.id,
      project_id: input.projectId,
      image_id: image.id,
      position,
    })),
  );

  if (itemsError) {
    await supabase.from("annotation_jobs").delete().eq("id", job.id);
    throw new AnnotationJobError("Could not queue the images.", 500);
  }

  return job.id as string;
}

export async function cancelAnnotationJob(supabase: Supabase, jobId: string) {
  const { data: job, error } = await supabase
    .from("annotation_jobs")
    .update({
      status: "cancelled",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["queued", "running"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new AnnotationJobError("Could not cancel the AI run.", 500);
  }
  if (!job) {
    return;
  }

  await supabase
    .from("annotation_job_items")
    .update({ status: "cancelled", locked_until: null, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("status", "queued");
}

/** Job progress plus per-image updates since `since` (ISO timestamp). */
export async function getAnnotationJobProgress(
  supabase: Supabase,
  jobId: string,
  since: string | null,
): Promise<{
  job: AnnotationJobProgress;
  updates: Array<{ imageId: string } & ImageAiState>;
  hasLiveWorker: boolean;
  projectId: string;
}> {
  const { data: job, error } = await supabase
    .from("annotation_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new AnnotationJobError("Could not load the AI run.", 500);
  }
  if (!job) {
    throw new AnnotationJobError("AI run not found.", 404);
  }

  let updatesQuery = supabase
    .from("annotation_job_items")
    .select("image_id, status, suggestion_count")
    .eq("job_id", jobId);
  if (since) {
    updatesQuery = updatesQuery.gt("updated_at", since);
  }

  const [counts, updates, live] = await Promise.all([
    supabase.rpc("annotation_job_counts", { p_job_id: jobId }),
    updatesQuery,
    supabase
      .from("annotation_job_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", "running")
      .gt("locked_until", new Date().toISOString()),
  ]);

  if (counts.error || updates.error || live.error) {
    throw new AnnotationJobError("Could not load AI run progress.", 500);
  }

  return {
    job: toProgress(job as JobRow, counts.data ?? []),
    updates: (updates.data ?? []).map((row) => ({
      imageId: row.image_id as string,
      status: row.status as AnnotationJobItemStatus,
      pendingSuggestions: row.suggestion_count as number,
    })),
    hasLiveWorker: (live.count ?? 0) > 0,
    projectId: job.project_id as string,
  };
}

function toProgress(
  job: JobRow,
  rows: Array<{ status: string; items: number; suggestions: number }>,
): AnnotationJobProgress {
  const counts: AnnotationJobProgress["counts"] = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  let pendingSuggestions = 0;
  for (const row of rows) {
    counts[row.status as AnnotationJobItemStatus] = row.items;
    pendingSuggestions += row.suggestions;
  }

  return {
    id: job.id,
    status: job.status,
    total: job.total_items,
    counts,
    pendingSuggestions,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
  };
}

/**
 * Processes queued items of one project's active job until the queue is empty
 * or the time budget runs out. Safe to run concurrently: items are leased
 * with FOR UPDATE SKIP LOCKED, and an expired lease is re-claimed later.
 */
export async function drainProjectQueue(supabase: Supabase, projectId: string) {
  const deadline = Date.now() + DRAIN_BUDGET_MS;
  const jobs = new Map<string, Promise<JobRow | null>>();

  const loadJob = (jobId: string) => {
    let job = jobs.get(jobId);
    if (!job) {
      job = Promise.resolve(
        supabase.from("annotation_jobs").select(JOB_COLUMNS).eq("id", jobId).maybeSingle(),
      ).then(({ data }) => (data as JobRow | null) ?? null);
      jobs.set(jobId, job);
    }
    return job;
  };

  const lane = async () => {
    while (Date.now() < deadline) {
      const { data, error } = await supabase.rpc("claim_annotation_job_items", {
        p_project_id: projectId,
        p_limit: 1,
        p_lock_seconds: LEASE_SECONDS,
      });
      const item = (data as ClaimedItem[] | null)?.[0];
      if (error || !item) {
        return;
      }
      await processItem(supabase, projectId, item, await loadJob(item.job_id));
    }
  };

  await supabase
    .from("annotation_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("status", "queued");

  await Promise.all(Array.from({ length: WORKER_CONCURRENCY }, lane));
  await supabase.rpc("finalize_annotation_jobs", { p_project_id: projectId });
}

async function processItem(
  supabase: Supabase,
  projectId: string,
  item: ClaimedItem,
  job: JobRow | null,
) {
  const now = () => new Date().toISOString();

  try {
    if (!job) {
      throw new AnnotationJobError("AI run no longer exists.", 404);
    }

    const { data: image } = await supabase
      .from("images")
      .select("object_key")
      .eq("id", item.image_id)
      .maybeSingle();
    if (!image) {
      throw new AnnotationJobError("Image no longer exists.", 404);
    }

    const suggestions = await detectSuggestionsForImage({
      objectKey: image.object_key as string,
      labels: job.labels,
      confidence: job.confidence,
    });

    // A newer run supersedes older unreviewed suggestions for the same image.
    await supabase
      .from("annotation_job_items")
      .update({ suggestions: [], updated_at: now() })
      .eq("project_id", projectId)
      .eq("image_id", item.image_id)
      .neq("id", item.id)
      .gt("suggestion_count", 0);

    await supabase
      .from("annotation_job_items")
      .update({
        status: "succeeded",
        suggestions,
        error: null,
        locked_until: null,
        completed_at: now(),
        updated_at: now(),
      })
      .eq("id", item.id);
  } catch (error) {
    const retryable =
      error instanceof RoboflowError ? error.retryable : !(error instanceof AnnotationJobError);
    const message =
      error instanceof RoboflowError || error instanceof AnnotationJobError
        ? error.message
        : "AI annotation failed.";

    if (!(error instanceof RoboflowError || error instanceof AnnotationJobError)) {
      console.error("AI annotation job item failed", error);
    }

    const retry = retryable && item.attempts < MAX_ATTEMPTS;
    await supabase
      .from("annotation_job_items")
      .update({
        status: retry ? "queued" : "failed",
        error: message,
        // Back off before the next attempt (5s, 10s, ...).
        locked_until: retry
          ? new Date(Date.now() + item.attempts * 5_000).toISOString()
          : null,
        completed_at: retry ? null : now(),
        updated_at: now(),
      })
      .eq("id", item.id);
  }
}

// ---------------------------------------------------------------------------
// Page queries
// ---------------------------------------------------------------------------

/** Most recent AI run for a project (active or finished), if any. */
export async function fetchLatestAnnotationJob(
  projectId: string,
): Promise<AnnotationJobProgress | null> {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("annotation_jobs")
    .select(JOB_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load AI runs: ${error.message}`);
  }
  if (!job) {
    return null;
  }

  const { data: counts, error: countsError } = await supabase.rpc(
    "annotation_job_counts",
    { p_job_id: job.id },
  );
  if (countsError) {
    throw new Error(`Could not load AI run progress: ${countsError.message}`);
  }

  return toProgress(job as JobRow, counts ?? []);
}

export async function fetchImageAiStates(
  projectId: string,
): Promise<Record<string, ImageAiState>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("annotation_image_states", {
    p_project_id: projectId,
  });

  if (error) {
    throw new Error(`Could not load AI annotation states: ${error.message}`);
  }

  const states: Record<string, ImageAiState> = {};
  for (const row of (data ?? []) as Array<{
    image_id: string;
    status: AnnotationJobItemStatus;
    pending_suggestions: number;
  }>) {
    states[row.image_id] = {
      status: row.status,
      pendingSuggestions: row.pending_suggestions,
    };
  }
  return states;
}

/** Unreviewed AI suggestions for one image, grouped by job item. */
export async function fetchPendingSuggestions(
  projectId: string,
  imageId: string,
): Promise<ImageSuggestionSet[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("annotation_job_items")
    .select("id, suggestions")
    .eq("project_id", projectId)
    .eq("image_id", imageId)
    .gt("suggestion_count", 0);

  if (error) {
    throw new Error(`Could not load AI suggestions: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    itemId: row.id as string,
    suggestions: row.suggestions as AnnotationSuggestion[],
  }));
}

/** IDs of images in a project that still have AI suggestions to review. */
export async function fetchImagesAwaitingReview(projectId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("annotation_job_items")
    .select("image_id")
    .eq("project_id", projectId)
    .gt("suggestion_count", 0);

  if (error) {
    throw new Error(`Could not load AI review queue: ${error.message}`);
  }

  return Array.from(new Set((data ?? []).map((row) => row.image_id as string)));
}
