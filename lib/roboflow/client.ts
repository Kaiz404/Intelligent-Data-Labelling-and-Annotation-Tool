import "server-only";

import { getRoboflowConfig, RoboflowError } from "@/lib/roboflow/config";

/**
 * A single zero-shot detection from the shared gateway workflow. Coordinates
 * are center-based absolute pixels (Roboflow's native format) — callers
 * convert with `fromCenterPixelBox` from `lib/annotations/formats.ts`.
 */
export type RoboflowDetection = {
  className: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoboflowDetectionResult = {
  image: { width: number; height: number };
  detections: RoboflowDetection[];
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Runs the shared multi-tenant zero-shot workflow (`gateway-zero-shot-detect`)
 * against one image. `classNames` is this project's own label list — no
 * Roboflow project/dataset is created or written to; the image is used only
 * for this one inference call.
 */
export async function detectImage(input: {
  imageUrl: string;
  classNames: string[];
  confidence?: number;
  signal?: AbortSignal;
}): Promise<RoboflowDetectionResult> {
  const config = getRoboflowConfig();

  if (input.classNames.length === 0) {
    throw new RoboflowError(
      "Select at least one label to run AI annotation.",
      400,
    );
  }

  const url = `${config.apiUrl.replace(/\/$/, "")}/${config.workspace}/workflows/${config.workflowId}`;
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.apiKey,
        inputs: {
          image: { type: "url", value: input.imageUrl },
          class_names: input.classNames,
          confidence: input.confidence ?? config.defaultConfidence,
        },
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RoboflowError("AI annotation timed out.", 504);
    }
    throw new RoboflowError("Could not reach the AI annotation service.", 502);
  }

  if (!response.ok) {
    throw new RoboflowError(
      `AI annotation service returned an error (${response.status}).`,
      502,
    );
  }

  const body: unknown = await response.json();
  return parseWorkflowResponse(body);
}

function parseWorkflowResponse(body: unknown): RoboflowDetectionResult {
  const outputs = isRecord(body) ? body.outputs : undefined;
  const firstOutput = Array.isArray(outputs) ? outputs[0] : undefined;
  const predictions = isRecord(firstOutput) ? firstOutput.predictions : undefined;

  if (!isRecord(predictions)) {
    throw new RoboflowError(
      "AI annotation service returned an unexpected response.",
      502,
    );
  }

  const image = predictions.image;
  if (
    !isRecord(image) ||
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    (image.width as number) <= 0 ||
    (image.height as number) <= 0
  ) {
    throw new RoboflowError(
      "AI annotation service returned an invalid image size.",
      502,
    );
  }

  const rawPredictions = Array.isArray(predictions.predictions)
    ? predictions.predictions
    : [];

  const detections: RoboflowDetection[] = [];
  for (const raw of rawPredictions) {
    if (
      !isRecord(raw) ||
      typeof raw.class !== "string" ||
      !Number.isFinite(raw.x) ||
      !Number.isFinite(raw.y) ||
      !Number.isFinite(raw.width) ||
      !Number.isFinite(raw.height) ||
      !Number.isFinite(raw.confidence) ||
      (raw.width as number) <= 0 ||
      (raw.height as number) <= 0
    ) {
      // Skip structurally invalid predictions rather than fail the whole request.
      continue;
    }

    detections.push({
      className: raw.class,
      confidence: raw.confidence as number,
      x: raw.x as number,
      y: raw.y as number,
      width: raw.width as number,
      height: raw.height as number,
    });
  }

  return {
    image: { width: image.width as number, height: image.height as number },
    detections,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
