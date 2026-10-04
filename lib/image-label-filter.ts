import type { BoundingBox } from "@/lib/types/annotations";

/*
 * The project page's Label filter. Its selection lives in `?labels=` as
 * comma-separated label ids, plus NO_LABELS for images without boxes. An image
 * matches when it contains ANY selected label; an empty selection matches all.
 */

/** Selection key (and `?labels=` token) for images without any boxes. */
export const NO_LABELS = "none";

type LabelledImage = { annotations: ReadonlyArray<Pick<BoundingBox, "labelId">> };

/**
 * The selection named by a `?labels=` value, in project label order with
 * NO_LABELS last. Ids that are not (or no longer) project labels are dropped.
 */
export function parseLabelFilter(
  value: string,
  labelIds: readonly string[],
): string[] {
  const requested = new Set(value.split(","));
  const selection = labelIds.filter((id) => requested.has(id));
  if (requested.has(NO_LABELS)) selection.push(NO_LABELS);
  return selection;
}

/** The `?labels=` value with `key` switched on or off. */
export function toggleLabelFilter(
  selection: readonly string[],
  key: string,
): string {
  const next = selection.includes(key)
    ? selection.filter((selected) => selected !== key)
    : [...selection, key];
  return next.join(",");
}

/** Images containing each label id (each image counted once), plus NO_LABELS. */
export function countImagesByLabel(
  images: readonly LabelledImage[],
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const image of images) {
    if (image.annotations.length === 0) {
      add(NO_LABELS);
      continue;
    }
    for (const labelId of new Set(image.annotations.map((box) => box.labelId))) {
      add(labelId);
    }
  }
  return counts;
}

export function matchesLabelFilter(
  image: LabelledImage,
  selection: ReadonlySet<string>,
): boolean {
  if (selection.size === 0) return true;
  if (image.annotations.length === 0) return selection.has(NO_LABELS);
  return image.annotations.some((box) => selection.has(box.labelId));
}
