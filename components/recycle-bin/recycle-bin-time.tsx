"use client";

import { useSyncExternalStore } from "react";
import { formatRelativeTime } from "@/lib/format";

const DAY = 24 * 60 * 60 * 1000;

/** Whole days until purge, rounded up (an item expiring in 2 hours has 1 day left). */
export function daysLeft(expiresAt: string, now: number) {
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / DAY)) : 0;
}

export function daysLeftLabel(expiresAt: string, now: number) {
  const days = daysLeft(expiresAt, now);
  if (days === 0) return "Expires today";
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

/** "Deleted 2 hours ago", "Deleted just now". */
export function deletedLabel(deletedAt: string, now: number) {
  const relative = formatRelativeTime(deletedAt, now);
  return `Deleted ${relative === "Just now" ? "just now" : relative}`;
}

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};
const localFormatter = new Intl.DateTimeFormat("en-US", dateTimeOptions);
const utcFormatter = new Intl.DateTimeFormat("en-US", {
  ...dateTimeOptions,
  timeZone: "UTC",
  timeZoneName: "short",
});

function format(formatter: Intl.DateTimeFormat, iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatter.format(date);
}

const subscribeNever = () => () => {};

/**
 * "Oct 8, 2026, 10:45 AM" in the viewer's time zone. The server render (and
 * hydration) use UTC, then the client swaps in local time without a
 * hydration mismatch.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribeNever,
    () => format(localFormatter, iso),
    () => format(utcFormatter, iso),
  );
  return <time dateTime={iso}>{text}</time>;
}
