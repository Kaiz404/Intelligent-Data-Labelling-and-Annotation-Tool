export const numberFormatter = new Intl.NumberFormat("en-US");

/** `ProjectImage.capturedAt`; UTC, so server renders and client-built images agree. */
export const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function sumBy<T>(items: T[], selector: (item: T) => number) {
  return items.reduce((total, item) => total + selector(item), 0);
}

export function toPercent(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

export function relativeTimeFromDate(dateString: string) {
  const date = new Date(dateString);
  const hoursAgo = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60)),
  );

  if (hoursAgo < 24) {
    return `${hoursAgo} ${hoursAgo === 1 ? "hour" : "hours"} ago`;
  }

  const daysAgo = Math.round(hoursAgo / 24);
  return `${daysAgo} ${daysAgo === 1 ? "day" : "days"} ago`;
}

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const digits = value >= 10 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
});

const MINUTE = 60_000;
const relativeTimeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * MINUTE],
  ["month", 30 * 24 * 60 * MINUTE],
  ["week", 7 * 24 * 60 * MINUTE],
  ["day", 24 * 60 * MINUTE],
  ["hour", 60 * MINUTE],
  ["minute", MINUTE],
];

/**
 * "Just now", "5 minutes ago", "2 hours ago", "1 day ago", ... relative to
 * `now` (pass a server-anchored clock from `useNow` to avoid hydration drift).
 */
export function formatRelativeTime(isoTimestamp: string, now: number) {
  const elapsed = now - Date.parse(isoTimestamp);
  if (!Number.isFinite(elapsed)) return "Unknown";
  for (const [unit, size] of relativeTimeUnits) {
    if (elapsed >= size) {
      return relativeTimeFormat.format(-Math.floor(elapsed / size), unit);
    }
  }
  return "Just now";
}
