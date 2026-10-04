"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * List controls (search, sort, filters, tabs) kept in the URL query, so a
 * revisit, refresh or Back restores them. Values equal to their default stay
 * out of the URL. Updates use `replaceState`, which Next syncs into
 * `useSearchParams` without a server request. Pass a module-level `defaults`
 * object; callers validate the values they read.
 */
export function useQueryParams<const T extends Record<string, string>>(
  defaults: T,
) {
  const searchParams = useSearchParams();
  const values = { ...defaults } as Record<keyof T, string>;
  for (const key in defaults) {
    values[key] = searchParams.get(key) ?? defaults[key];
  }

  const update = useCallback(
    (patch: Partial<Record<keyof T, string>>) => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === defaults[key]) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      try {
        window.history.replaceState(
          null,
          "",
          query ? `?${query}` : window.location.pathname,
        );
      } catch {
        // Safari throttles history updates; skipping one only loses persistence.
      }
    },
    [defaults],
  );

  return [values, update] as const;
}
