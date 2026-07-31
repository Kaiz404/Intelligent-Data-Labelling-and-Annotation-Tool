export const numberFormatter = new Intl.NumberFormat("en-US");

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

export function formatFileSize(sizeMb: number) {
  return `${sizeMb.toFixed(sizeMb % 1 === 0 ? 0 : 1)} MB`;
}
