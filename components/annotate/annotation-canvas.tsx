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
import { Check, Plus } from "lucide-react";
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
  /** `keepTool`: a box just drawn is selected without leaving the box tool. */
  onSelectBox: (id: string | null, options?: { keepTool?: boolean }) => void;
  onBoxesChange: (boxes: BoundingBox[]) => void;
  /** Give a box the label with this name, creating the label if needed. */
  onAssignBoxLabel: (boxId: string, name: string) => Promise<void>;
  /**
   * Add a box drawn while the project had no labels, with the label named
   * (created if needed). Such a box only joins the image once it has one.
   */
  onCreateBox: (box: BoxRect, labelName: string) => Promise<void>;
  onZoomChange: (zoom: number) => void;
  /** Confidence (0..1) keyed by box ID for AI suggestions not yet accepted. */
  suggestionConfidence?: Record<string, number>;
  /** Display number keyed by box ID; numbered boxes show "{n}. {label}" tags. */
  suggestionNumbers?: Record<string, number>;
  /** Increment to re-fit the image in the viewport. */
  fitNonce?: number;
  /** Natural size (image pixels) of the loaded image, reported once it loads. */
  onImageSizeChange?: (size: { width: number; height: number }) => void;
  /** The image URL failed to load (e.g. an expired signed URL). */
  onImageError?: () => void;
  className?: string;
};

/** A box without its label. */
export type BoxRect = Omit<BoundingBox, "labelId">;

/** Smallest box side, in image pixels, that drawing or resizing produces. */
const MIN_BOX_SIZE = 4;

/** Box outline width in screen pixels, independent of zoom. */
const BOX_STROKE_WIDTH = 2;
const SELECTED_BOX_STROKE_WIDTH = 2.5;
/** Screen-pixel gap reserved above a box for its tag (12px text + padding). */
const TAG_HEIGHT = 22;

function useHtmlImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!url) {
      setImage(null);
      setLoadFailed(false);
      return;
    }

    const img = new window.Image();
    setImage(null);
    setLoadFailed(false);
    img.onload = () => {
      setImage(img);
      setLoadFailed(false);
    };
    img.onerror = () => {
      setImage(null);
      setLoadFailed(true);
    };
    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  return { image, loadFailed };
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

/** Moves a box inside the image, keeping its size (shrunk only if larger). */
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Crops a rectangle (any coordinate space) to the given bounds. */
function cropRect(
  rect: { x: number; y: number; width: number; height: number },
  bounds: { left: number; top: number; right: number; bottom: number },
) {
  const left = clamp(rect.x, bounds.left, bounds.right);
  const top = clamp(rect.y, bounds.top, bounds.bottom);
  const right = clamp(rect.x + rect.width, bounds.left, bounds.right);
  const bottom = clamp(rect.y + rect.height, bounds.top, bounds.bottom);
  return { x: left, y: top, width: right - left, height: bottom - top };
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
  onAssignBoxLabel,
  onCreateBox,
  onZoomChange,
  suggestionConfidence,
  suggestionNumbers,
  fitNonce = 0,
  onImageSizeChange,
  onImageError,
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
  /** Label picker for a box: one just drawn, or one being relabelled. */
  const [labelEditor, setLabelEditor] = useState<{
    boxId: string;
    value: string;
    isSaving: boolean;
    error: string | null;
  } | null>(null);
  const [highlightedLabelId, setHighlightedLabelId] = useState<string | null>(
    null,
  );
  /** A box drawn while no labels exist: shown here until a label is chosen. */
  const [pendingBox, setPendingBox] = useState<BoxRect | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  const { image, loadFailed } = useHtmlImage(imageUrl);
  const imageWidth = image?.width ?? 0;
  const imageHeight = image?.height ?? 0;
  const scale = zoom / 100;

  // Zoom changed from outside (the toolbar's +/- buttons): keep the point at
  // the centre of the viewport fixed. Wheel zoom and fitting position the
  // image themselves and record the zoom they set.
  const [positionedZoom, setPositionedZoom] = useState(zoom);
  if (zoom !== positionedZoom) {
    const previousScale = positionedZoom / 100;
    setPositionedZoom(zoom);
    setStagePos((position) => ({
      x: size.width / 2 - ((size.width / 2 - position.x) / previousScale) * scale,
      y: size.height / 2 - ((size.height / 2 - position.y) / previousScale) * scale,
    }));
  }

  useEffect(() => {
    if (imageWidth && imageHeight) {
      onImageSizeChange?.({ width: imageWidth, height: imageHeight });
    }
  }, [imageHeight, imageWidth, onImageSizeChange]);

  useEffect(() => {
    if (loadFailed) onImageError?.();
  }, [loadFailed, onImageError]);

  const labelById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );

  const selectedLabel = labelById.get(selectedLabelId) ?? labels[0];
  const selectedBox = selectedBoxId
    ? boxes.find((box) => box.id === selectedBoxId)
    : undefined;
  const selectedBoxColor = selectedBox
    ? labelById.get(selectedBox.labelId)?.color ?? "#2563eb"
    : "#2563eb";
  const editorBox: BoxRect | null = labelEditor
    ? (boxes.find((box) => box.id === labelEditor.boxId) ??
      (pendingBox?.id === labelEditor.boxId ? pendingBox : null))
    : null;
  const labelEditorIdentity = labelEditor?.boxId ?? null;
  const hasEditorBox = Boolean(editorBox);
  const editorIsPending = Boolean(
    labelEditor && pendingBox?.id === labelEditor.boxId,
  );
  const editorValue = labelEditor?.value ?? "";
  const normalizedEditorValue = editorValue.trim().toLowerCase();
  const exactExistingLabel = normalizedEditorValue
    ? labels.find(
        (label) => label.name.toLowerCase() === normalizedEditorValue,
      )
    : undefined;
  const matchingLabels = useMemo(() => {
    if (!labelEditorIdentity) {
      return [];
    }

    return [...labels]
      .sort((first, second) => {
        if (first.id === selectedLabelId) return -1;
        if (second.id === selectedLabelId) return 1;
        return first.name.localeCompare(second.name);
      })
      .filter(
        (label) =>
          !normalizedEditorValue ||
          label.name.toLowerCase().includes(normalizedEditorValue),
      );
  }, [labelEditorIdentity, labels, normalizedEditorValue, selectedLabelId]);
  const highlightedLabel = highlightedLabelId
    ? labels.find((label) => label.id === highlightedLabelId)
    : undefined;

  useEffect(() => {
    if (!labelEditorIdentity || !hasEditorBox) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasEditorBox, labelEditorIdentity]);

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
    setPositionedZoom(nextZoom);
    setStagePos({
      x: (size.width - imageWidth * (nextZoom / 100)) / 2,
      y: (size.height - imageHeight * (nextZoom / 100)) / 2,
    });
  }, [imageHeight, imageWidth, onZoomChange, size.height, size.width]);

  // Fits once per mount: the workspace keys this component by image ID, so a
  // new URL for the same image (re-signed after a refresh) keeps the view.
  const hasFittedRef = useRef(false);
  const lastFitNonceRef = useRef(fitNonce);

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

  /** Pointer position for drawing: held to the image, so boxes stop at its edges. */
  const getDrawingPosition = () => {
    const point = getPointerImagePosition();
    return point
      ? {
          x: clamp(point.x, 0, imageWidth),
          y: clamp(point.y, 0, imageHeight),
        }
      : null;
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
    setPositionedZoom(nextZoom);
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

    const point = getDrawingPosition();
    if (!point) {
      return;
    }

    drawStartRef.current = point;
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    onSelectBox(null, { keepTool: true });
  };

  const handleMouseMove = () => {
    if (tool !== "bbox" || !drawStartRef.current) {
      return;
    }
    const point = getDrawingPosition();
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

    if (
      normalized.width < MIN_BOX_SIZE ||
      normalized.height < MIN_BOX_SIZE ||
      !imageWidth
    ) {
      return;
    }

    const rect: BoxRect = {
      id: `box-${crypto.randomUUID()}`,
      ...clampBoxToImage(normalized, imageWidth, imageHeight),
    };
    // Every saved box needs a label: with none to give it yet, the box waits
    // here until the picker below names one.
    if (!selectedLabel) {
      setPendingBox(rect);
    } else {
      onBoxesChange([...boxes, { ...rect, labelId: selectedLabel.id }]);
      onSelectBox(rect.id, { keepTool: true });
    }
    setLabelEditor({
      boxId: rect.id,
      value: selectedLabel?.name ?? "",
      isSaving: false,
      error: null,
    });
    setHighlightedLabelId(selectedLabel?.id ?? null);
  };

  /** Relabel an existing box (double-click it or its tag). */
  const openRelabelEditor = (box: BoundingBox) => {
    const label = labelById.get(box.labelId);
    onSelectBox(box.id, { keepTool: true });
    setLabelEditor({
      boxId: box.id,
      value: label?.name ?? "",
      isSaving: false,
      error: null,
    });
    setHighlightedLabelId(label?.id ?? null);
  };

  /** Closes the picker for `boxId` (all pickers when omitted), dropping its unlabelled box. */
  const closeLabelEditor = (boxId?: string) => {
    const matches = (id: string | undefined) => boxId === undefined || id === boxId;
    setLabelEditor((current) => (current && matches(current.boxId) ? null : current));
    setPendingBox((current) => (current && matches(current.id) ? null : current));
    setHighlightedLabelId(null);
  };

  const submitLabelEditor = async (nameOverride?: string) => {
    if (!labelEditor || labelEditor.isSaving) {
      return;
    }

    const name = (nameOverride ?? labelEditor.value).trim();
    if (!name) {
      setLabelEditor((current) =>
        current ? { ...current, error: "Enter a label name." } : current,
      );
      return;
    }

    const { boxId } = labelEditor;
    const pending = pendingBox?.id === boxId ? pendingBox : null;
    if (!pending && !boxes.some((candidate) => candidate.id === boxId)) {
      closeLabelEditor(boxId);
      return;
    }

    setLabelEditor((current) =>
      current ? { ...current, isSaving: true, error: null } : current,
    );

    try {
      if (pending) {
        await onCreateBox(pending, name);
      } else {
        await onAssignBoxLabel(boxId, name);
      }
      // A new box may have been drawn meanwhile: only close this picker.
      closeLabelEditor(boxId);
    } catch (error) {
      setLabelEditor((current) =>
        current?.boxId === boxId
          ? {
              ...current,
              isSaving: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not save the label.",
            }
          : current,
      );
    }
  };

  const moveLabelHighlight = (direction: 1 | -1) => {
    if (matchingLabels.length === 0) {
      return;
    }

    const currentIndex = matchingLabels.findIndex(
      (label) => label.id === highlightedLabelId,
    );
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : matchingLabels.length - 1
        : (currentIndex + direction + matchingLabels.length) %
          matchingLabels.length;
    setHighlightedLabelId(matchingLabels[nextIndex].id);
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

  // Transparent while the image loads, so the workspace's placeholder (the
  // image's ThumbHash preview) shows through until the image is drawn.
  const isLoading = Boolean(imageUrl) && !loadFailed && !image;
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
        "relative h-full min-h-[320px] w-full overflow-hidden rounded-[10px]",
        !isLoading && "bg-accent",
        cursorClass,
        className,
      )}
    >
      {!imageUrl ? (
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          No image available for {fileName}
        </div>
      ) : loadFailed ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-medium">Could not load this image.</p>
          <p className="text-xs text-muted-foreground">
            The S3 link may have expired or the object may no longer be available.
          </p>
        </div>
      ) : !image ? null : (
        <Stage
          className="animate-in fade-in-0 duration-200"
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
              const isSuggestion = suggestionConfidence?.[box.id] !== undefined;

              return (
                <Rect
                  key={box.id}
                  id={box.id}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  stroke={color}
                  // Screen-space stroke (and dash, and hit stroke) so boxes
                  // stay visible when a large image is zoomed far out.
                  strokeScaleEnabled={false}
                  strokeWidth={isSelected ? SELECTED_BOX_STROKE_WIDTH : BOX_STROKE_WIDTH}
                  // Unaccepted AI suggestions are dashed and nearly unfilled.
                  dash={isSuggestion ? [6, 4] : undefined}
                  fill={hexToRgba(
                    color,
                    isSelected ? 0.22 : isSuggestion ? 0.015 : 0.045,
                  )}
                  opacity={selectedBoxId && !isSelected ? 0.58 : 1}
                  shadowColor={color}
                  shadowBlur={isSelected ? 6 / scale : 0}
                  shadowOpacity={isSelected ? 0.45 : 0}
                  shadowForStrokeEnabled={isSelected}
                  hitStrokeWidth={10}
                  draggable={tool === "select"}
                  // Keep a dragged box inside the image (absolute coordinates).
                  dragBoundFunc={(position) => ({
                    x: clamp(position.x, stagePos.x, stagePos.x + (imageWidth - box.width) * scale),
                    y: clamp(position.y, stagePos.y, stagePos.y + (imageHeight - box.height) * scale),
                  })}
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
                  onDblClick={() => {
                    if (tool === "select") {
                      openRelabelEditor(box);
                    }
                  }}
                  onMouseEnter={(event) => {
                    const container = event.target.getStage()?.container();
                    if (container && tool === "select") container.style.cursor = "move";
                  }}
                  onMouseLeave={(event) => {
                    const container = event.target.getStage()?.container();
                    if (container) container.style.cursor = "";
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
              const confidence = suggestionConfidence?.[box.id];
              const number = suggestionNumbers?.[box.id];
              // Tags keep a constant screen size: counter-scale by 1/scale and
              // sit just above the box's top-left (inside it at the image top).
              return (
                <Label
                  key={`label-${box.id}`}
                  x={box.x}
                  y={Math.max(box.y - TAG_HEIGHT / scale, 0)}
                  scaleX={1 / scale}
                  scaleY={1 / scale}
                  opacity={selectedBoxId && box.id !== selectedBoxId ? 0.62 : 1}
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDblClick={(event) => {
                    event.cancelBubble = true;
                    openRelabelEditor(box);
                  }}
                >
                  <Tag fill={label.color} cornerRadius={4} />
                  <Text
                    text={
                      number !== undefined
                        ? `${number}. ${label.name}`
                        : confidence !== undefined
                          ? `✦ ${label.name} ${Math.round(confidence * 100)}%`
                          : label.name
                    }
                    fontSize={12}
                    fontFamily="inherit"
                    fill="#ffffff"
                    padding={4}
                  />
                </Label>
              );
            })}

            {pendingBox ? (
              <Rect
                x={pendingBox.x}
                y={pendingBox.y}
                width={pendingBox.width}
                height={pendingBox.height}
                stroke="#71717a"
                dash={[6, 4]}
                strokeScaleEnabled={false}
                strokeWidth={BOX_STROKE_WIDTH}
                fill={hexToRgba("#71717a", 0.12)}
                listening={false}
              />
            ) : null}

            {draft ? (
              <Rect
                x={draft.width < 0 ? draft.x + draft.width : draft.x}
                y={draft.height < 0 ? draft.y + draft.height : draft.y}
                width={Math.abs(draft.width)}
                height={Math.abs(draft.height)}
                stroke={selectedLabel?.color ?? "#2563eb"}
                dash={[6, 4]}
                strokeScaleEnabled={false}
                strokeWidth={BOX_STROKE_WIDTH}
                fill={hexToRgba(selectedLabel?.color ?? "#2563eb", 0.12)}
                listening={false}
              />
            ) : null}

            {tool === "select" ? (
              <Transformer
                ref={transformerRef}
                rotateEnabled={false}
                keepRatio={false}
                // Size from geometry only: the screen-space stroke must not
                // leak into resize maths.
                ignoreStroke
                borderStroke={selectedBoxColor}
                borderStrokeWidth={1}
                anchorStroke={selectedBoxColor}
                anchorFill="#ffffff"
                anchorSize={7}
                anchorCornerRadius={2}
                padding={1}
                // Resizing past the image edge crops at the edge (absolute
                // coordinates), instead of shifting the opposite side.
                boundBoxFunc={(oldBox, newBox) => {
                  const cropped = cropRect(newBox, {
                    left: stagePos.x,
                    top: stagePos.y,
                    right: stagePos.x + imageWidth * scale,
                    bottom: stagePos.y + imageHeight * scale,
                  });
                  const minimum = MIN_BOX_SIZE * scale;
                  if (cropped.width < minimum || cropped.height < minimum) {
                    return oldBox;
                  }
                  return { ...newBox, ...cropped };
                }}
              />
            ) : null}
          </Layer>
        </Stage>
      )}

      {image && boxes.length === 0 && !pendingBox && !draft ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 z-[5] -translate-x-1/2 whitespace-nowrap rounded-full bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow">
          {tool === "bbox"
            ? "Drag on the image to draw a box"
            : "Choose the Bounding box tool (B), then drag to draw a box"}
        </p>
      ) : null}

      {labelEditor && editorBox ? (
        <form
          className="absolute z-10"
          style={{
            left: Math.min(
              Math.max(stagePos.x + editorBox.x * scale, 8),
              Math.max(size.width - 268, 8),
            ),
            top: Math.max(stagePos.y + editorBox.y * scale - 38, 8),
            width: Math.min(
              Math.max(editorBox.width * scale, 220),
              Math.max(size.width - 16, 220),
              260,
            ),
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submitLabelEditor(highlightedLabel?.name);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="relative">
            <input
              ref={labelInputRef}
              value={labelEditor.value}
              readOnly={labelEditor.isSaving}
              aria-busy={labelEditor.isSaving}
              role="combobox"
              aria-expanded
              aria-controls={`label-options-${labelEditor.boxId}`}
              aria-activedescendant={
                highlightedLabelId
                  ? `label-option-${highlightedLabelId}`
                  : undefined
              }
              aria-label="Choose a label"
              placeholder="Search or create a label..."
              className="h-9 w-full rounded-md border-2 border-primary bg-background px-2 pr-20 text-sm text-foreground shadow-lg outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
              onChange={(event) => {
                const value = event.target.value;
                const exactMatch = labels.find(
                  (label) =>
                    label.name.toLowerCase() === value.trim().toLowerCase(),
                );
                setHighlightedLabelId(exactMatch?.id ?? null);
                setLabelEditor((current) =>
                  current
                    ? { ...current, value, error: null }
                    : current,
                );
              }}
              onBlur={() => {
                // Clicking away confirms an existing label, or the name typed
                // for an unlabelled box; otherwise it cancels (and drops an
                // unlabelled box).
                if (exactExistingLabel) {
                  void submitLabelEditor(exactExistingLabel.name);
                } else if (editorIsPending && normalizedEditorValue) {
                  void submitLabelEditor(editorValue);
                } else {
                  closeLabelEditor(labelEditor.boxId);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveLabelHighlight(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveLabelHighlight(-1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeLabelEditor(labelEditor.boxId);
                }
              }}
            />
            {exactExistingLabel ? (
              <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] font-medium text-emerald-600">
                <Check className="size-3" />
                Existing
              </span>
            ) : null}
          </div>
          {labelEditor.error ? (
            <p className="mt-1 rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow">
              {labelEditor.error}
            </p>
          ) : null}
          <div
            id={`label-options-${labelEditor.boxId}`}
            role="listbox"
            className="mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xl"
          >
            <p className="border-b px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Choose a label
            </p>
            <div className="max-h-[92px] overflow-y-auto overscroll-contain p-1">
              {matchingLabels.map((label) => {
                const isHighlighted = label.id === highlightedLabelId;
                const isExact = label.id === exactExistingLabel?.id;
                return (
                  <button
                    key={label.id}
                    id={`label-option-${label.id}`}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                      isHighlighted ? "bg-accent" : "hover:bg-accent/60",
                    )}
                    onMouseEnter={() => setHighlightedLabelId(label.id)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      void submitLabelEditor(label.name);
                    }}
                  >
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {label.name}
                    </span>
                    {isExact ? (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                        <Check className="size-3" /> Existing
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {normalizedEditorValue && !exactExistingLabel ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/60"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void submitLabelEditor(editorValue);
                  }}
                >
                  <Plus className="size-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 truncate">
                    Create <span className="font-semibold">“{editorValue.trim()}”</span>
                  </span>
                </button>
              ) : null}

              {matchingLabels.length === 0 && !normalizedEditorValue ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Type a name to create your first label.
                </p>
              ) : null}
            </div>
            <p className="border-t px-2.5 py-1.5 text-[10px] text-muted-foreground">
              {editorIsPending
                ? "Enter apply · Esc discard box"
                : "↑↓ choose · Enter apply · Esc cancel"}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
