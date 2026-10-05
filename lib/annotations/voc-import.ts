import { MAX_IMPORT_BOXES_PER_IMAGE, normalizeDatasetPath } from "@/lib/annotations/coco-import";
import type { DatasetImportPlan } from "@/lib/types/dataset-import";

export type VocCoordinateProfile = "app-native" | "one-based-inclusive";
export type VocImportOptions = { coordinateProfile?: VocCoordinateProfile };
export type VocAnnotation = {
  filename: string;
  width: number;
  height: number;
  objects: Array<{ name: string; x: number; y: number; width: number; height: number }>;
};

function children(element: Element): Element[] {
  return Array.from(element.childNodes).filter((node): node is Element => node.nodeType === 1);
}
function required(element: Element, name: string, context: string): Element {
  const matches = children(element).filter((child) => child.tagName === name);
  if (matches.length !== 1) throw new Error(`${context}: expected exactly one <${name}>.`);
  return matches[0];
}
function text(element: Element, context: string): string {
  if (children(element).length) throw new Error(`${context}: expected text, not nested elements.`);
  const value = element.textContent?.trim() ?? "";
  if (!value) throw new Error(`${context}: value must be non-empty.`);
  return value;
}
function allowChildren(element: Element, allowed: string[], context: string) {
  for (const child of children(element)) {
    if (child.namespaceURI || !allowed.includes(child.tagName)) {
      throw new Error(`${context}: unsupported element <${child.tagName}>; only axis-aligned bounding boxes are supported.`);
    }
  }
}
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
function coordinate(element: Element, name: string, context: string): number {
  const value = text(required(element, name, context), `${context}/${name}`);
  if (!decimal.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`${context}/${name}: coordinates must be finite decimal numbers.`);
  }
  return Number(value);
}

/** Browser XML parser. VOC pose/truncated/difficult metadata is intentionally discarded. */
export function parseVocAnnotation(xml: string, annotationPath: string, options: VocImportOptions = {}): VocAnnotation {
  const profile = options.coordinateProfile ?? "app-native";
  if (profile !== "app-native" && profile !== "one-based-inclusive") throw new Error("Unsupported VOC coordinate profile.");
  // Refuse declarations before parsing; no custom entities or external DTDs are needed.
  if (xml.includes("<!DOCTYPE") || xml.includes("<!ENTITY")) {
    throw new Error(`${annotationPath}: DTD and custom entity declarations are not supported.`);
  }
  if (typeof DOMParser === "undefined") throw new Error("VOC validation requires a browser with DOMParser support.");
  let document: Document;
  try { document = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml"); }
  catch { throw new Error(`${annotationPath}: malformed XML.`); }
  if (document.doctype) throw new Error(`${annotationPath}: DTD declarations are not supported.`);
  const root = document.documentElement;
  if (!root || document.getElementsByTagName("parsererror").length) throw new Error(`${annotationPath}: malformed XML.`);
  if (root.tagName !== "annotation" || root.namespaceURI) throw new Error(`${annotationPath}: expected <annotation> root.`);
  allowChildren(root, ["folder", "filename", "path", "source", "owner", "size", "segmented", "object"], annotationPath);
  const filename = normalizeDatasetPath(text(required(root, "filename", annotationPath), `${annotationPath}/filename`));
  const size = required(root, "size", annotationPath);
  allowChildren(size, ["width", "height", "depth"], `${annotationPath}/size`);
  const dimensions = ["width", "height"].map((name) => {
    const value = text(required(size, name, `${annotationPath}/size`), `${annotationPath}/size/${name}`);
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`${annotationPath}/size/${name}: dimensions must be positive safe integers.`);
    }
    return number;
  });
  const [width, height] = dimensions;
  const objects = children(root).filter((element) => element.tagName === "object");
  if (objects.length > MAX_IMPORT_BOXES_PER_IMAGE) throw new Error(`${annotationPath}: image exceeds the 50,000-box limit.`);
  return {
    filename, width, height,
    objects: objects.map((object, index) => {
      const context = `${annotationPath}/object[${index + 1}]`;
      allowChildren(object, ["name", "pose", "truncated", "difficult", "bndbox"], context);
      const name = text(required(object, "name", context), `${context}/name`);
      const box = required(object, "bndbox", context);
      allowChildren(box, ["xmin", "ymin", "xmax", "ymax"], `${context}/bndbox`);
      const [xmin, ymin, xmax, ymax] = ["xmin", "ymin", "xmax", "ymax"].map((field) => coordinate(box, field, `${context}/bndbox`));
      const inclusive = profile === "one-based-inclusive";
      // Inclusive VOC describes integer pixel indices; app-native edges may be fractional.
      if (inclusive && ![xmin, ymin, xmax, ymax].every(Number.isSafeInteger)) {
        throw new Error(`${context}: one-based inclusive coordinates must be safe integers.`);
      }
      if (xmin < (inclusive ? 1 : 0) || ymin < (inclusive ? 1 : 0) || xmax > width || ymax > height ||
          (inclusive ? xmax < xmin || ymax < ymin : xmax <= xmin || ymax <= ymin)) {
        throw new Error(`${context}: invalid bounding-box ordering or image bounds for ${profile} coordinates.`);
      }
      return { name, x: xmin - (inclusive ? 1 : 0), y: ymin - (inclusive ? 1 : 0),
        width: xmax - xmin + (inclusive ? 1 : 0), height: ymax - ymin + (inclusive ? 1 : 0) };
    }),
  };
}

/** Deterministic source IDs, independent of ZIP/document enumeration order. */
export function buildVocDatasetPlan(inputs: Array<{ path: string; annotationPath: string; annotation: VocAnnotation }>): DatasetImportPlan {
  const names = [...new Set(inputs.flatMap(({ annotation }) => annotation.objects.map((object) => object.name)))].sort();
  const categories = names.map((name, index) => ({ id: String(index), name }));
  const ids = new Map(categories.map((category) => [category.name, category.id]));
  const seen = new Set<string>();
  return { categories, images: inputs.map(({ path: sourcePath, annotationPath, annotation }) => {
    const path = normalizeDatasetPath(sourcePath);
    if (seen.has(path)) throw new Error(`Multiple VOC annotations reference image: ${path}`);
    seen.add(path);
    return { id: path, path, width: annotation.width, height: annotation.height,
      boxes: annotation.objects.map(({ name, ...box }, index) => ({ ...box, id: `${annotationPath}:${index + 1}`, categoryId: ids.get(name)! })) };
  }) };
}
