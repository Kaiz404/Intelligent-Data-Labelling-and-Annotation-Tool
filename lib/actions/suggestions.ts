"use server";

import { createClient } from "@/lib/supabase/server";
import type { AnnotationSuggestion } from "@/lib/types/annotations";

type SuggestionResolution = { itemId: string; remaining: AnnotationSuggestion[] };

type JobItemRow = { id: string; suggestions: unknown; updated_at: string };

/** Re-reads after a concurrent write before giving up on an item. */
const MAX_WRITE_ATTEMPTS = 2;

function validateResolutions(value: unknown): SuggestionResolution[] {
  if (!Array.isArray(value)) {
    throw new Error("Suggestion resolutions must be a list.");
  }
  return value.map((candidate) => {
    const resolution = candidate as Record<string, unknown> | null;
    if (
      !resolution ||
      typeof resolution.itemId !== "string" ||
      !resolution.itemId ||
      !Array.isArray(resolution.remaining)
    ) {
      throw new Error("A suggestion resolution is invalid.");
    }
    const remaining = resolution.remaining.map((item) => {
      const box = item as Record<string, unknown> | null;
      const numbers = [box?.x, box?.y, box?.width, box?.height, box?.confidence];
      if (
        !box ||
        typeof box.id !== "string" ||
        !box.id ||
        typeof box.labelId !== "string" ||
        !box.labelId ||
        numbers.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
        (box.width as number) <= 0 ||
        (box.height as number) <= 0
      ) {
        throw new Error("A suggestion contains invalid bounding-box values.");
      }
      return {
        id: box.id,
        labelId: box.labelId,
        x: box.x as number,
        y: box.y as number,
        width: box.width as number,
        height: box.height as number,
        confidence: box.confidence as number,
      };
    });
    return { itemId: resolution.itemId, remaining };
  });
}

function pendingIds(suggestions: unknown) {
  const ids = new Set<string>();
  if (!Array.isArray(suggestions)) return ids;
  for (const suggestion of suggestions) {
    const id = (suggestion as { id?: unknown } | null)?.id;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * The client's `remaining` list narrowed to suggestions the server still has
 * pending, so a stale client can only shrink the list, never restore boxes a
 * newer run (or another tab) already cleared. Client geometry wins for the
 * IDs that survive. Returns null when there is nothing to write.
 */
function nextSuggestions(current: unknown, remaining: AnnotationSuggestion[]) {
  const pending = pendingIds(current);
  if (pending.size === 0) return null; // Already cleared: leave it cleared.

  const seen = new Set<string>();
  const next = remaining.filter((suggestion) => {
    if (!pending.has(suggestion.id) || seen.has(suggestion.id)) return false;
    seen.add(suggestion.id);
    return true;
  });
  return sameSuggestions(current, next) ? null : next;
}

/** Field-wise comparison; jsonb does not preserve key order, so JSON text can't be compared. */
function sameSuggestions(current: unknown, next: AnnotationSuggestion[]) {
  if (!Array.isArray(current) || current.length !== next.length) return false;
  const fields = ["id", "labelId", "x", "y", "width", "height", "confidence"] as const;
  return next.every((suggestion, index) => {
    const stored = current[index] as Record<string, unknown> | null;
    return !!stored && fields.every((field) => stored[field] === suggestion[field]);
  });
}

/**
 * Records the outcome of reviewing AI suggestions: `remaining` are the
 * suggestions still awaiting a decision on each job item (accepted and
 * rejected ones are dropped). An empty list clears the item from review.
 * Each write is a compare-and-swap on `updated_at`, so a worker clearing the
 * item between our read and write is never overwritten.
 */
export async function resolveSuggestions(
  projectId: string,
  resolutionsInput: SuggestionResolution[],
) {
  if (!projectId) {
    throw new Error("Project is required.");
  }
  const resolutions = validateResolutions(resolutionsInput);
  if (resolutions.length === 0) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in to review AI suggestions.");
  }

  async function loadItem(itemId: string) {
    const { data, error } = await supabase
      .from("annotation_job_items")
      .select("id, suggestions, updated_at")
      .eq("id", itemId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) throw new Error(`Could not load AI suggestions: ${error.message}`);
    return data as JobItemRow | null;
  }

  async function resolveItem({ itemId, remaining }: SuggestionResolution) {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const item = await loadItem(itemId);
      if (!item) return; // Item (or its image) was deleted.

      const next = nextSuggestions(item.suggestions, remaining);
      if (!next) return;

      const { data: updated, error } = await supabase
        .from("annotation_job_items")
        .update({ suggestions: next, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .eq("project_id", projectId)
        .eq("updated_at", item.updated_at)
        .select("id");
      if (error) throw new Error(`Could not save AI review: ${error.message}`);
      if ((updated ?? []).length > 0) return;
      // Changed since we read it: re-read and narrow against the newer state.
    }
    // Still contended: the newer server state stands; the next auto-save retries.
  }

  await Promise.all(resolutions.map(resolveItem));

  // No revalidatePath: this runs inside the workspace auto-save, and the
  // project page is dynamic, so it reads fresh review counts on navigation.
}
