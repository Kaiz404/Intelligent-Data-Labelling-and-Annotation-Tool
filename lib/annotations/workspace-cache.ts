import type { ImageSuggestionSet } from "@/lib/types/annotations";

/**
 * Client-side cache behind instant image switching in the annotation
 * workspace (one per workspace instance): pending AI suggestions per image,
 * and warmed image bytes for images the user is likely to open next.
 */
export function createWorkspaceCache(
  loadSuggestionSets: (imageId: string) => Promise<ImageSuggestionSet[]>,
) {
  const suggestions = new Map<string, Promise<ImageSuggestionSet[]>>();
  const warmed = new Set<string>();
  // Keeps warming images reachable until their bytes have arrived.
  const loading = new Set<HTMLImageElement>();

  return {
    /**
     * Pending suggestions for an image. `version` is the image's AI state
     * (see `aiStateVersion`): a newer AI result changes it, so it is fetched
     * again. Failed loads are forgotten, so the next call retries.
     */
    loadSuggestions(imageId: string, version: string) {
      const key = `${imageId}@${version}`;
      let entry = suggestions.get(key);
      if (!entry) {
        entry = loadSuggestionSets(imageId);
        suggestions.set(key, entry);
        entry.catch(() => suggestions.delete(key));
      }
      return entry;
    },

    forgetSuggestions(imageId: string, version: string) {
      suggestions.delete(`${imageId}@${version}`);
    },

    /** Starts downloading an image into the browser cache (once per URL). */
    warmImage(url: string | null) {
      if (!url || warmed.has(url)) return;
      warmed.add(url);
      const image = new Image();
      image.decoding = "async";
      image.onload = image.onerror = () => loading.delete(image);
      loading.add(image);
      image.src = url;
    },
  };
}

export type WorkspaceCache = ReturnType<typeof createWorkspaceCache>;
