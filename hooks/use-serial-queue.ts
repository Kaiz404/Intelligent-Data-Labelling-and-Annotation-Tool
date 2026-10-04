"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Runs async tasks one at a time, in call order (e.g. saves that must not
 * overtake each other). A failed task does not stop the ones after it.
 */
export function useSerialQueue() {
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);

  const run = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    setPending((count) => count + 1);
    const result = tailRef.current.then(task);
    tailRef.current = result.catch(() => undefined);
    return result.finally(() => setPending((count) => count - 1));
  }, []);

  /** Resolves once every task queued so far has settled. */
  const settled = useCallback(
    () => tailRef.current.then(() => undefined),
    [],
  );

  return { run, settled, isBusy: pending > 0 };
}
