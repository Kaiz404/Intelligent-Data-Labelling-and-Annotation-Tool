import type { AnnotationDocument, BoundingBox } from "@/lib/types/annotations";

function storageKey(projectId: string, imageId: string) {
  return `annotations:${projectId}:${imageId}`;
}

function readDraft(projectId: string, imageId: string): AnnotationDocument | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(storageKey(projectId, imageId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as AnnotationDocument;
    return Array.isArray(parsed.boxes) ? parsed : null;
  } catch {
    return null;
  }
}

/** This tab's latest boxes for an image (saved or not), else `databaseFallback`. */
export function loadAnnotations(
  projectId: string,
  imageId: string,
  databaseFallback: BoundingBox[] = [],
): BoundingBox[] {
  return readDraft(projectId, imageId)?.boxes ?? databaseFallback;
}

/**
 * Boxes this tab edited but never saved (e.g. the tab reloaded mid-save), or
 * null. A draft that was saved is ignored, so reopening an image shows the
 * server copy, which another tab or device may have changed since.
 */
export function loadUnsavedDraft(
  projectId: string,
  imageId: string,
): BoundingBox[] | null {
  const draft = readDraft(projectId, imageId);
  return draft?.unsaved ? draft.boxes : null;
}

export function saveAnnotations(
  projectId: string,
  imageId: string,
  boxes: BoundingBox[],
  { unsaved }: { unsaved: boolean },
): void {
  if (typeof window === "undefined") {
    return;
  }

  const document: AnnotationDocument = {
    boxes,
    updatedAt: new Date().toISOString(),
    unsaved,
  };
  try {
    sessionStorage.setItem(storageKey(projectId, imageId), JSON.stringify(document));
  } catch {
    // Storage full or disabled: the backup is best-effort.
  }
}
