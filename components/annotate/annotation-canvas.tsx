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
  onSelectBox: (id: string | null) => void;
  onBoxesChange: (boxes: BoundingBox[]) => void;
  onAssignBoxLabel: (boxId: string, name: string) => Promise<void>;
  onRenameLabel: (labelId: string, name: string) => Promise<void>;
  onZoomChange: (zoom: number) => void;
  /** Increment to re-fit the image in the viewport. */
  fitNonce?: number;
  className?: string;
};

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
  onAssignBoxLabel,
  onRenameLabel,
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
  const [labelEditor, setLabelEditor] = useState<{
    boxId: string;
    mode: "assign" | "rename";
    value: string;
    isSaving: boolean;
    error: string | null;
  } | null>(null);
  const [highlightedLabelId, setHighlightedLabelId] = useState<string | null>(
    null,
  );
  const labelInputRef = useRef<HTMLInputElement>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);

  const { image, loadFailed } = useHtmlImage(imageUrl);
  const imageWidth = image?.width ?? 0;
  const imageHeight = image?.height ?? 0;
  const scale = zoom / 100;

  const labelById = useMemo(
    () => new Map(labels.map((label) => [label.id, label])),
    [labels],
  );

  const selectedLabel = labelById.get(selectedLabelId) ?? labels[0];
  const editorBox = labelEditor
    ? boxes.find((box) => box.id === labelEditor.boxId)
    : null;
  const labelEditorIdentity = labelEditor
    ? `${labelEditor.mode}:${labelEditor.boxId}`
    : null;
  const hasEditorBox = Boolean(editorBox);
  const editorMode = labelEditor?.mode ?? null;
  const editorValue = labelEditor?.value ?? "";
  const normalizedEditorValue = editorValue.trim().toLowerCase();
  const exactExistingLabel = normalizedEditorValue
    ? labels.find(
        (label) => label.name.toLowerCase() === normalizedEditorValue,
      )
    : undefined;
  const matchingLabels = useMemo(() => {
    if (editorMode !== "assign") {
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
  }, [editorMode, labels, normalizedEditorValue, selectedLabelId]);
  const highlightedLabel = highlightedLabelId
    ? labels.find((label) => label.id === highlightedLabelId)
    : undefined;
  const hasRenameConflict = Boolean(
    editorMode === "rename" &&
      exactExistingLabel &&
      editorBox &&
      exactExistingLabel.id !== editorBox.labelId,
  );

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
    setLabelEditor({
      boxId: nextBox.id,
      mode: "assign",
      value: selectedLabel?.name ?? "",
      isSaving: false,
      error: null,
    });
    setHighlightedLabelId(selectedLabel?.id ?? null);
  };

  const openRenameEditor = (box: BoundingBox) => {
    const label = labelById.get(box.labelId);
    if (!label) {
      return;
    }

    onSelectBox(box.id);
    setLabelEditor({
      boxId: box.id,
      mode: "rename",
      value: label.name,
      isSaving: false,
      error: null,
    });
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

    const box = boxes.find((candidate) => candidate.id === labelEditor.boxId);
    if (!box) {
      setLabelEditor(null);
      return;
    }

    const conflictingLabel = labels.find(
      (label) =>
        label.name.toLowerCase() === name.toLowerCase() &&
        label.id !== box.labelId,
    );
    if (labelEditor.mode === "rename" && conflictingLabel) {
      setLabelEditor((current) =>
        current
          ? {
              ...current,
              error: `“${conflictingLabel.name}” already exists. Choose another name.`,
            }
          : current,
      );
      return;
    }

    setLabelEditor((current) =>
      current ? { ...current, isSaving: true, error: null } : current,
    );

    try {
      if (labelEditor.mode === "assign") {
        await onAssignBoxLabel(box.id, name);
      } else {
        await onRenameLabel(box.labelId, name);
      }
      setLabelEditor(null);
      setHighlightedLabelId(null);
    } catch (error) {
      setLabelEditor((current) =>
        current
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
      ) : loadFailed ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-sm font-medium">Could not load this image.</p>
          <p className="text-xs text-muted-foreground">
            The S3 link may have expired or the object may no longer be available.
          </p>
        </div>
      ) : !image ? (
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          Loading image...
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
                <Label
                  key={`label-${box.id}`}
                  x={box.x}
                  y={Math.max(box.y - 22, 0)}
                  onMouseDown={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDblClick={(event) => {
                    event.cancelBubble = true;
                    openRenameEditor(box);
                  }}
                >
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
            void submitLabelEditor(
              editorMode === "assign" ? highlightedLabel?.name : undefined,
            );
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="relative">
            <input
              ref={labelInputRef}
              value={labelEditor.value}
              readOnly={labelEditor.isSaving}
              aria-busy={labelEditor.isSaving}
              role={editorMode === "assign" ? "combobox" : undefined}
              aria-expanded={editorMode === "assign" ? true : undefined}
              aria-controls={
                editorMode === "assign"
                  ? `label-options-${labelEditor.boxId}`
                  : undefined
              }
              aria-activedescendant={
                editorMode === "assign" && highlightedLabelId
                  ? `label-option-${highlightedLabelId}`
                  : undefined
              }
              aria-label={
                editorMode === "assign" ? "Choose a label" : "Rename label"
              }
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
                if (editorMode === "rename") {
                  void submitLabelEditor();
                } else if (exactExistingLabel) {
                  void submitLabelEditor(exactExistingLabel.name);
                } else {
                  setLabelEditor(null);
                  setHighlightedLabelId(null);
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
                  setLabelEditor(null);
                  setHighlightedLabelId(null);
                }
              }}
            />
            {exactExistingLabel ? (
              <span
                className={cn(
                  "pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] font-medium",
                  hasRenameConflict ? "text-destructive" : "text-emerald-600",
                )}
              >
                {!hasRenameConflict ? <Check className="size-3" /> : null}
                {hasRenameConflict ? "Exists" : "Existing"}
              </span>
            ) : null}
          </div>
          {labelEditor.error ? (
            <p className="mt-1 rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground shadow">
              {labelEditor.error}
            </p>
          ) : null}
          {editorMode === "assign" ? (
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
                ↑↓ choose · Enter apply · Esc cancel
              </p>
            </div>
          ) : (
            <p
              className={cn(
                "mt-1 rounded-md border bg-background/95 px-2 py-1.5 text-[10px] shadow",
                hasRenameConflict
                  ? "border-destructive/50 text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {hasRenameConflict
                ? "That name is already used by another label."
                : "Renaming updates every box using this label."}
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}
