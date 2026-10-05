import {
  boundingBoxToCanonical,
  formatYoloLine,
  toCoco,
  toVocObject,
  toYolo,
} from "@/lib/annotations/formats";
import type { AnnotationLabel, BoundingBox } from "@/lib/types/annotations";

export type DatasetExportImage = {
  id: string;
  fileName: string;
  width: number;
  height: number;
  boxes: BoundingBox[];
};

type NamedDatasetExportImage<T extends DatasetExportImage = DatasetExportImage> = T & {
  exportFileName: string;
};

function safeStem(value: string): string {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
}

function imageExtension(value: string): string {
  const match = value.match(/\.(jpe?g|png)$/i);
  return match ? match[0].toLowerCase() : ".jpg";
}

/**
 * Assign archive-safe names with unique stems. Label files are keyed by stem,
 * so `cat.jpg` and `cat.png` must not both become `cat.txt` / `cat.xml`.
 */
export function nameExportImages<T extends DatasetExportImage>(
  images: T[],
): NamedDatasetExportImage<T>[] {
  const used = new Set<string>();
  return images.map((image) => {
    const base = safeStem(image.fileName);
    let stem = base;
    let suffix = 2;
    while (used.has(stem.toLowerCase())) stem = `${base}-${suffix++}`;
    used.add(stem.toLowerCase());
    return { ...image, exportFileName: `${stem}${imageExtension(image.fileName)}` };
  });
}

function labelIndex(labels: AnnotationLabel[]): Map<string, number> {
  const result = new Map<string, number>();
  labels.forEach((label, index) => {
    if (result.has(label.id)) throw new Error(`Duplicate label ID: ${label.id}.`);
    result.set(label.id, index);
  });
  return result;
}

function validateImage(image: DatasetExportImage) {
  if (!Number.isSafeInteger(image.width) || image.width <= 0 ||
      !Number.isSafeInteger(image.height) || image.height <= 0) {
    throw new Error(`Could not determine valid dimensions for ${image.fileName}.`);
  }
}

function boxWithLabel(
  image: DatasetExportImage,
  box: BoundingBox,
  labelsById: Map<string, number>,
) {
  const classIndex = labelsById.get(box.labelId);
  if (classIndex === undefined) {
    throw new Error(`${image.fileName} has an annotation whose label no longer exists.`);
  }
  const values = [box.x, box.y, box.width, box.height];
  if (!values.every(Number.isFinite) || box.width <= 0 || box.height <= 0 ||
      box.x < 0 || box.y < 0 || box.x + box.width > image.width + 1e-6 ||
      box.y + box.height > image.height + 1e-6) {
    throw new Error(`${image.fileName} contains an invalid or out-of-bounds annotation.`);
  }
  return { canonical: boundingBoxToCanonical(box), classIndex };
}

export function createCocoExport(
  images: NamedDatasetExportImage[],
  labels: AnnotationLabel[],
  createdAt = new Date(),
): string {
  const labelsById = labelIndex(labels);
  let annotationId = 1;
  images.forEach(validateImage);
  return JSON.stringify({
    info: { description: "SmartAnnoTool export", date_created: createdAt.toISOString() },
    images: images.map((image, index) => ({
      id: index + 1,
      file_name: image.exportFileName,
      width: image.width,
      height: image.height,
    })),
    categories: labels.map((label, index) => ({
      id: index + 1,
      name: label.name,
      supercategory: "object",
    })),
    annotations: images.flatMap((image, imageIndex) => image.boxes.map((box) => {
      const { canonical, classIndex } = boxWithLabel(image, box, labelsById);
      return {
        id: annotationId++,
        image_id: imageIndex + 1,
        ...toCoco(canonical, classIndex + 1),
        iscrowd: 0,
      };
    })),
  }, null, 2);
}

export function createYoloClasses(labels: AnnotationLabel[]): string {
  labelIndex(labels);
  return labels.map((label) => label.name).join("\n");
}

export function createYoloExport(
  image: DatasetExportImage,
  labels: AnnotationLabel[],
): string {
  validateImage(image);
  const labelsById = labelIndex(labels);
  return image.boxes.map((box) => {
    const { canonical, classIndex } = boxWithLabel(image, box, labelsById);
    return formatYoloLine(toYolo(canonical, image, classIndex));
  }).join("\n");
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character] ?? character);
}

export function createVocExport(
  image: NamedDatasetExportImage,
  labels: AnnotationLabel[],
): string {
  validateImage(image);
  const labelsById = labelIndex(labels);
  const objects = image.boxes.map((box) => {
    const { canonical, classIndex } = boxWithLabel(image, box, labelsById);
    const object = toVocObject(canonical, labels[classIndex].name);
    return [
      "  <object>",
      `    <name>${xmlEscape(object.name)}</name>`,
      "    <pose>Unspecified</pose>",
      "    <truncated>0</truncated>",
      "    <difficult>0</difficult>",
      "    <bndbox>",
      `      <xmin>${object.bndbox.xmin}</xmin>`,
      `      <ymin>${object.bndbox.ymin}</ymin>`,
      `      <xmax>${object.bndbox.xmax}</xmax>`,
      `      <ymax>${object.bndbox.ymax}</ymax>`,
      "    </bndbox>",
      "  </object>",
    ].join("\n");
  }).join("\n");
  return [
    "<annotation>",
    `  <filename>${xmlEscape(image.exportFileName)}</filename>`,
    "  <size>",
    `    <width>${image.width}</width>`,
    `    <height>${image.height}</height>`,
    "    <depth>3</depth>",
    "  </size>",
    objects,
    "</annotation>",
  ].filter(Boolean).join("\n");
}

export function exportStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}
