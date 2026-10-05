import { MAX_IMPORT_BOXES_PER_IMAGE, normalizeDatasetPath } from "@/lib/annotations/coco-import";
import { fromYolo } from "@/lib/annotations/formats";
import type { DatasetBox, DatasetCategory, DatasetImportPlan } from "@/lib/types/dataset-import";

/**
 * Six-decimal rounding changes a centre by <= 0.5e-6 and half a size by
 * <= 0.25e-6. Only corners outside the image by this amount may be snapped.
 * The extra 1e-12 accounts for floating-point arithmetic, not invalid geometry.
 */
export const YOLO_BOUNDARY_TOLERANCE = 0.00000075 + 1e-12;

function lines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
}

/** Line positions are class IDs: never filter blank entries and shift IDs. */
export function parseYoloClasses(text: string, filename = "classes.txt"): DatasetCategory[] {
  const names = lines(text);
  // A single terminating newline is not an additional class.
  if (names.length > 1 && names[names.length - 1] === "") names.pop();
  return names.map((value, index) => {
    const name = value.trim();
    if (!name) throw new Error(`${filename}:${index + 1}: class names must be non-empty (blank class entries cannot be skipped).`);
    return { id: String(index), name };
  });
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseYoloAnnotations(
  text: string,
  categories: DatasetCategory[],
  image: { width: number; height: number },
  filename: string,
): DatasetBox[] {
  if (![image.width, image.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error(`${filename}: image dimensions must be positive safe integers.`);
  }
  const categoryIds = new Set(categories.map((category) => category.id));
  const boxes: DatasetBox[] = [];
  for (const [index, row] of lines(text).entries()) {
    if (!row.trim()) continue;
    const context = `${filename}:${index + 1}`;
    const fields = row.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new Error(`${context}: expected exactly five fields: class_id x_center y_center width height. Only detection boxes are supported.`);
    }
    const classId = Number(fields[0]);
    if (!/^\d+$/.test(fields[0]) || !Number.isSafeInteger(classId) || classId < 0) {
      throw new Error(`${context}: class ID must be a nonnegative safe integer.`);
    }
    const categoryId = String(classId);
    if (!categoryIds.has(categoryId)) throw new Error(`${context}: class ID ${classId} is not declared in classes.txt.`);
    const coordinates = fields.slice(1).map(Number);
    if (fields.slice(1).some((field) => !decimal.test(field)) || coordinates.some((value) => !Number.isFinite(value))) {
      throw new Error(`${context}: coordinates must be finite decimal numbers.`);
    }
    const [xCenter, yCenter, width, height] = coordinates;
    if (width <= 0 || height <= 0) throw new Error(`${context}: width and height must be positive.`);
    if (coordinates.some((value) => value < 0 || value > 1)) {
      throw new Error(`${context}: coordinates must be normalized between 0 and 1.`);
    }
    const normalized = fromYolo({ xCenter, yCenter, width, height }, { width: 1, height: 1 });
    if (normalized.xMin < -YOLO_BOUNDARY_TOLERANCE || normalized.yMin < -YOLO_BOUNDARY_TOLERANCE ||
        normalized.xMax > 1 + YOLO_BOUNDARY_TOLERANCE || normalized.yMax > 1 + YOLO_BOUNDARY_TOLERANCE) {
      throw new Error(`${context}: bounding box exceeds image bounds (beyond six-decimal rounding tolerance).`);
    }
    const xMin = Math.max(0, normalized.xMin), yMin = Math.max(0, normalized.yMin);
    const xMax = Math.min(1, normalized.xMax), yMax = Math.min(1, normalized.yMax);
    if (xMax <= xMin || yMax <= yMin) throw new Error(`${context}: bounding box has no area inside the image.`);
    if (boxes.length >= MAX_IMPORT_BOXES_PER_IMAGE) throw new Error(`${context}: image exceeds the 50,000-box limit.`);
    boxes.push({
      id: `${filename}:${index + 1}`, categoryId,
      x: xMin * image.width, y: yMin * image.height,
      // Preserve the specified size unless a tiny out-of-bounds corner was snapped.
      width: (xMin !== normalized.xMin || xMax !== normalized.xMax ? xMax - xMin : width) * image.width,
      height: (yMin !== normalized.yMin || yMax !== normalized.yMax ? yMax - yMin : height) * image.height,
    });
  }
  return boxes;
}

export type YoloDatasetImageInput = {
  path: string;
  width: number;
  height: number;
  /** Missing labels are negative images, distinct from explicit empty files. */
  annotation?: { path: string; text: string };
};

/** Pure parser; image dimensions are supplied by the archive's image decoder. */
export function parseYoloDataset(
  classesText: string,
  images: YoloDatasetImageInput[],
  classesPath = "classes.txt",
): DatasetImportPlan {
  const categories = parseYoloClasses(classesText, classesPath);
  const paths = new Set<string>();
  return {
    categories,
    images: images.map((image) => {
      const path = normalizeDatasetPath(image.path);
      if (paths.has(path)) throw new Error(`Duplicate YOLO image path: ${path}`);
      paths.add(path);
      if (!/\.(jpe?g|png)$/i.test(path)) throw new Error(`${path}: only JPEG and PNG images are supported.`);
      if (![image.width, image.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
        throw new Error(`${path}: image dimensions must be positive safe integers.`);
      }
      return {
        id: path, path, width: image.width, height: image.height,
        boxes: image.annotation ? parseYoloAnnotations(image.annotation.text, categories, image, image.annotation.path) : [],
      };
    }),
  };
}
