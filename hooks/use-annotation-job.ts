"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnnotationJobProgress,
  ImageAiState,
} from "@/lib/types/annotations";

const POLL_INTERVAL_MS = 2500;

type ProgressResponse = {
  job: AnnotationJobProgress;
  updates: Array<{ imageId: string } & ImageAiState>;
  serverTime: string;
};

function isActive(job: AnnotationJobProgress | null) {
  return job?.status === "queued" || job?.status === "running";
}

/**
 * Tracks the project's bulk AI run: starts runs, polls progress while one is
 * active, and keeps a per-image AI state map for the image grid. Polling also
 * keeps the server-side worker going (see GET /api/annotations/jobs/[jobId]).
 */
export function useAnnotationJob({
  initialJob,
  initialStates,
  onFinished,
}: {
  initialJob: AnnotationJobProgress | null;
  initialStates: Record<string, ImageAiState>;
  onFinished: () => void;
}) {
  const [job, setJob] = useState(initialJob);
  const [states, setStates] = useState(initialStates);
  const sinceRef = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Server refreshes (router.refresh) bring authoritative review counts.
  useEffect(() => {
    setStates(initialStates);
  }, [initialStates]);

  const jobId = job?.id;
  const active = isActive(job);

  useEffect(() => {
    if (!jobId || !active) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const query = sinceRef.current
          ? `?since=${encodeURIComponent(sinceRef.current)}`
          : "";
        const response = await fetch(`/api/annotations/jobs/${jobId}${query}`, {
          cache: "no-store",
        });
        if (!response.ok || cancelled) {
          return;
        }
        const body = (await response.json()) as ProgressResponse;
        if (cancelled) {
          return;
        }

        sinceRef.current = body.serverTime;
        setJob(body.job);
        if (body.updates.length > 0) {
          setStates((current) => {
            const next = { ...current };
            for (const { imageId, ...state } of body.updates) {
              next[imageId] = state;
            }
            return next;
          });
        }
        if (!isActive(body.job)) {
          onFinishedRef.current();
        }
      } catch {
        // Network blips are fine; the next tick retries.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, jobId]);

  const start = useCallback(
    async (input: {
      projectId: string;
      imageIds: string[];
      labelIds: string[];
      confidence: number;
    }) => {
      const response = await fetch("/api/annotations/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => null)) as
        | { jobId?: string; error?: string }
        | null;

      if (!response.ok || !body?.jobId) {
        throw new Error(body?.error ?? "Could not start the AI run.");
      }

      sinceRef.current = null;
      setJob({
        id: body.jobId,
        status: "queued",
        total: input.imageIds.length,
        counts: {
          queued: input.imageIds.length,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
        },
        pendingSuggestions: 0,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      });
      setStates((current) => {
        const next = { ...current };
        for (const imageId of input.imageIds) {
          next[imageId] = {
            status: "queued",
            pendingSuggestions: current[imageId]?.pendingSuggestions ?? 0,
          };
        }
        return next;
      });
    },
    [],
  );

  const cancel = useCallback(async () => {
    if (!jobId) {
      return;
    }
    const response = await fetch(`/api/annotations/jobs/${jobId}/cancel`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Could not cancel the AI run.");
    }
    setJob((current) =>
      current ? { ...current, status: "cancelled" } : current,
    );
    setStates((current) => {
      const next = { ...current };
      for (const [imageId, state] of Object.entries(current)) {
        if (state.status === "queued") {
          next[imageId] = { ...state, status: "cancelled" };
        }
      }
      return next;
    });
    onFinishedRef.current();
  }, [jobId]);

  return { job, states, isActive: active, start, cancel };
}
