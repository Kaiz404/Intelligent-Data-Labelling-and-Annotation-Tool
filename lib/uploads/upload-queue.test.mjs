// node --test lib/uploads/upload-queue.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./upload-queue.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const compiled = { exports: {} };
new Function("require", "exports", outputText)((name) => {
  if (name === "@/lib/uploads/types") {
    return { ACCEPTED_IMAGE_TYPES: ["image/jpeg", "image/png"], MAX_TOTAL_UPLOAD_BYTES: 1000 };
  }
  throw new Error(`Unexpected dependency: ${name}`);
}, compiled.exports);
const { createUploadQueueStore } = compiled.exports;

function entry(index, sizeBytes = 10, mimeType = "image/jpeg") {
  return { fileName: `${index}.jpg`, mimeType, sizeBytes, source: { kind: "file", file: { index } } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** A provider whose uploads finish only when the test says so. */
function setup({ maxConcurrentFiles = 3 } = {}) {
  const calls = [], aborted = [], completed = [];
  const provider = {
    upload(item, context) {
      const call = { item, context, ...deferred() };
      context.signal.addEventListener("abort", () => call.reject(new DOMException("Aborted", "AbortError")));
      calls.push(call);
      return call.promise;
    },
    async abort(item) { aborted.push(item.id); },
  };
  const store = createUploadQueueStore({
    provider, maxConcurrentFiles, getProjectId: () => "project",
    onUploadComplete: (result) => completed.push(result.imageId),
    scheduleNotify: (notify) => notify(),
  });
  const finish = (call) => call.resolve({ fileId: call.item.id, key: `key-${call.item.fileName}`, imageId: `img-${call.item.fileName}`, thumbhash: null });
  return { store, calls, aborted, completed, finish };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("uploads a large batch with at most maxConcurrentFiles in flight", async () => {
  const { store, calls, completed, finish } = setup();
  store.add(Array.from({ length: 20 }, (_, index) => entry(index, 1)));
  store.start();

  let maxInFlight = 0;
  while (store.getSnapshot().isRunning) {
    const inFlight = calls.filter((call) => !call.done);
    maxInFlight = Math.max(maxInFlight, inFlight.length);
    for (const call of inFlight) { call.done = true; finish(call); }
    await tick();
  }

  assert.equal(maxInFlight, 3);
  assert.equal(calls.length, 20);
  assert.equal(completed.length, 20);
  assert.deepEqual(store.getSnapshot().counts, { Queued: 0, Uploading: 0, Paused: 0, Completed: 20, Failed: 0 });
  assert.equal(store.getSnapshot().progressSum, 2000);
});

test("does not upload before start, and never mutates a published snapshot", async () => {
  const { store, calls } = setup();
  store.add([entry(0)]);
  assert.equal(calls.length, 0);

  const before = store.getSnapshot();
  store.start();
  calls[0].context.onProgress({ fileId: calls[0].item.id, progress: 40, uploadId: "u1", key: "k1" });

  assert.equal(before.items[0].status, "Queued");
  assert.equal(before.items[0].progress, 0);
  assert.notEqual(store.getSnapshot(), before);
  assert.equal(store.getSnapshot().items[0].progress, 40);
});

test("pause all keeps multipart state, and start resumes it", async () => {
  const { store, calls } = setup({ maxConcurrentFiles: 1 });
  store.add([entry(0), entry(1)]);
  store.start();
  calls[0].context.onProgress({ fileId: calls[0].item.id, progress: 50, uploadId: "u1", key: "k1", completedPartETags: [{ partNumber: 1, eTag: "e1" }] });

  store.pauseAll();
  await tick();
  assert.equal(calls[0].context.signal.aborted, true);
  assert.deepEqual(store.getSnapshot().counts, { Queued: 0, Uploading: 0, Paused: 2, Completed: 0, Failed: 0 });
  assert.equal(store.getSnapshot().isRunning, false);

  store.start();
  const resumed = calls.slice(1).find((call) => call.item.uploadId === "u1");
  assert.ok(resumed, "the paused upload restarts with its multipart upload id");
  assert.deepEqual(resumed.item.completedPartETags, [{ partNumber: 1, eTag: "e1" }]);
});

test("a failed upload is reported and can be retried", async () => {
  const { store, calls, finish } = setup();
  store.add([entry(0)]);
  store.start();
  calls[0].reject(new Error("S3 part upload failed (500)."));
  await tick();

  assert.equal(store.getSnapshot().items[0].status, "Failed");
  assert.equal(store.getSnapshot().items[0].error, "S3 part upload failed (500).");
  assert.equal(store.getSnapshot().isRunning, false);

  store.retry(store.getSnapshot().items[0].id);
  finish(calls[1]);
  await tick();
  assert.equal(store.getSnapshot().items[0].status, "Completed");
});

test("removing items aborts their uploads and server-side multipart state", async () => {
  const { store, calls, aborted } = setup({ maxConcurrentFiles: 1 });
  store.add([entry(0), entry(1)]);
  store.start();
  calls[0].context.onProgress({ fileId: calls[0].item.id, progress: 10, uploadId: "u1", key: "k1" });
  const inFlightId = calls[0].item.id;

  await store.remove([inFlightId]);

  assert.equal(calls[0].context.signal.aborted, true);
  assert.deepEqual(aborted, [inFlightId]);
  assert.equal(store.getSnapshot().items.length, 1);
  assert.equal(store.getSnapshot().totalBytes, 10);
  assert.equal(calls.length, 2, "the next queued image takes the free slot");
});

test("skips non-images and stops adding at the total size cap", () => {
  const { store } = setup();
  store.add([entry(0, 400), entry(1, 400, "image/gif"), entry(2, 500), entry(3, 200), entry(4, 50)]);

  assert.deepEqual(store.getSnapshot().items.map((item) => item.fileName), ["0.jpg", "2.jpg"]);
  assert.equal(store.getSnapshot().totalBytes, 900);
});
