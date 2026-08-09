import type { AnnotationDocument, BoundingBox } from "@/lib/types/annotations";

function storageKey(projectId: string, imageId: string) {
  return `annotations:${projectId}:${imageId}`;
}

export function loadAnnotations(
  projectId: string,
  imageId: string,
): BoundingBox[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = sessionStorage.getItem(storageKey(projectId, imageId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as AnnotationDocument;
    return Array.isArray(parsed.boxes) ? parsed.boxes : [];
  } catch {
    return [];
  }
}

export function saveAnnotations(
  projectId: string,
  imageId: string,
  boxes: BoundingBox[],
): void {
  if (typeof window === "undefined") {
    return;
  }

  const document: AnnotationDocument = {
    boxes,
    updatedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(storageKey(projectId, imageId), JSON.stringify(document));
}
