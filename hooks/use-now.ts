"use client";

import { useEffect, useState } from "react";

/**
 * Server render time advanced by client-side elapsed time, re-rendering every
 * `intervalMs`. Anchoring to the server clock keeps relative times identical
 * between the server render and hydration, and immune to client clock skew.
 */
export function useNow(serverNow: number, intervalMs = 60_000) {
  const [tick, setTick] = useState({ base: serverNow, elapsed: 0 });
  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setTick({ base: serverNow, elapsed: Date.now() - startedAt }),
      intervalMs,
    );
    return () => window.clearInterval(id);
  }, [intervalMs, serverNow]);
  return serverNow + (tick.base === serverNow ? tick.elapsed : 0);
}
