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
const { createUploadQueueStore, uploadPhase } = compiled.exports;

function entry(index, sizeBytes = 10, mimeType = "image/jpeg") {
  return { fileName: `${index}.jpg`, mimeType, sizeBytes, source: { kind: "file", file: { index } } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** A provider whose uploads finish only when the test says so. */
function setup({ maxConcurrentFiles = 3, maxInFlightBytes, now } = {}) {
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
    provider, maxConcurrentFiles, maxInFlightBytes, projectId: "project", now,
    scheduleNotify: (notify) => notify(),
  });
  store.onComplete((result) => completed.push(result.imageId));
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

test("removing an image whose bytes are stored but not saved asks the provider to clean them up", async () => {
  const { store, calls, aborted } = setup();
  store.add([entry(0)]);
  store.start();
  calls[0].context.onProgress({ fileId: calls[0].item.id, progress: 100, key: "k1" });
  await store.remove([calls[0].item.id]);
  assert.deepEqual(aborted, [calls[0].item.id]);
});

test("skips empty files", () => {
  const { store } = setup();
  store.add([entry(0, 0), entry(1)]);
  assert.deepEqual(store.getSnapshot().items.map((item) => item.fileName), ["1.jpg"]);
});

test("starts uploads in queue order while their combined size fits the byte budget", async () => {
  const { store, calls, finish } = setup({ maxConcurrentFiles: 10, maxInFlightBytes: 100 });
  store.add([entry(0, 60), entry(1, 60), entry(2, 30)]);
  store.start();
  assert.deepEqual(calls.map((call) => call.item.fileName), ["0.jpg"], "60 + 60 would pass the budget");

  finish(calls[0]);
  await tick();
  assert.deepEqual(calls.map((call) => call.item.fileName), ["0.jpg", "1.jpg", "2.jpg"]);
});

test("a file larger than the byte budget still uploads on its own", () => {
  const { store, calls } = setup({ maxInFlightBytes: 100 });
  store.add([entry(0, 500)]);
  store.start();
  assert.equal(calls.length, 1);
});

test("skips non-images and stops adding at the total size cap", () => {
  const { store } = setup();
  store.add([entry(0, 400), entry(1, 400, "image/gif"), entry(2, 500), entry(3, 200), entry(4, 50)]);

  assert.deepEqual(store.getSnapshot().items.map((item) => item.fileName), ["0.jpg", "2.jpg"]);
  assert.equal(store.getSnapshot().totalBytes, 900);
});

test("bytes per status follow each image through the queue", async () => {
  const { store, calls, finish } = setup();
  store.add([entry(0, 100), entry(1, 200), entry(2, 300)]);
  assert.deepEqual(store.getSnapshot().bytes, { Queued: 600, Uploading: 0, Paused: 0, Completed: 0, Failed: 0 });

  store.start();
  calls[0].context.onProgress({ fileId: calls[0].item.id, progress: 50, key: "k0" });
  assert.deepEqual(store.getSnapshot().bytes, { Queued: 0, Uploading: 600, Paused: 0, Completed: 0, Failed: 0 });

  finish(calls[0]);
  calls[1].reject(new Error("S3 POST failed (500)."));
  await tick();
  assert.deepEqual(store.getSnapshot().bytes, { Queued: 0, Uploading: 300, Paused: 0, Completed: 100, Failed: 200 });

  await store.remove([calls[1].item.id]);
  assert.deepEqual(store.getSnapshot().bytes, { Queued: 0, Uploading: 300, Paused: 0, Completed: 100, Failed: 0 });
  assert.equal(store.getSnapshot().totalBytes, 400);
});

test("started is set by start, survives a pause, and clears once the queue empties", async () => {
  const { store } = setup();
  store.add([entry(0)]);
  assert.equal(store.getSnapshot().started, false);
  store.start();
  assert.equal(store.getSnapshot().started, true);
  store.pauseAll();
  assert.equal(store.getSnapshot().started, true);
  await store.cancelAll();
  assert.equal(store.getSnapshot().started, false);
});

test("complete listeners hear each saved image until they unsubscribe", async () => {
  const { store, calls, finish } = setup();
  const heard = [];
  const unsubscribe = store.onComplete((result) => heard.push(result));
  store.add([entry(0), entry(1)]);
  store.start();
  assert.equal(calls[0].context.projectId, "project");

  finish(calls[0]);
  await tick();
  assert.deepEqual(heard, [{ imageId: "img-0.jpg", key: "key-0.jpg" }]);

  unsubscribe();
  finish(calls[1]);
  await tick();
  assert.equal(heard.length, 1);
});

test("estimates time left from the throughput of the last 30 seconds", async () => {
  let time = 0;
  const { store, calls, finish } = setup({ maxConcurrentFiles: 1, now: () => time });
  store.add(Array.from({ length: 5 }, (_, index) => entry(index, 100)));
  assert.equal(store.estimateRemainingMs(), null, "no estimate before start");

  store.start();
  time = 2_000;
  finish(calls[0]);
  await tick();
  assert.equal(store.estimateRemainingMs(), null, "no estimate from under 3 s of data");

  time = 4_000;
  assert.equal(Math.round(store.estimateRemainingMs()), 16_000, "400 bytes left at 100 bytes per 4 s");
  time = 8_000;
  assert.equal(Math.round(store.estimateRemainingMs()), 32_000, "a stall lowers the rate");

  time = 35_000;
  finish(calls[1]);
  await tick();
  time = 40_000;
  assert.equal(Math.round(store.estimateRemainingMs()), 90_000, "only the completion inside the window counts");
  time = 70_000;
  assert.equal(store.estimateRemainingMs(), null, "nothing completed in the window");
});

test("the phase follows a batch from ready to running, paused, finished with failures, and dismissed", async () => {
  const { store, calls, finish } = setup({ maxConcurrentFiles: 1 });
  const phase = () => uploadPhase(store.getSnapshot());
  store.add([entry(0), entry(1)]);
  assert.equal(phase(), "idle", "added but not started");
  store.start();
  assert.equal(phase(), "running");
  store.pauseAll();
  assert.equal(phase(), "paused");
  store.start();
  finish(calls.at(-1));
  await tick();
  calls.at(-1).reject(new Error("S3 POST failed (500)."));
  await tick();
  assert.equal(phase(), "failed");
  await store.cancelAll();
  assert.equal(phase(), "idle");
});

test("a batch without failures finishes", async () => {
  const { store, calls, finish } = setup();
  store.add([entry(0)]);
  store.start();
  finish(calls[0]);
  await tick();
  assert.equal(uploadPhase(store.getSnapshot()), "finished");
});

test("pausing and starting again reset the throughput meter", async () => {
  let time = 0;
  const { store, calls, finish } = setup({ maxConcurrentFiles: 1, now: () => time });
  store.add(Array.from({ length: 3 }, (_, index) => entry(index, 100)));
  store.start();
  time = 4_000;
  finish(calls[0]);
  await tick();
  assert.equal(Math.round(store.estimateRemainingMs()), 8_000);

  store.pauseAll();
  assert.equal(store.estimateRemainingMs(), null, "no estimate while paused");

  time = 20_000;
  store.start();
  time = 22_000;
  assert.equal(store.estimateRemainingMs(), null, "the paused time and earlier completion are forgotten");
  finish(calls.at(-1));
  await tick();
  time = 24_000;
  assert.equal(Math.round(store.estimateRemainingMs()), 4_000, "100 bytes left at 100 bytes per 4 s");
});
