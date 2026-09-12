/**
 * Coordinate conversion between the app's internal bounding box representation
 * and the COCO, YOLO, and Pascal VOC formats.
 *
 * Canonical box: (x_min, y_min, x_max, y_max) in original-image pixels.
 * The app's `BoundingBox` (top-left x/y + width/height) is a 1:1 reparameterization
 * of the canonical box (x_min = x, y_min = y, x_max = x + width, y_max = y + height),
 * so conversions below go through `CanonicalBox` as the single source of truth.
 */
import type { BoundingBox } from "@/lib/types/annotations";

export type CanonicalBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export function boundingBoxToCanonical(box: BoundingBox): CanonicalBox {
  return {
    xMin: box.x,
    yMin: box.y,
    xMax: box.x + box.width,
    yMax: box.y + box.height,
  };
}

export function canonicalToBoundingBox(
  canonical: CanonicalBox,
  labelId: string,
  id: string = `box-${crypto.randomUUID()}`,
): BoundingBox {
  return {
    id,
    labelId,
    x: canonical.xMin,
    y: canonical.yMin,
    width: canonical.xMax - canonical.xMin,
    height: canonical.yMax - canonical.yMin,
  };
}

/** Clamp a canonical box to the image bounds, matching the canvas's own clamping. */
export function clampCanonicalToImage(
  canonical: CanonicalBox,
  image: ImageSize,
): CanonicalBox {
  const width = Math.min(
    Math.max(canonical.xMax - canonical.xMin, 1),
    image.width,
  );
  const height = Math.min(
    Math.max(canonical.yMax - canonical.yMin, 1),
    image.height,
  );
  const xMin = Math.min(Math.max(canonical.xMin, 0), Math.max(image.width - width, 0));
  const yMin = Math.min(Math.max(canonical.yMin, 0), Math.max(image.height - height, 0));

  return { xMin, yMin, xMax: xMin + width, yMax: yMin + height };
}

// ---------------------------------------------------------------------------
// COCO — bbox = [x_min, y_min, width, height], pixels, arbitrary category_id
// ---------------------------------------------------------------------------

export type CocoAnnotation = {
  category_id: number;
  bbox: [number, number, number, number];
  area: number;
};

export function toCoco(canonical: CanonicalBox, categoryId: number): CocoAnnotation {
  const width = canonical.xMax - canonical.xMin;
  const height = canonical.yMax - canonical.yMin;
  return {
    category_id: categoryId,
    bbox: [canonical.xMin, canonical.yMin, width, height],
    area: width * height,
  };
}

export function fromCoco(bbox: [number, number, number, number]): CanonicalBox {
  const [x, y, width, height] = bbox;
  return { xMin: x, yMin: y, xMax: x + width, yMax: y + height };
}

// ---------------------------------------------------------------------------
// YOLO — "class_id x_center y_center width height", normalized 0-1
// ---------------------------------------------------------------------------

export type YoloAnnotation = {
  classId: number;
  xCenter: number;
  yCenter: number;
  width: number;
  height: number;
};

export function toYolo(
  canonical: CanonicalBox,
  image: ImageSize,
  classId: number,
): YoloAnnotation {
  return {
    classId,
    xCenter: (canonical.xMin + canonical.xMax) / 2 / image.width,
    yCenter: (canonical.yMin + canonical.yMax) / 2 / image.height,
    width: (canonical.xMax - canonical.xMin) / image.width,
    height: (canonical.yMax - canonical.yMin) / image.height,
  };
}

export function formatYoloLine(annotation: YoloAnnotation): string {
  return [
    annotation.classId,
    annotation.xCenter.toFixed(6),
    annotation.yCenter.toFixed(6),
    annotation.width.toFixed(6),
    annotation.height.toFixed(6),
  ].join(" ");
}

export function fromYolo(
  annotation: Pick<YoloAnnotation, "xCenter" | "yCenter" | "width" | "height">,
  image: ImageSize,
): CanonicalBox {
  const cx = annotation.xCenter * image.width;
  const cy = annotation.yCenter * image.height;
  const bw = annotation.width * image.width;
  const bh = annotation.height * image.height;
  return {
    xMin: cx - bw / 2,
    xMax: cx + bw / 2,
    yMin: cy - bh / 2,
    yMax: cy + bh / 2,
  };
}

// ---------------------------------------------------------------------------
// Pascal VOC — <bndbox>xmin/ymin/xmax/ymax</bndbox>, pixels, class name string
// ---------------------------------------------------------------------------

export type VocObject = {
  name: string;
  bndbox: { xmin: number; ymin: number; xmax: number; ymax: number };
};

export function toVocObject(canonical: CanonicalBox, className: string): VocObject {
  return {
    name: className,
    bndbox: {
      xmin: canonical.xMin,
      ymin: canonical.yMin,
      xmax: canonical.xMax,
      ymax: canonical.yMax,
    },
  };
}

export function fromVocObject(object: VocObject): CanonicalBox {
  return {
    xMin: object.bndbox.xmin,
    yMin: object.bndbox.ymin,
    xMax: object.bndbox.xmax,
    yMax: object.bndbox.ymax,
  };
}

// ---------------------------------------------------------------------------
// Roboflow / center-based absolute-pixel predictions (not normalized, unlike
// YOLO's 0-1 range) -> canonical. Same center-to-corner algebra as `fromYolo`,
// without the width/height denormalization step.
// ---------------------------------------------------------------------------

export function fromCenterPixelBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): CanonicalBox {
  return {
    xMin: box.x - box.width / 2,
    xMax: box.x + box.width / 2,
    yMin: box.y - box.height / 2,
    yMax: box.y + box.height / 2,
  };
}
