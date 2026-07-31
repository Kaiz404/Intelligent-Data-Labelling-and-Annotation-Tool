"use client";

import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SortDirection = "ascending" | "descending";

export function reverseSortDirection(direction: SortDirection): SortDirection {
  return direction === "ascending" ? "descending" : "ascending";
}

type SortOrderButtonProps = {
  direction: SortDirection;
  onToggle: () => void;
  label: string;
};

export function SortOrderButton({
  direction,
  onToggle,
  label,
}: SortOrderButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onToggle}
      aria-label={`Toggle ${label}`}
    >
      <ArrowUpDown
        className={direction === "descending" ? "rotate-180" : ""}
      />
    </Button>
  );
}
