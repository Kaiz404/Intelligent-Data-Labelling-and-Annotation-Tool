import type { ImageAiState } from "@/lib/types/annotations";
import type { ProjectImage } from "@/lib/types/projects";

/*
 * Which images a bulk AI Annotate run covers. "unannotated" means no saved
 * boxes and no AI suggestions waiting for review, however the image got its
 * boxes (by hand, single-image AI, a copy, or a dataset import).
 */

export type BatchScope = "selected" | "unannotated" | "all";

/** Image ids per scope, each in grid order. */
export function resolveBatchScopes(
  images: ReadonlyArray<Pick<ProjectImage, "id" | "status">>,
  selectedImageIds: readonly string[],
  aiStates: Readonly<Record<string, ImageAiState>>,
): Record<BatchScope, string[]> {
  const selected = new Set(selectedImageIds);
  const ids = (keep: (image: Pick<ProjectImage, "id" | "status">) => boolean) =>
    images.filter(keep).map((image) => image.id);

  return {
    selected: ids((image) => selected.has(image.id)),
    unannotated: ids(
      (image) =>
        image.status === "Unannotated" &&
        (aiStates[image.id]?.pendingSuggestions ?? 0) === 0,
    ),
    all: ids(() => true),
  };
}

/** The first scope with any images: selected, then unannotated, else all. */
export function defaultBatchScope(
  scopes: Record<BatchScope, readonly string[]>,
): BatchScope {
  if (scopes.selected.length > 0) return "selected";
  if (scopes.unannotated.length > 0) return "unannotated";
  return "all";
}
