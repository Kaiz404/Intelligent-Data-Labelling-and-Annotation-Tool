import type { DatasetImportPlan, DatasetImage } from "@/lib/types/dataset-import";

// Must match the persistence limit in lib/actions/annotations.ts.
export const MAX_IMPORT_BOXES_PER_IMAGE = 50_000;

/** Reject traversal rather than silently changing the referenced file. */
export function normalizeDatasetPath(value: unknown): string {
  if (typeof value !== "string" || !value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("Dataset paths must be non-empty relative file paths.");
  }
  const path = value.replace(/\\/g, "/");
  if (path.startsWith("/") || path.includes(":") || path.endsWith("/")) {
    throw new Error(`Unsafe dataset path: ${value}`);
  }
  const parts = path.split("/");
  if (parts.includes("..")) throw new Error(`Unsafe dataset path: ${value}`);
  const normalized = parts.filter((part) => part !== "" && part !== ".").join("/");
  if (!normalized.trim()) throw new Error("Dataset paths must name a file.");
  return normalized;
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, context: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a nonnegative safe integer.`);
  }
  return String(value);
}

function uniqueId(value: unknown, seen: Set<string>, context: string): string {
  const key = id(value, context);
  if (seen.has(key)) throw new Error(`Duplicate ${context}: ${key}`);
  seen.add(key);
  return key;
}

function dimension(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer.`);
  }
  return value;
}

/** Accept parsed JSON or JSON text; no files, network, or persistence involved. */
export function parseCocoDataset(input: unknown): DatasetImportPlan {
  if (typeof input === "string") {
    try { input = JSON.parse(input); }
    catch { throw new Error("COCO annotation document is not valid JSON."); }
  }
  const document = record(input, "COCO document");
  for (const key of ["images", "categories", "annotations"]) {
    if (!Array.isArray(document[key])) throw new Error(`COCO ${key} must be an array.`);
  }
  const categoryIds = new Set<string>();
  const categories = (document.categories as unknown[]).map((value) => {
    const category = record(value, "COCO category");
    const categoryId = uniqueId(category.id, categoryIds, "category ID");
    if (typeof category.name !== "string" || !category.name.trim()) {
      throw new Error(`Category ${categoryId} must have a non-empty name.`);
    }
    return { id: categoryId, name: category.name.trim() };
  });
  const imageIds = new Set<string>();
  const images: DatasetImage[] = (document.images as unknown[]).map((value) => {
    const image = record(value, "COCO image");
    const imageId = uniqueId(image.id, imageIds, "image ID");
    const path = normalizeDatasetPath(image.file_name);
    if (!/\.(jpe?g|png)$/i.test(path)) {
      throw new Error(`Image ${imageId}: only JPEG and PNG files are supported (${path}).`);
    }
    return {
      id: imageId, path,
      width: dimension(image.width, `Image ${imageId} width`),
      height: dimension(image.height, `Image ${imageId} height`),
      boxes: [],
    };
  });
  const byId = new Map(images.map((image) => [image.id, image]));
  const annotationIds = new Set<string>();
  for (const value of document.annotations as unknown[]) {
    const annotation = record(value, "COCO annotation");
    const annotationId = uniqueId(annotation.id, annotationIds, "annotation ID");
    const context = `Annotation ${annotationId}`;
    const image = byId.get(id(annotation.image_id, `${context} image_id`));
    const categoryId = id(annotation.category_id, `${context} category_id`);
    if (!image) throw new Error(`${context} references an unknown image.`);
    if (!categoryIds.has(categoryId)) throw new Error(`${context} references an unknown category.`);
    if (annotation.iscrowd !== undefined && annotation.iscrowd !== 0) {
      throw new Error(`${context}: crowd annotations are unsupported; iscrowd must be 0.`);
    }
    for (const field of ["segmentation", "keypoints"]) {
      const data = annotation[field];
      if (data !== undefined && data !== null && !(Array.isArray(data) && data.length === 0)) {
        throw new Error(`${context}: populated ${field} data is unsupported.`);
      }
    }
    if (annotation.num_keypoints !== undefined && annotation.num_keypoints !== 0) {
      throw new Error(`${context}: keypoint annotations are unsupported.`);
    }
    const bbox = annotation.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4 ||
        bbox.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`${context}: bbox must contain four finite numbers.`);
    }
    const [x, y, width, height] = bbox as number[];
    if (x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new Error(`${context}: bbox needs nonnegative x/y and positive width/height.`);
    }
    if (x + width > image.width || y + height > image.height) {
      throw new Error(`${context}: bbox exceeds image ${image.id} dimensions.`);
    }
    if (image.boxes.length >= MAX_IMPORT_BOXES_PER_IMAGE) {
      throw new Error(`Image ${image.id} exceeds the 50,000-box limit.`);
    }
    image.boxes.push({ id: annotationId, categoryId, x, y, width, height });
  }
  return { categories, images };
}
