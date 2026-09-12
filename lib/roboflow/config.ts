import "server-only";

export class RoboflowError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function getRoboflowConfig() {
  const apiKey = process.env.ROBOFLOW_API_KEY;
  const apiUrl = process.env.ROBOFLOW_API_URL;
  const workspace = process.env.ROBOFLOW_WORKSPACE;
  const workflowId = process.env.ROBOFLOW_WORKFLOW_ID;
  const confidence = Number(process.env.ROBOFLOW_CONFIDENCE ?? "0.4");

  if (!apiKey || !apiUrl || !workspace || !workflowId) {
    throw new RoboflowError(
      "AI annotation is not configured. Set ROBOFLOW_API_KEY, ROBOFLOW_API_URL, ROBOFLOW_WORKSPACE, and ROBOFLOW_WORKFLOW_ID.",
      503,
    );
  }

  return {
    apiKey,
    apiUrl,
    workspace,
    workflowId,
    defaultConfidence: Number.isFinite(confidence) ? confidence : 0.4,
  };
}
