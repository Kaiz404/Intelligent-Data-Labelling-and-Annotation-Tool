import { isUuid } from "@/lib/ids";

export function isAnnotatePath(pathname: string): boolean {
  return pathname.includes("/annotate/");
}

/** Open image id from `/projects/{projectId}/annotate/{imageId}` (not from `.pop()`). */
export function annotateImageIdFromPath(pathname: string): string | null {
  const segments = pathname.split("/");
  const annotateIndex = segments.indexOf("annotate");
  if (annotateIndex < 0) return null;
  const imageId = segments[annotateIndex + 1];
  return isUuid(imageId) ? imageId : null;
}

export function annotateImageIdFromParams(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const raw = params.imageId;
  const imageId = typeof raw === "string" ? raw : raw?.[0];
  return imageId && isUuid(imageId) ? imageId : null;
}
