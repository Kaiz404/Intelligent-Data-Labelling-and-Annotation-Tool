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
