// node --test lib/annotations/editor.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as dataset-labels.test.mjs.
function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    throw new Error(`Unexpected dependency: ${name}`);
  }, compiled.exports);
  return compiled.exports;
}

const editor = load("./editor.ts");
const {
  acceptAllSuggestions,
  acceptSuggestion,
  acceptedBoxes,
  addBox,
  editorReducer,
  hasUnsavedBoxes,
  openEditor,
  planSave,
  rejectAllSuggestions,
  removeBox,
  replaceBoxes,
  sessionsReducer,
  updateBox,
} = editor;

const box = (id, x = 0, labelId = "cat") => ({ id, labelId, x, y: 0, width: 10, height: 10 });
const suggestion = (id, x = 0) => ({ ...box(id, x), confidence: 0.9 });
const LABELS = new Set(["cat"]);

function apply(state, ...actions) {
  return actions.reduce(editorReducer, state);
}
const commit = (update) => ({ type: "commit", update });
const sync = (sets) => ({ type: "syncSuggestions", sets, labelIds: LABELS });

test("a freshly opened editor has nothing to save; a restored draft saves", () => {
  assert.equal(planSave(openEditor([box("a")])), null);
  const plan = planSave(openEditor([box("a")], [box("a"), box("b")]));
  assert.deepEqual(plan.boxes.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(plan.resolutions, []);
});

test("loading suggestions shows them as pending without making the editor dirty", () => {
  const state = apply(openEditor([box("a")]), sync([{ itemId: "item", suggestions: [suggestion("s1"), suggestion("s2")] }]));
  assert.deepEqual(state.present.boxes.map((item) => item.id), ["a", "s1", "s2"]);
  assert.deepEqual(acceptedBoxes(state.present).map((item) => item.id), ["a"]);
  assert.equal(planSave(state), null);
});

test("suggestions with labels unknown here are neither shown nor resolved", () => {
  const foreign = { ...suggestion("dog"), labelId: "dog" };
  const state = apply(openEditor([]), sync([{ itemId: "item", suggestions: [suggestion("s1"), foreign] }]), commit(rejectAllSuggestions));
  assert.deepEqual(state.present.boxes, []);
  const plan = planSave(state);
  assert.deepEqual(plan.resolutions, [{ itemId: "item", remaining: [foreign] }]);
  assert.equal(plan.clearsReview, false);
});

test("accepting and rejecting resolve suggestions; the save clears the review", () => {
  const state = apply(
    openEditor([]),
    sync([{ itemId: "item", suggestions: [suggestion("s1"), suggestion("s2")] }]),
    commit(acceptSuggestion("s1")),
    commit(removeBox("s2")),
  );
  const plan = planSave(state);
  assert.deepEqual(plan.boxes.map((item) => item.id), ["s1"]);
  assert.deepEqual(plan.resolutions, [{ itemId: "item", remaining: [] }]);
  assert.equal(plan.clearsReview, true);

  const saved = editorReducer(state, { type: "saved", plan });
  assert.equal(planSave(saved), null);
});

test("moving a suggestion accepts it; undo restores it as a suggestion", () => {
  const loaded = apply(openEditor([]), sync([{ itemId: "item", suggestions: [suggestion("s1")] }]));
  const moved = editorReducer(loaded, commit(replaceBoxes([box("s1", 5)])));
  assert.deepEqual(acceptedBoxes(moved.present).map((item) => item.id), ["s1"]);
  const undone = editorReducer(moved, { type: "undo" });
  assert.deepEqual(acceptedBoxes(undone.present), []);
  assert.equal(planSave(undone), null);
});

test("a newer server state drops cleared suggestions everywhere and adds new ones to history too", () => {
  const first = apply(
    openEditor([]),
    sync([{ itemId: "item", suggestions: [suggestion("s1"), suggestion("s2")] }]),
    commit(acceptSuggestion("s1")),
  );
  // A newer run cleared s1 and s2 and produced s3.
  const next = editorReducer(first, sync([{ itemId: "item2", suggestions: [suggestion("s3")] }]));
  // s1 was accepted here, so it stays a box; s2 was still pending, so it goes.
  assert.deepEqual(next.present.boxes.map((item) => item.id), ["s1", "s3"]);
  assert.deepEqual(acceptedBoxes(next.present).map((item) => item.id), ["s1"]);
  // Undo must neither remove s3 (that would save as a rejection) nor restore
  // s2; s1 stays the accepted box the present has.
  const undone = editorReducer(next, { type: "undo" });
  assert.deepEqual(undone.present.boxes.map((item) => item.id), ["s1", "s3"]);
  assert.deepEqual(acceptedBoxes(undone.present).map((item) => item.id), ["s1"]);
});

test("resyncing the same suggestions never re-adds ones resolved here", () => {
  const sets = [{ itemId: "item", suggestions: [suggestion("s1")] }];
  const rejected = apply(openEditor([]), sync(sets), commit(removeBox("s1")));
  const resynced = editorReducer(rejected, sync(sets));
  assert.deepEqual(resynced.present.boxes, []);
  assert.equal(resynced.present, rejected.present);
});

test("the review card re-expands only when an unseen suggestion appears", () => {
  const loaded = apply(openEditor([]), sync([{ itemId: "item", suggestions: [suggestion("s1")] }]), { type: "setReviewCard", view: "dismissed" });
  assert.equal(editorReducer(loaded, commit(acceptAllSuggestions)).reviewCard, "dismissed");
  const restored = apply(loaded, commit(rejectAllSuggestions), { type: "setReviewCard", view: "collapsed" }, { type: "undo" });
  assert.equal(restored.reviewCard, "expanded");
});

test("sessions open once per image and edits only touch their image", () => {
  let sessions = sessionsReducer({}, { type: "open", imageId: "one", editor: openEditor([box("a")]) });
  const opened = sessions;
  sessions = sessionsReducer(sessions, { type: "open", imageId: "one", editor: openEditor([]) });
  assert.equal(sessions, opened);
  sessions = sessionsReducer(sessions, { type: "edit", imageId: "two", action: { type: "undo" } });
  assert.equal(sessions, opened);
  sessions = sessionsReducer(sessions, { type: "edit", imageId: "one", action: commit(removeBox("a")) });
  assert.deepEqual(sessions.one.present.boxes, []);
});

test("drawing a box is one undo step: confirming its label or a drag back in place adds none", () => {
  const drawn = editorReducer(openEditor([]), commit(addBox(box("a"))));
  assert.equal(drawn.past.length, 1);
  // The label picker confirms the label the box was drawn with.
  const confirmed = editorReducer(drawn, commit(updateBox("a", { labelId: "cat" })));
  assert.equal(confirmed, drawn);
  // A drag that ends where it started.
  const dragged = editorReducer(drawn, commit(replaceBoxes([box("a")])));
  assert.equal(dragged, drawn);
  const undone = editorReducer(drawn, { type: "undo" });
  assert.deepEqual(undone.present.boxes, []);
  assert.equal(planSave(undone), null);
});

test("a real relabel is undoable, redo replays it, and a new edit clears redo", () => {
  const relabelled = apply(openEditor([box("a")]), commit(updateBox("a", { labelId: "dog" })));
  assert.equal(relabelled.present.boxes[0].labelId, "dog");
  const undone = editorReducer(relabelled, { type: "undo" });
  assert.equal(undone.present.boxes[0].labelId, "cat");
  const redone = editorReducer(undone, { type: "redo" });
  assert.equal(redone.present.boxes[0].labelId, "dog");
  // A new edit after undo clears the redo stack.
  const branched = editorReducer(undone, commit(replaceBoxes([box("a", 7)])));
  assert.deepEqual(branched.future, []);
});

test("confirming a suggestion's own label still accepts it", () => {
  const loaded = apply(openEditor([]), sync([{ itemId: "item", suggestions: [suggestion("s1")] }]));
  const accepted = editorReducer(loaded, commit(updateBox("s1", { labelId: "cat" })));
  assert.deepEqual(acceptedBoxes(accepted.present).map((item) => item.id), ["s1"]);
});

test("adding a box with an existing ID is a no-op", () => {
  const state = openEditor([box("a")]);
  assert.equal(editorReducer(state, commit(addBox(box("a", 3)))), state);
});

test("hasUnsavedBoxes tracks accepted boxes against the server copy", () => {
  const state = openEditor([box("a")]);
  assert.equal(hasUnsavedBoxes(state), false);
  const edited = editorReducer(state, commit(addBox(box("b"))));
  assert.equal(hasUnsavedBoxes(edited), true);
  const saved = editorReducer(edited, { type: "saved", plan: planSave(edited) });
  assert.equal(hasUnsavedBoxes(saved), false);
  // Pending suggestions are not unsaved boxes.
  const withSuggestion = editorReducer(saved, sync([{ itemId: "item", suggestions: [suggestion("s1")] }]));
  assert.equal(hasUnsavedBoxes(withSuggestion), false);
});
