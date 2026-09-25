"use server";

import { createClient } from "@/lib/supabase/server";
import type { AnnotationSuggestion } from "@/lib/types/annotations";

/**
 * Records the outcome of reviewing AI suggestions: `remaining` are the
 * suggestions still awaiting a decision on each job item (accepted and
 * rejected ones are dropped). An empty list clears the item from review.
 */
export async function resolveSuggestions(
  projectId: string,
  resolutions: Array<{ itemId: string; remaining: AnnotationSuggestion[] }>,
) {
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

  const results = await Promise.all(
    resolutions.map(({ itemId, remaining }) =>
      supabase
        .from("annotation_job_items")
        .update({ suggestions: remaining, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .eq("project_id", projectId),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }

  // No revalidatePath: this runs inside the workspace auto-save, and the
  // project page is dynamic, so it reads fresh review counts on navigation.
}
