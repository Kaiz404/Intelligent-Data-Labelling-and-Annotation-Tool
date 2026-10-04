"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/** How long a fullscreen request may stay unresolved before the overlay fallback. */
const FULLSCREEN_FALLBACK_MS = 400;

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function getIsDocumentFullscreen() {
  return document.documentElement === document.fullscreenElement;
}

function getIsDocumentFullscreenOnServer() {
  return false;
}

/**
 * Full screen for a workspace. It targets the whole document rather than the
 * workspace element: Radix menus, selects, dialogs and sheets portal into
 * <body>, so they would be hidden behind a fullscreen element. The caller
 * instead covers the viewport with a fixed overlay while `isFullscreen`.
 * When the Fullscreen API is unavailable or refused, only the overlay is
 * used (`isOverlayOnly`; Escape is then the caller's to handle).
 */
export function useFullscreen() {
  const isDocumentFullscreen = useSyncExternalStore(
    subscribe,
    getIsDocumentFullscreen,
    getIsDocumentFullscreenOnServer,
  );
  const [isOverlay, setIsOverlay] = useState(false);
  const isFullscreen = isDocumentFullscreen || isOverlay;

  const toggle = useCallback(() => {
    if (isFullscreen) {
      setIsOverlay(false);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
      return;
    }
    const root = document.documentElement;
    if (!document.fullscreenEnabled || typeof root.requestFullscreen !== "function") {
      setIsOverlay(true);
      return;
    }
    // Some embedded browsers neither enter fullscreen nor reject the request
    // (or enter and immediately leave). If the document is not fullscreen
    // shortly after asking, fill the viewport with the overlay instead.
    const fallbackTimer = window.setTimeout(() => {
      if (document.fullscreenElement !== root) setIsOverlay(true);
    }, FULLSCREEN_FALLBACK_MS);
    root.requestFullscreen().catch(() => {
      window.clearTimeout(fallbackTimer);
      setIsOverlay(true);
    });
  }, [isFullscreen]);

  const exitOverlay = useCallback(() => setIsOverlay(false), []);

  return {
    isFullscreen,
    isOverlayOnly: isOverlay && !isDocumentFullscreen,
    toggle,
    exitOverlay,
  };
}
