// node --test hooks/use-dataset-import.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./use-dataset-import.ts", import.meta.url), "utf8"), {
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
  const running = { current: false };
  let state;
  const dependencies = {
    react: {
      useState(initializer) {
        state ??= initializer();
        return [state, (next) => { state = next; states.push(next); }];
      },
      useRef: () => running,
      useCallback: (callback) => callback,
    },
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
    "@/lib/uploads/types": { DEFAULT_MAX_CONCURRENT_FILES: 3 },
    "@/lib/uploads/uploader": {
      createUploadProvider: () => ({
        async upload(item, context) {
          uploads.push([item, context]);
          if (overrides.upload) return overrides.upload(item, context);
          context.onProgress({ progress: 50 });
          return { imageId: `db-${item.fileName}`, key: `key-${item.fileName}`, fileId: item.id };
        },
      }),
    },
  };
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled.exports);
  const render = () => compiled.exports.useDatasetImport({ projectId: "project" });
  return { hook: render(), render, states, uploads, saves, resolutions };
}

test("successful import resolves once and saves multiple mapped boxes with fresh IDs", async () => {
  const s = setup();
  const source = plan(2);
  const result = await s.hook.startImport(source);
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
  assert.equal(s.render().isImporting, false);
});

test("zero-box images are uploaded and explicitly saved with an empty array", async () => {
  const s = setup();
  const source = plan();
  source.images[0].boxes = [];
  assert.equal((await s.hook.startImport(source)).successfulImageCount, 1);
  assert.deepEqual(s.saves[0][2], []);
});

test("upload failure is isolated and never saves that image", async () => {
  const s = setup({ upload: async (item) => {
    if (item.fileName === "0.png") throw new Error("network failed");
    return { imageId: "db-1", key: "key-1" };
  } });
  const result = await s.hook.startImport(plan(2));
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
  const result = await s.hook.startImport(plan(2));
  assert.equal(result.images[0].imageId, "db-0.png");
  assert.equal(result.images[0].key, "key-0.png");
  assert.equal(result.images[0].failureStage, "annotations");
  assert.match(result.images[0].error, /Image uploaded, but its annotations were not imported: save denied/);
  assert.equal(result.successfulImageCount, 1);
  assert.equal(result.failedImageCount, 1);
  assert.equal(s.uploads.length, 2);
});

test("label resolution failure blocks all uploads and releases the run lock", async () => {
  let failed = true;
  const s = setup({ resolve: async () => {
    if (failed) throw new Error("label access denied");
    return [{ categoryId: "old", labelId: "a" }, { categoryId: "new", labelId: "b" }];
  } });
  const result = await s.hook.startImport(plan());
  assert.equal(result.status, "failed");
  assert.equal(result.labelResolutionFailed, true);
  assert.match(result.error, /label access denied/);
  assert.equal(result.completedImageCount, 0);
  assert.equal(s.uploads.length, 0);
  failed = false;
  assert.equal((await s.hook.startImport(plan())).status, "completed");
});

test("incomplete, empty, and conflicting label mappings block uploads", async () => {
  for (const mappings of [[], [{ categoryId: "old", labelId: "a" }],
    [{ categoryId: "old", labelId: "" }, { categoryId: "new", labelId: "b" }],
    [{ categoryId: "old", labelId: "a" }, { categoryId: "old", labelId: "different" }]]) {
    const s = setup({ resolve: async () => mappings });
    const result = await s.hook.startImport(plan());
    assert.equal(result.labelResolutionFailed, true);
    assert.equal(s.uploads.length, 0);
    assert.equal(s.saves.length, 0);
  }
});

test("overlap is rejected immediately, including across renders", async () => {
  const gate = deferred();
  const s = setup({ resolve: async () => {
    await gate.promise;
    return [{ categoryId: "old", labelId: "a" }, { categoryId: "new", labelId: "b" }];
  } });
  const first = s.hook.startImport(plan());
  await assert.rejects(s.hook.startImport(plan()), /already running/);
  const rendered = s.render();
  assert.equal(rendered.isImporting, true);
  await assert.rejects(rendered.startImport(plan()), /already running/);
  assert.equal(s.resolutions.length, 1);
  assert.equal(s.uploads.length, 0);
  gate.resolve();
  await first;
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
  const running = s.hook.startImport(plan(5));
  await allSaving.promise;
  assert.equal(s.uploads.length, 3);
  assert.equal(s.render().completedImageCount, 0);
  assert.equal(s.render().successfulImageCount, 0);
  assert.equal(s.render().images.filter((image) => image.status === "saving_annotations").length, 3);
  gate.resolve();
  const result = await running;
  assert.equal(s.uploads.length, 5);
  assert.equal(result.successfulImageCount, 5);
});

test("empty plan completes without uploads", async () => {
  const s = setup();
  const result = await s.hook.startImport(plan(0));
  assert.equal(result.status, "completed");
  assert.equal(result.totalImageCount, 0);
  assert.equal(s.resolutions.length, 1);
  assert.equal(s.uploads.length, 0);
});
