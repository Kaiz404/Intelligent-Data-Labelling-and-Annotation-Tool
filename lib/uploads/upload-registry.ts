type Subscribable = { subscribe(listener: () => void): () => void };

export type UploadRegistryEntry<Store> = {
  projectId: string;
  projectName: string;
  store: Store;
};

/**
 * One upload queue per project for the whole signed-in shell, created the
 * first time a project asks for it, so its uploads outlive the page.
 */
export function createUploadRegistry<Store extends Subscribable>(
  createStore: (projectId: string) => Store,
) {
  const byProject = new Map<string, UploadRegistryEntry<Store>>();
  let entries: readonly UploadRegistryEntry<Store>[] = [];
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    /** Safe during render: a new entry is announced in a microtask. */
    get(projectId: string, projectName: string): Store {
      const existing = byProject.get(projectId);
      if (existing) return existing.store;
      const entry = { projectId, projectName, store: createStore(projectId) };
      byProject.set(projectId, entry);
      entries = [...entries, entry];
      entry.store.subscribe(notify);
      queueMicrotask(notify);
      return entry.store;
    },

    getEntries: () => entries,

    /** Fires when a project is added and whenever any queue changes. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type UploadRegistry<Store extends Subscribable> = ReturnType<
  typeof createUploadRegistry<Store>
>;
