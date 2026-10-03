import "server-only";

import {
  canonicalToBoundingBox,
  clampCanonicalToImage,
  fromCenterPixelBox,
} from "@/lib/annotations/formats";
import { detectImage } from "@/lib/roboflow/client";
import {
  createImageReadUrl,
  objectKeyBelongsToProject,
} from "@/lib/uploads/s3-server";
import type { AnnotationSuggestion } from "@/lib/types/annotations";

export type DetectionLabel = { id: string; name: string };

/**
 * Runs zero-shot detection on one stored image for the given project labels
 * and returns top-left pixel boxes tagged with label IDs and confidence.
 * Shared by the single-image route and the bulk job worker.
 */
export async function detectSuggestionsForImage(input: {
  /** The image's project; its object key must live under this project. */
  projectId: string;
  objectKey: string;
  labels: DetectionLabel[];
  confidence?: number;
}): Promise<AnnotationSuggestion[]> {
  const labelIdByName = new Map(
    input.labels.map((label) => [label.name.trim().toLowerCase(), label.id]),
  );

  if (!objectKeyBelongsToProject(input.objectKey, input.projectId)) {
    throw new Error("The image's stored file does not belong to its project.");
  }
  const imageUrl = await createImageReadUrl(input.objectKey);
  const result = await detectImage({
    imageUrl,
    classNames: input.labels.map((label) => label.name),
    confidence: input.confidence,
  });

  const suggestions: AnnotationSuggestion[] = [];
  for (const detection of result.detections) {
    const labelId = labelIdByName.get(detection.className.trim().toLowerCase());
    if (!labelId) {
      // Zero-shot model returned a class we didn't request/recognize — skip it.
      continue;
    }

    const canonical = clampCanonicalToImage(
      fromCenterPixelBox(detection),
      result.image,
    );
    suggestions.push({
      ...canonicalToBoundingBox(canonical, labelId),
      confidence: detection.confidence,
    });
  }

  return suggestions;
}
