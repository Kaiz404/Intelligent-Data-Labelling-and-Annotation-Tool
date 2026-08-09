"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Rect,
  Transformer,
  Label,
  Tag,
  Text,
} from "react-konva";
import type Konva from "konva";
import type {
  AnnotationLabel,
  AnnotationTool,
  BoundingBox,
} from "@/lib/types/annotations";
import { cn } from "@/lib/utils";

type AnnotationCanvasProps = {
  imageUrl: string | null;
  fileName: string;
  tool: AnnotationTool;
  zoom: number;
  boxes: BoundingBox[];
  labels: AnnotationLabel[];
  selectedBoxId: string | null;
  selectedLabelId: string;
  onSelectBox: (id: string | null) => void;
  onBoxesChange: (boxes: BoundingBox[]) => void;
  onZoomChange: (zoom: number) => void;
  /** Increment to re-fit the image in the viewport. */
  fitNonce?: number;
  className?: string;
};

function useHtmlImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!url) {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.onerror = () => setImage(null);
    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return image;
}

function normalizeRect(x: number, y: number, width: number, height: number) {
  const nextX = width < 0 ? x + width : x;
  const nextY = height < 0 ? y + height : y;
  return {
    x: nextX,
    y: nextY,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function clampBoxToImage(
  box: Pick<BoundingBox, "x" | "y" | "width" | "height">,
  imageWidth: number,
  imageHeight: number,
) {
  const width = Math.min(Math.max(box.width, 1), imageWidth);
  const height = Math.min(Math.max(box.height, 1), imageHeight);
  const x = Math.min(Math.max(box.x, 0), Math.max(imageWidth - width, 0));
  const y = Math.min(Math.max(box.y, 0), Math.max(imageHeight - height, 0));
  return { x, y, width, height };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function AnnotationCanvas({
  imageUrl,
  fileName,
  tool,
  zoom,
  boxes,
  labels,
  selectedBoxId,
  selectedLabelId,
  onSelectBox,
  onBoxesChange,
  onZoomChange,
  fitNonce = 0,
  className,
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedShapeRef = useRef<Konva.Rect | null>(null);
  const [size, setSize] = useState({ width: 790, height: 550 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  const image = useHtmlImage(imageUrl);
  const imageWidth = image?.width ?? 0;
  const imageHeight = image?.height ?? 0;
  const scale = zoom / 100;

  const labelById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );

  const selectedLabel = labelById.get(selectedLabelId) ?? labels[0];

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: Math.max(Math.floor(rect.width), 320),
        height: Math.max(Math.floor(rect.height), 320),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitToView = useCallback(() => {
    if (!imageWidth || !imageHeight) {
      return;
    }

    const padding = 32;
    const availableWidth = Math.max(size.width - padding * 2, 1);
    const availableHeight = Math.max(size.height - padding * 2, 1);
    const nextScale = Math.min(
      availableWidth / imageWidth,
      availableHeight / imageHeight,
      1,
    );
    const nextZoom = Math.max(10, Math.round(nextScale * 100));
    onZoomChange(nextZoom);
    setStagePos({
      x: (size.width - imageWidth * (nextZoom / 100)) / 2,
      y: (size.height - imageHeight * (nextZoom / 100)) / 2,
    });
  }, [imageHeight, imageWidth, onZoomChange, size.height, size.width]);

  const hasFittedRef = useRef(false);
  const lastFitNonceRef = useRef(fitNonce);

  useEffect(() => {
    hasFittedRef.current = false;
  }, [imageUrl]);

  useEffect(() => {
    if (!image || !imageWidth || !imageHeight) {
      return;
    }
    const fitRequested = fitNonce !== lastFitNonceRef.current;
    if (!hasFittedRef.current || fitRequested) {
      fitToView();
      hasFittedRef.current = true;
      lastFitNonceRef.current = fitNonce;
    }
  }, [fitNonce, fitToView, image, imageHeight, imageWidth]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) {
      return;
    }

    if (tool !== "select" || !selectedBoxId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const node = stage.findOne(`#${selectedBoxId}`);
    if (node) {
      selectedShapeRef.current = node as Konva.Rect;
      transformer.nodes([node]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [boxes, selectedBoxId, tool]);

  const getPointerImagePosition = () => {
    const stage = stageRef.current;
    if (!stage) {
      return null;
    }
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return null;
    }
    return {
      x: (pointer.x - stagePos.x) / scale,
      y: (pointer.y - stagePos.y) / scale,
    };
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const nextZoom = Math.min(400, Math.max(10, zoom + direction * 10));
    const nextScale = nextZoom / 100;
    const mousePointTo = {
      x: (pointer.x - stagePos.x) / oldScale,
      y: (pointer.y - stagePos.y) / oldScale,
    };

    onZoomChange(nextZoom);
    setStagePos({
      x: pointer.x - mousePointTo.x * nextScale,
      y: pointer.y - mousePointTo.y * nextScale,
    });
  };

  const handleMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "pan") {
      return;
    }

    const clickedOnEmpty =
      event.target === event.target.getStage() ||
      event.target.getClassName() === "Image";

    if (tool === "select") {
      if (clickedOnEmpty) {
        onSelectBox(null);
      }
      return;
    }

    if (tool !== "bbox" || !imageWidth || !imageHeight) {
      return;
    }

    const point = getPointerImagePosition();
    if (!point) {
      return;
    }

    drawStartRef.current = point;
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    onSelectBox(null);
  };

  const handleMouseMove = () => {
    if (tool !== "bbox" || !drawStartRef.current) {
      return;
    }
    const point = getPointerImagePosition();
    if (!point) {
      return;
    }
    const start = drawStartRef.current;
    setDraft({
      x: start.x,
      y: start.y,
      width: point.x - start.x,
      height: point.y - start.y,
    });
  };

  const handleMouseUp = () => {
    if (tool !== "bbox" || !draft || !drawStartRef.current) {
      drawStartRef.current = null;
      setDraft(null);
      return;
    }

    const normalized = normalizeRect(
      draft.x,
      draft.y,
      draft.width,
      draft.height,
    );
    drawStartRef.current = null;
    setDraft(null);

    if (normalized.width < 4 || normalized.height < 4 || !imageWidth) {
      return;
    }

    const clamped = clampBoxToImage(normalized, imageWidth, imageHeight);
    const nextBox: BoundingBox = {
      id: `box-${crypto.randomUUID()}`,
      labelId: selectedLabel?.id ?? selectedLabelId,
      ...clamped,
    };
    onBoxesChange([...boxes, nextBox]);
    onSelectBox(nextBox.id);
  };

  const updateBoxFromNode = (boxId: string, node: Konva.Rect) => {
    if (!imageWidth || !imageHeight) {
      return;
    }

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const next = clampBoxToImage(
      {
        x: node.x(),
        y: node.y(),
        width: Math.max(1, node.width() * scaleX),
        height: Math.max(1, node.height() * scaleY),
      },
      imageWidth,
      imageHeight,
    );

    node.scaleX(1);
    node.scaleY(1);
    node.position({ x: next.x, y: next.y });
    node.size({ width: next.width, height: next.height });

    onBoxesChange(
      boxes.map((box) => (box.id === boxId ? { ...box, ...next } : box)),
    );
  };

  const cursorClass =
    tool === "pan"
      ? "cursor-grab active:cursor-grabbing"
      : tool === "bbox"
        ? "cursor-crosshair"
        : "cursor-default";

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full min-h-[320px] w-full overflow-hidden rounded-[10px] bg-accent",
        cursorClass,
        className,
      )}
    >
      {!imageUrl ? (
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          No image available for {fileName}
        </div>
      ) : (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          scaleX={scale}
          scaleY={scale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={tool === "pan"}
          onDragEnd={(event) => {
            if (tool === "pan") {
              setStagePos({ x: event.target.x(), y: event.target.y() });
            }
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMousemove={handleMouseMove}
          onMouseup={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <Layer>
            {image ? (
              <KonvaImage image={image} listening={tool !== "bbox"} />
            ) : null}

            {boxes.map((box) => {
              const label = labelById.get(box.labelId);
              const color = label?.color ?? "#2563eb";
              const isSelected = box.id === selectedBoxId;

              return (
                <Rect
                  key={box.id}
                  id={box.id}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  stroke={color}
                  strokeWidth={isSelected ? 2.5 : 2}
                  fill={hexToRgba(color, isSelected ? 0.18 : 0.1)}
                  draggable={tool === "select"}
                  onClick={() => {
                    if (tool === "select") {
                      onSelectBox(box.id);
                    }
                  }}
                  onTap={() => {
                    if (tool === "select") {
                      onSelectBox(box.id);
                    }
                  }}
                  onDragEnd={(event) => {
                    updateBoxFromNode(box.id, event.target as Konva.Rect);
                  }}
                  onTransformEnd={(event) => {
                    updateBoxFromNode(box.id, event.target as Konva.Rect);
                  }}
                />
              );
            })}

            {boxes.map((box) => {
              const label = labelById.get(box.labelId);
              if (!label) {
                return null;
              }
              return (
                <Label key={`label-${box.id}`} x={box.x} y={Math.max(box.y - 22, 0)}>
                  <Tag fill={label.color} cornerRadius={4} />
                  <Text
                    text={label.name}
                    fontSize={12}
                    fontFamily="inherit"
                    fill="#ffffff"
                    padding={4}
                  />
                </Label>
              );
            })}

            {draft ? (
              <Rect
                x={draft.width < 0 ? draft.x + draft.width : draft.x}
                y={draft.height < 0 ? draft.y + draft.height : draft.y}
                width={Math.abs(draft.width)}
                height={Math.abs(draft.height)}
                stroke={selectedLabel?.color ?? "#2563eb"}
                dash={[6, 4]}
                strokeWidth={2}
                fill={hexToRgba(selectedLabel?.color ?? "#2563eb", 0.12)}
                listening={false}
              />
            ) : null}

            {tool === "select" ? (
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio={false}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 4 || newBox.height < 4) {
                    return oldBox;
                  }
                  return newBox;
                }}
              />
            ) : null}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
