import type {
  AnnotationSuggestion,
  BoundingBox,
  ImageSuggestionSet,
} from "@/lib/types/annotations";

/**
 * The annotation editor for one image: undoable boxes, which of them are
 * unreviewed AI suggestions, and a mirror of what the server holds, so a save
 * is the diff between the two. The workspace keeps one editor per opened
 * image (`sessionsReducer`), so switching back to an image restores its undo
 * history. Everything here is pure (StrictMode double-invokes reducers).
 */

const MAX_HISTORY = 50;

/** Offset (image pixels) applied to a duplicated box so it does not hide its source. */
const DUPLICATE_OFFSET = 12;

/**
 * Boxes that are AI suggestions not yet accepted. `itemId` is the bulk job
 * item they came from, or null for single-image AI Annotate results (which
 * only live in this editor until accepted).
 */
export type SuggestionMeta = Record<
  string,
  { itemId: string | null; confidence: number }
>;

/**
 * One undo step. Boxes are snapshotted together with which of them are
 * pending suggestions, so undoing an edit that accepted a suggestion also
 * restores it as a suggestion.
 */
export type EditorSnapshot = { boxes: BoundingBox[]; meta: SuggestionMeta };

export type ReviewCardView = "expanded" | "collapsed" | "dismissed";

/** Still-pending suggestions of one bulk job item, for `resolveSuggestions`. */
export type SuggestionResolution = {
  itemId: string;
  remaining: AnnotationSuggestion[];
};

export type ImageEditor = {
  present: EditorSnapshot;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  /** Accepted boxes as the server last stored them. */
  savedBoxes: BoundingBox[];
  /** Pending bulk-AI suggestions per job item as the server last reported them; null until loaded. */
  serverSets: ImageSuggestionSet[] | null;
  /** Server suggestion IDs ever shown here: never re-added, and only these can be rejected here. */
  shown: ReadonlySet<string>;
  reviewCard: ReviewCardView;
};

export type EditorAction =
  /** Push an undo step; an update returning `present` unchanged is a no-op. */
  | { type: "commit"; update: (present: EditorSnapshot) => EditorSnapshot }
  | { type: "undo" }
  | { type: "redo" }
  /** Merge the server's pending suggestions (first load, or a newer AI run). */
  | {
      type: "syncSuggestions";
      sets: ImageSuggestionSet[];
      /** Suggestions with other labels stay untouched on the server. */
      labelIds: ReadonlySet<string>;
    }
  /** A save went through: the server now holds what the plan wrote. */
  | { type: "saved"; plan: SavePlan }
  | { type: "setReviewCard"; view: ReviewCardView };

/** What a save must write; see `planSave`. */
export type SavePlan = {
  /** Accepted boxes to store, or null when the server copy is current. */
  boxes: BoundingBox[] | null;
  /** Job items whose pending suggestions changed here. */
  resolutions: SuggestionResolution[];
  /** Once saved, no server suggestions are left to review on this image. */
  clearsReview: boolean;
};

/** `boxes` defaults to the saved boxes; pass a local draft to restore it (it then saves). */
export function openEditor(
  savedBoxes: BoundingBox[],
  boxes: BoundingBox[] = savedBoxes,
): ImageEditor {
  return {
    present: { boxes, meta: {} },
    past: [],
    future: [],
    savedBoxes,
    serverSets: null,
    shown: new Set(),
    reviewCard: "expanded",
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Only accepted boxes are real annotations: saved, exported and backed up. */
export function acceptedBoxes({ boxes, meta }: EditorSnapshot) {
  return boxes.filter((box) => !meta[box.id]);
}

/** Pending suggestions in drawing order (the review card numbers them so). */
export function pendingSuggestions({
  boxes,
  meta,
}: EditorSnapshot): AnnotationSuggestion[] {
  return boxes.flatMap((box) =>
    meta[box.id] ? [{ ...box, confidence: meta[box.id].confidence }] : [],
  );
}

export function hasServerSuggestions(sets: ImageSuggestionSet[] | null) {
  return Boolean(sets?.some((set) => set.suggestions.length > 0));
}

/** What saving this editor would write, or null when the server is current. `force` rewrites the boxes anyway (the Save button). */
export function planSave(
  editor: ImageEditor,
  { force = false } = {},
): SavePlan | null {
  const accepted = acceptedBoxes(editor.present);
  const boxes = force || !sameBoxes(accepted, editor.savedBoxes) ? accepted : null;
  const resolutions = changedResolutions(editor);
  if (!boxes && resolutions.length === 0) return null;
  return {
    boxes,
    resolutions,
    clearsReview:
      resolutions.length > 0 &&
      !hasServerSuggestions(applyResolutions(editor.serverSets, resolutions)),
  };
}

/**
 * Job items whose pending list differs from the server's. Only suggestions
 * resolved here are removed: accepted (box kept, no longer pending) or shown
 * here and then rejected. Server suggestions never shown here (their label is
 * unknown locally) are passed through as-is.
 */
function changedResolutions(editor: ImageEditor): SuggestionResolution[] {
  if (!editor.serverSets) return [];
  const { boxes, meta } = editor.present;
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  return editor.serverSets.flatMap((set) => {
    const remaining = set.suggestions.flatMap((suggestion) => {
      const box = boxById.get(suggestion.id);
      const entry = meta[suggestion.id];
      // Still pending here: persist local edits (e.g. a relabel).
      if (box && entry) return [{ ...box, confidence: entry.confidence }];
      if (box || editor.shown.has(suggestion.id)) return [];
      return [suggestion];
    });
    return sameSuggestions(remaining, set.suggestions)
      ? []
      : [{ itemId: set.itemId, remaining }];
  });
}

function applyResolutions(
  sets: ImageSuggestionSet[] | null,
  resolutions: SuggestionResolution[],
) {
  if (!sets || resolutions.length === 0) return sets;
  const remaining = new Map(
    resolutions.map((resolution) => [resolution.itemId, resolution.remaining]),
  );
  return sets.map((set) => ({
    itemId: set.itemId,
    suggestions: remaining.get(set.itemId) ?? set.suggestions,
  }));
}

// Field-wise: jsonb reorders object keys, so JSON text cannot be compared.
function sameBox(first: BoundingBox, second: BoundingBox) {
  return (
    first.id === second.id &&
    first.labelId === second.labelId &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function sameBoxes(first: BoundingBox[], second: BoundingBox[]) {
  return (
    first.length === second.length &&
    first.every((box, index) => sameBox(box, second[index]))
  );
}

function sameSuggestions(
  first: AnnotationSuggestion[],
  second: AnnotationSuggestion[],
) {
  return (
    first.length === second.length &&
    first.every(
      (suggestion, index) =>
        sameBox(suggestion, second[index]) &&
        suggestion.confidence === second[index].confidence,
    )
  );
}

function pendingIds({ boxes, meta }: EditorSnapshot) {
  return boxes.filter((box) => meta[box.id]).map((box) => box.id);
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

export function editorReducer(
  state: ImageEditor,
  action: EditorAction,
): ImageEditor {
  const next = reduce(state, action);
  // Re-expand the review card whenever a suggestion it has not listed
  // appears (a new AI run, or undo restoring one).
  if (next.present === state.present || next.reviewCard === "expanded") {
    return next;
  }
  const before = new Set(pendingIds(state.present));
  return pendingIds(next.present).some((id) => !before.has(id))
    ? { ...next, reviewCard: "expanded" }
    : next;
}

function reduce(state: ImageEditor, action: EditorAction): ImageEditor {
  switch (action.type) {
    case "commit": {
      const present = action.update(state.present);
      if (present === state.present) return state;
      return {
        ...state,
        present,
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        future: [],
      };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      return {
        ...state,
        present: state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [state.present, ...state.future].slice(0, MAX_HISTORY),
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [present, ...future] = state.future;
      return {
        ...state,
        present,
        past: [...state.past, state.present].slice(-MAX_HISTORY),
        future,
      };
    }
    case "syncSuggestions":
      return syncSuggestions(state, action.sets, action.labelIds);
    case "saved":
      return {
        ...state,
        savedBoxes: action.plan.boxes ?? state.savedBoxes,
        serverSets: applyResolutions(state.serverSets, action.plan.resolutions),
      };
    case "setReviewCard":
      return state.reviewCard === action.view
        ? state
        : { ...state, reviewCard: action.view };
  }
}

function syncSuggestions(
  state: ImageEditor,
  sets: ImageSuggestionSet[],
  labelIds: ReadonlySet<string>,
): ImageEditor {
  const { present } = state;
  const presentIds = new Set(present.boxes.map((box) => box.id));
  const shown = new Set(state.shown);
  const serverIds = new Set<string>();
  const additions: BoundingBox[] = [];
  const additionMeta: SuggestionMeta = {};
  for (const set of sets) {
    for (const { confidence, ...box } of set.suggestions) {
      serverIds.add(box.id);
      // Never re-add one already shown (still here, or accepted/rejected
      // here, possibly unsaved), one already accepted as a box, or one whose
      // label is unknown here.
      if (
        shown.has(box.id) ||
        presentIds.has(box.id) ||
        !labelIds.has(box.labelId)
      ) {
        continue;
      }
      shown.add(box.id);
      additionMeta[box.id] = { itemId: set.itemId, confidence };
      additions.push(box);
    }
  }

  // Bulk suggestions the server no longer has (resolved here and saved, or
  // cleared by a newer run). Single-image results (itemId null) are local
  // only and never stale.
  const staleIds = (snapshot: EditorSnapshot) =>
    Object.keys(snapshot.meta).filter(
      (id) => snapshot.meta[id].itemId !== null && !serverIds.has(id),
    );
  // Still pending in the present: cleared by the server, so dropped.
  const dropped = new Set(staleIds(present).filter((id) => presentIds.has(id)));

  // Patch undo/redo snapshots too, so undo never removes a new suggestion
  // (which auto-save would persist as a rejection) or restores a stale one.
  // A stale entry whose box the present keeps as an accepted box stays a
  // (now accepted) box in history; otherwise the box goes too.
  const patch = (snapshot: EditorSnapshot): EditorSnapshot => {
    const stale = staleIds(snapshot);
    if (stale.length === 0 && additions.length === 0) return snapshot;
    const removed = new Set(
      stale.filter((id) => dropped.has(id) || !presentIds.has(id)),
    );
    const kept =
      removed.size > 0
        ? snapshot.boxes.filter((box) => !removed.has(box.id))
        : snapshot.boxes;
    const ids = new Set(kept.map((box) => box.id));
    const meta = { ...snapshot.meta };
    for (const id of stale) delete meta[id];
    const added = additions.filter((box) => !ids.has(box.id));
    for (const box of added) meta[box.id] = additionMeta[box.id];
    return { boxes: [...kept, ...added], meta };
  };

  return {
    ...state,
    present: patch(present),
    past: state.past.map(patch),
    future: state.future.map(patch),
    serverSets: sets,
    shown,
  };
}

/** One editor per opened image, keyed by image ID. */
export type EditorSessions = Readonly<Record<string, ImageEditor>>;

export type SessionAction =
  | { type: "open"; imageId: string; editor: ImageEditor }
  | { type: "edit"; imageId: string; action: EditorAction };

export function sessionsReducer(
  sessions: EditorSessions,
  action: SessionAction,
): EditorSessions {
  const current = sessions[action.imageId];
  if (action.type === "open") {
    return current ? sessions : { ...sessions, [action.imageId]: action.editor };
  }
  if (!current) return sessions;
  const next = editorReducer(current, action.action);
  return next === current ? sessions : { ...sessions, [action.imageId]: next };
}

// ---------------------------------------------------------------------------
// Edits: `commit` updates. Each returns `present` unchanged when it is a no-op.
// ---------------------------------------------------------------------------

function withoutSuggestion(meta: SuggestionMeta, boxId: string) {
  if (!meta[boxId]) return meta;
  const next = { ...meta };
  delete next[boxId];
  return next;
}

function sameGeometry(first: BoundingBox, second: BoundingBox) {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

type Edit = (present: EditorSnapshot) => EditorSnapshot;

/** The canvas's new box list. Moving or resizing a suggestion accepts it. */
export function replaceBoxes(next: BoundingBox[]): Edit {
  return (present) => {
    const previousById = new Map(present.boxes.map((box) => [box.id, box]));
    let meta = present.meta;
    for (const box of next) {
      const previous = previousById.get(box.id);
      if (previous && meta[box.id] && !sameGeometry(previous, box)) {
        meta = withoutSuggestion(meta, box.id);
      }
    }
    return { boxes: next, meta };
  };
}

/** Editing a box's label or coordinates; on a suggestion this accepts it. */
export function updateBox(
  boxId: string,
  patch: Partial<Pick<BoundingBox, "labelId" | "x" | "y" | "width" | "height">>,
): Edit {
  return (present) =>
    present.boxes.some((box) => box.id === boxId)
      ? {
          boxes: present.boxes.map((box) =>
            box.id === boxId ? { ...box, ...patch } : box,
          ),
          meta: withoutSuggestion(present.meta, boxId),
        }
      : present;
}

/** Review card relabel: unlike `updateBox`, the box stays a pending suggestion. */
export function relabelSuggestion(boxId: string, labelId: string): Edit {
  return (present) => {
    const target = present.boxes.find((box) => box.id === boxId);
    if (!target || target.labelId === labelId) return present;
    return {
      boxes: present.boxes.map((box) =>
        box.id === boxId ? { ...box, labelId } : box,
      ),
      meta: present.meta,
    };
  };
}

/** Deleting a suggestion rejects it; undo brings it back as a suggestion. */
export function removeBox(boxId: string): Edit {
  return (present) =>
    present.boxes.some((box) => box.id === boxId)
      ? {
          boxes: present.boxes.filter((box) => box.id !== boxId),
          meta: present.meta,
        }
      : present;
}

export function acceptSuggestion(boxId: string): Edit {
  return (present) =>
    present.meta[boxId]
      ? { boxes: present.boxes, meta: withoutSuggestion(present.meta, boxId) }
      : present;
}

export const acceptAllSuggestions: Edit = (present) =>
  pendingIds(present).length > 0 ? { boxes: present.boxes, meta: {} } : present;

export const rejectAllSuggestions: Edit = (present) =>
  pendingIds(present).length > 0
    ? {
        boxes: present.boxes.filter((box) => !present.meta[box.id]),
        meta: present.meta,
      }
    : present;

/** Single-image AI results join as suggestions, so auto-save never persists unreviewed predictions. */
export function addSuggestions(detected: AnnotationSuggestion[]): Edit {
  return (present) => {
    if (detected.length === 0) return present;
    const meta = { ...present.meta };
    const boxes = detected.map(({ confidence, ...box }) => {
      meta[box.id] = { itemId: null, confidence };
      return box;
    });
    return { boxes: [...present.boxes, ...boxes], meta };
  };
}

export type LayerMove = "front" | "forward" | "back" | "backward";

/** Move a box within the drawing order (later = drawn on top). */
export function moveLayer(boxId: string, move: LayerMove | number): Edit {
  return (present) => {
    const currentIndex = present.boxes.findIndex((box) => box.id === boxId);
    if (currentIndex < 0) return present;
    const next = [...present.boxes];
    const [box] = next.splice(currentIndex, 1);
    const target =
      typeof move === "number"
        ? move
        : move === "front"
          ? next.length
          : move === "back"
            ? 0
            : move === "forward"
              ? currentIndex + 1
              : currentIndex - 1;
    const index = Math.min(Math.max(target, 0), next.length);
    if (index === currentIndex) return present;
    next.splice(index, 0, box);
    return { boxes: next, meta: present.meta };
  };
}

/**
 * Position for a duplicated box along one axis: offset forward, or backward
 * when that would leave the image (`limit` is unknown until it loads).
 */
function duplicateOffset(start: number, size: number, limit: number | null) {
  const forward = start + DUPLICATE_OFFSET;
  if (limit === null || forward + size <= limit) return forward;
  return Math.min(Math.max(start - DUPLICATE_OFFSET, 0), Math.max(limit - size, 0));
}

/**
 * The copy is a new accepted box placed directly above its source (drawn on
 * top of it) and kept inside the image.
 */
export function duplicateBox(
  boxId: string,
  copyId: string,
  imageSize: { width: number; height: number } | null,
): Edit {
  return (present) => {
    const index = present.boxes.findIndex((box) => box.id === boxId);
    if (index < 0) return present;
    const source = present.boxes[index];
    const copy: BoundingBox = {
      ...source,
      id: copyId,
      x: duplicateOffset(source.x, source.width, imageSize?.width ?? null),
      y: duplicateOffset(source.y, source.height, imageSize?.height ?? null),
    };
    const next = [...present.boxes];
    next.splice(index + 1, 0, copy);
    return { boxes: next, meta: present.meta };
  };
}
