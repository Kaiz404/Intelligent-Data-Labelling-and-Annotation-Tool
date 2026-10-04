export const LABEL_COLOR_PALETTE = [
  "#2563eb",
  "#16a34a",
  "#ea580c",
  "#ca8a04",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#4f46e5",
];

export function pickLabelColor(index: number) {
  return LABEL_COLOR_PALETTE[index % LABEL_COLOR_PALETTE.length];
}

/**
 * The palette colour fewest existing labels use (earliest in the palette on
 * a tie), so deleting a label frees its colour instead of the next new
 * label repeating a neighbour's.
 */
export function pickLeastUsedLabelColor(usedColors: string[]) {
  const counts = new Map(LABEL_COLOR_PALETTE.map((color) => [color, 0]));
  for (const color of usedColors) {
    const key = color.toLowerCase();
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = LABEL_COLOR_PALETTE[0];
  for (const color of LABEL_COLOR_PALETTE) {
    if ((counts.get(color) ?? 0) < (counts.get(best) ?? 0)) best = color;
  }
  return best;
}
