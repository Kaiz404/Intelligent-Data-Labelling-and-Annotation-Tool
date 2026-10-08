// node --test lib/uploads/dataset-import.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./dataset-import.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function plan(count = 1) {
  return {
    annotationPath: "annotations.json",
    categories: [{ id: "old", name: "Cat" }, { id: "new", name: "Dog" }],
    images: Array.from({ length: count }, (_, index) => ({
      id: String(index), path: `${index}.png`, archivePath: `images/${index}.png`,
      file: new File(["fixture"], `${index}.png`, { type: "image/png" }), width: 20, height: 20,
      boxes: [
        { id: "source-1", categoryId: "old", x: 1, y: 2, width: 3, height: 4 },
        { id: "source-2", categoryId: "new", x: 5, y: 6, width: 7, height: 8 },
      ],
    })),
  };
}
function setup(overrides = {}) {
  const states = [], uploads = [], saves = [], resolutions = [];
  const dependencies = {
    "@/lib/actions/labels": {
      resolveDatasetLabels: async (...args) => {
        resolutions.push(args);
        return overrides.resolve ? overrides.resolve(...args) : [
          { categoryId: "old", labelId: "existing-label" },
          { categoryId: "new", labelId: "created-label" },
        ];
      },
    },
    "@/lib/actions/annotations": {
      saveImageAnnotations: async (...args) => { saves.push(args); return overrides.save?.(...args); },
    },
    "@/lib/format": { dateFormatter: { format: () => "formatted date" } },
    "@/lib/uploads/types": { DEFAULT_MAX_CONCURRENT_FILES: 3 },
    "@/lib/uploads/uploader": {
      createUploadProvider: () => ({
        async upload(item, context) {
          uploads.push([item, context]);
          if (overrides.upload) return overrides.upload(item, context);
          context.onProgress({ progress: 50 });
          return { imageId: `db-${item.fileName}`, key: `key-${item.fileName}`, fileId: item.id, thumbhash: `hash-${item.fileName}` };
        },
      }),
    },
  };
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled.exports);
  const { runDatasetImport, createDatasetImportStore, isImportActive } = compiled.exports;
  const run = (source) => runDatasetImport({ projectId: "project", plan: source, onChange: (state) => states.push(state) });
  const latest = () => states.at(-1);
  const store = (schedule = (callback) => callback()) => createDatasetImportStore({ schedule });
  return { run, latest, store, isImportActive, states, uploads, saves, resolutions };
}
async function settled(store, projectId = "project") {
  while (store.getRuns()[projectId] && ["resolving_labels", "importing"].includes(store.getRuns()[projectId].state.status)) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return store.getRuns()[projectId];
}

test("successful import resolves once and saves multiple mapped boxes with fresh IDs", async () => {
  const s = setup();
  const source = plan(2);
  const result = await s.run(source);
  assert.equal(s.resolutions.length, 1);
  assert.deepEqual(s.resolutions[0], ["project", source.categories]);
  assert.equal(result.status, "completed");
  assert.equal(result.totalImageCount, 2);
  assert.equal(result.completedImageCount, 2);
  assert.equal(result.successfulImageCount, 2);
  assert.equal(result.failedImageCount, 0);
  assert.equal(result.uploadProgress, 100);
  const ids = new Set();
  for (const [projectId, imageId, boxes] of s.saves) {
    assert.equal(projectId, "project");
    assert.match(imageId, /^db-/);
    assert.deepEqual(boxes.map((b) => b.labelId), ["existing-label", "created-label"]);
    assert.deepEqual(boxes.map(({ x, y, width, height }) => [x, y, width, height]), [[1, 2, 3, 4], [5, 6, 7, 8]]);
    for (const box of boxes) { assert.match(box.id, /^box-/); ids.add(box.id); }
  }
  assert.equal(ids.size, 4);
  assert.equal(source.images[0].boxes[0].id, "source-1");
  assert.ok(s.states.some((state) => state.uploadProgress > 0 && state.uploadProgress < 100));
  assert.equal(s.isImportActive(result), false);
});

test("the first state is published before the run yields", () => {
  const s = setup();
  void s.run(plan(2));
  assert.equal(s.states.length, 1);
  assert.equal(s.latest().status, "resolving_labels");
  assert.equal(s.latest().totalImageCount, 2);
  assert.ok(s.isImportActive(s.latest()));
});

test("a succeeded image exposes its database ID, thumbhash, and the boxes that were saved", async () => {
  const s = setup();
  const result = await s.run(plan());
  const [image] = result.images;
  assert.equal(image.status, "succeeded");
  assert.equal(image.imageId, "db-0.png");
  assert.equal(image.thumbhash, "hash-0.png");
  assert.equal(image.file.name, "0.png");
  assert.deepEqual(image.boxes, s.saves[0][2]);
});

test("zero-box images are uploaded and explicitly saved with an empty array", async () => {
  const s = setup();
  const source = plan();
  source.images[0].boxes = [];
  assert.equal((await s.run(source)).successfulImageCount, 1);
  assert.deepEqual(s.saves[0][2], []);
});

test("upload failure is isolated and never saves that image", async () => {
  const s = setup({ upload: async (item) => {
    if (item.fileName === "0.png") throw new Error("network failed");
    return { imageId: "db-1", key: "key-1", thumbhash: null };
  } });
  const result = await s.run(plan(2));
  assert.equal(result.status, "completed_with_errors");
  assert.equal(result.completedImageCount, 2);
  assert.equal(result.successfulImageCount, 1);
  assert.equal(result.failedImageCount, 1);
  assert.equal(result.images[0].failureStage, "upload");
  assert.match(result.images[0].error, /network failed/);
  assert.equal(s.saves.length, 1);
  assert.equal(s.uploads.length, 2);
});

test("annotation failure preserves the uploaded image ID and reports the failed save", async () => {
  const s = setup({ save: async (_projectId, imageId) => {
    if (imageId === "db-0.png") throw new Error("save denied");
  } });
  const result = await s.run(plan(2));
  assert.equal(result.images[0].imageId, "db-0.png");
  assert.equal(result.images[0].key, "key-0.png");
  assert.equal(result.images[0].failureStage, "annotations");
  assert.match(result.images[0].error, /Image uploaded, but its annotations were not imported: save denied/);
  assert.equal(result.successfulImageCount, 1);
  assert.equal(result.failedImageCount, 1);
  assert.equal(s.uploads.length, 2);
});

test("label resolution failure blocks all uploads; the project can import again", async () => {
  let failed = true;
  const s = setup({ resolve: async () => {
    if (failed) throw new Error("label access denied");
    return [{ categoryId: "old", labelId: "a" }, { categoryId: "new", labelId: "b" }];
  } });
  const store = s.store();
  assert.equal(store.start({ projectId: "project", projectName: "P", fileName: "a.zip", plan: plan() }), true);
  const result = (await settled(store)).state;
  assert.equal(result.status, "failed");
  assert.equal(result.labelResolutionFailed, true);
  assert.match(result.error, /label access denied/);
  assert.equal(result.completedImageCount, 0);
  assert.equal(s.uploads.length, 0);
  failed = false;
  assert.equal(store.start({ projectId: "project", projectName: "P", fileName: "a.zip", plan: plan() }), true);
  assert.equal((await settled(store)).state.status, "completed");
});

test("incomplete, empty, and conflicting label mappings block uploads", async () => {
  for (const mappings of [[], [{ categoryId: "old", labelId: "a" }],
    [{ categoryId: "old", labelId: "" }, { categoryId: "new", labelId: "b" }],
    [{ categoryId: "old", labelId: "a" }, { categoryId: "old", labelId: "different" }]]) {
    const s = setup({ resolve: async () => mappings });
    const result = await s.run(plan());
    assert.equal(result.labelResolutionFailed, true);
    assert.equal(s.uploads.length, 0);
    assert.equal(s.saves.length, 0);
  }
});

test("a second import into the same project is rejected while one is active; other projects run", async () => {
  const gate = deferred();
  const s = setup({ resolve: async () => {
    await gate.promise;
    return [{ categoryId: "old", labelId: "a" }, { categoryId: "new", labelId: "b" }];
  } });
  const store = s.store();
  const input = { projectId: "project", projectName: "P", fileName: "a.zip", plan: plan() };
  assert.equal(store.start(input), true);
  assert.equal(store.start(input), false);
  assert.ok(s.isImportActive(store.getRuns().project.state));
  assert.equal(s.resolutions.length, 1);
  assert.equal(s.uploads.length, 0);
  store.dismiss("project");
  assert.ok(store.getRuns().project, "an active run cannot be dismissed");
  assert.equal(store.start({ ...input, projectId: "other" }), true);
  gate.resolve();
  await settled(store);
  await settled(store, "other");
});

test("at most three image pipelines run; annotation saves occupy their slot", async () => {
  const gate = deferred();
  const allSaving = deferred();
  let saving = 0;
  const s = setup({ save: async () => {
    saving++;
    if (saving === 3) allSaving.resolve();
    await gate.promise;
  } });
  const running = s.run(plan(5));
  await allSaving.promise;
  assert.equal(s.uploads.length, 3);
  assert.equal(s.latest().completedImageCount, 0);
  assert.equal(s.latest().successfulImageCount, 0);
  assert.equal(s.latest().images.filter((image) => image.status === "saving_annotations").length, 3);
  gate.resolve();
  const result = await running;
  assert.equal(s.uploads.length, 5);
  assert.equal(result.successfulImageCount, 5);
});

test("empty plan completes without uploads", async () => {
  const s = setup();
  const result = await s.run(plan(0));
  assert.equal(result.status, "completed");
  assert.equal(result.totalImageCount, 0);
  assert.equal(s.resolutions.length, 1);
  assert.equal(s.uploads.length, 0);
});

test("a run lists each imported image once, in completion order, from its local bytes", async () => {
  const gates = [deferred(), deferred()];
  const s = setup({ upload: async (item) => {
    await gates[Number(item.fileName[0])].promise;
    return { imageId: `db-${item.fileName}`, key: "key", thumbhash: `hash-${item.fileName}` };
  } });
  const store = s.store();
  const source = plan(2);
  source.images[0].boxes = [];
  store.start({ projectId: "project", projectName: "Project", fileName: "set.zip", plan: source });
  const first = store.getRuns().project;
  assert.equal(first.projectName, "Project");
  assert.equal(first.fileName, "set.zip");
  assert.deepEqual(first.importedImages, []);
  gates[1].resolve();
  while (store.getRuns().project.importedImages.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const afterOne = store.getRuns().project.importedImages;
  gates[0].resolve();
  const done = await settled(store);
  assert.equal(done.importedImages[0], afterOne[0], "earlier images keep their identity");
  assert.deepEqual(done.importedImages.map((image) => [image.id, image.fileName, image.status, image.progress, image.thumbhash]), [
    ["db-1.png", "1.png", "Annotated", 100, "hash-1.png"],
    ["db-0.png", "0.png", "Unannotated", 0, "hash-0.png"],
  ]);
  assert.equal(done.importedImages[0].annotations.length, 2);
  assert.equal(done.importedImages[0].capturedAt, "formatted date");
  assert.match(done.importedImages[0].url, /^blob:/);
  const blob = await (await fetch(done.importedImages[0].url)).text();
  assert.equal(blob, "fixture");
});

test("dismissing a finished run removes it and revokes its local image URLs", async () => {
  const s = setup();
  const store = s.store();
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.start({ projectId: "project", projectName: "P", fileName: "a.zip", plan: plan() });
  const { importedImages: [image] } = await settled(store);
  const before = notifications;
  store.dismiss("project");
  assert.equal(store.getRuns().project, undefined);
  assert.equal(notifications, before + 1);
  await assert.rejects(fetch(image.url));
});

test("progress notifications are batched; the first and final states notify at once", async () => {
  const s = setup();
  const pending = [];
  const store = s.store((callback) => pending.push(callback));
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.start({ projectId: "project", projectName: "P", fileName: "a.zip", plan: plan(3) });
  assert.equal(notifications, 1);
  const done = await settled(store);
  assert.equal(done.state.status, "completed");
  assert.equal(notifications, 2, "only the final state notified before the scheduled flush");
  assert.equal(pending.length, 1, "one flush is scheduled for all progress since the last");
  pending[0]();
  assert.equal(notifications, 3);
});
