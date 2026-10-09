// node --test lib/uploads/s3-uploader.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled.exports);
  return compiled.exports;
}

const MiB = 1024 * 1024;
const types = {
  DEFAULT_CHUNK_SIZE_BYTES: 8 * MiB,
  DEFAULT_MAX_CONCURRENT_CHUNKS: 4,
  MAX_COMMIT_IMAGES: 100,
  SINGLE_REQUEST_UPLOAD_MAX_BYTES: 8 * MiB,
};
const { createS3Uploader } = load("./s3-uploader.ts", {
  "@/lib/image-placeholder": { createThumbhash: async () => "hash" },
  "@/lib/uploads/object-key": load("./object-key.ts"),
  "@/lib/uploads/zip-source": { openUploadSource: async (source) => source.file },
  "@/lib/uploads/chunk": load("./chunk.ts", { "@/lib/uploads/types": types }),
  "@/lib/uploads/types": types,
});
globalThis.window ??= globalThis;

const PREFIX = "projects/p/images/";
const S3_URL = "https://s3.test/bucket";

/** Fakes the app API and S3; `commit` decides each commit response. */
function network({ commit } = {}) {
  const requests = [];
  let imageCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    requests.push({ url, method: init.method, body });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    switch (url) {
      case "/api/uploads/policy":
        return json({ url: S3_URL, fields: { key: `${PREFIX}\${filename}`, Policy: "policy", "X-Amz-Signature": "sig" }, keyPrefix: PREFIX, expiresInSeconds: 3600 });
      case S3_URL:
        return new Response(null, { status: 204 });
      case "/api/uploads/commit":
        return commit?.(body, requests) ?? json({ images: body.images.map(({ key }) => ({ key, imageId: `img-${++imageCount}` })) });
      case "/api/uploads/create":
        return json({ uploadId: "multipart", key: `${PREFIX}big/big.jpg` });
      case "/api/uploads/presign-parts":
        return json({ parts: body.partNumbers.map((partNumber) => ({ partNumber, url: `https://s3.test/part/${partNumber}` })) });
      case "/api/uploads/abort":
        return new Response(null, { status: 204 });
      case "/api/uploads/complete":
        return json({ key: body.key, imageId: "img-big" });
      default:
        if (url.startsWith("https://s3.test/part/")) return new Response(null, { status: 200, headers: { etag: `"${url.at(-1)}"` } });
        throw new Error(`Unexpected request: ${url}`);
    }
  };
  return { requests, to: (url) => requests.filter((request) => request.url === url) };
}

function item(index, bytes = 100, fields = {}) {
  const file = new File([new Uint8Array(bytes)], `photo ${index}.jpg`, { type: "image/jpeg" });
  return {
    id: `item-${index}`, fileName: file.name, sizeBytes: bytes, mimeType: "image/jpeg",
    status: "Queued", progress: 0, source: { kind: "file", file }, ...fields,
  };
}

function context(events = [], controller = new AbortController()) {
  return { projectId: "p", signal: controller.signal, onProgress: (event) => events.push(event) };
}

test("small images upload with one S3 POST each and save in one shared request", async () => {
  const { to } = network();
  const uploader = createS3Uploader();
  const results = await Promise.all([0, 1, 2, 3, 4].map((index) => uploader.upload(item(index), context())));

  assert.equal(to("/api/uploads/policy").length, 1, "one policy serves every image");
  const posts = to(S3_URL);
  assert.equal(posts.length, 5);
  for (const [index, { body }] of posts.entries()) {
    const fields = [...body.keys()];
    assert.equal(fields.at(-1), "file", "S3 reads fields only before the file");
    assert.match(body.get("key"), new RegExp(`^${PREFIX}[0-9a-f-]{36}/photo ${index}\\.jpg$`));
    assert.equal(body.get("Content-Type"), "image/jpeg");
    assert.equal(body.get("Policy"), "policy");
  }
  const commits = to("/api/uploads/commit");
  assert.equal(commits.length, 1, "five saves share one request");
  assert.deepEqual(commits[0].body.images.map((image) => [image.key, image.fileName, image.thumbhash]),
    posts.map(({ body }, index) => [body.get("key"), `photo ${index}.jpg`, "hash"]));
  assert.deepEqual(results.map((result) => result.imageId).sort(), ["img-1", "img-2", "img-3", "img-4", "img-5"]);
  assert.deepEqual(results.map((result) => result.key), posts.map(({ body }) => body.get("key")));
});

test("pausing before the save is sent drops it, and resuming saves the stored bytes without a second POST", async () => {
  const { to } = network();
  const uploader = createS3Uploader();
  const events = [];
  const controller = new AbortController();
  const pending = uploader.upload(item(0), context(events, controller));
  while (!events.some((event) => event.key)) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(to("/api/uploads/commit").length, 0);

  const { key } = events.find((event) => event.key);
  const resumed = await uploader.upload(item(0, 100, { key }), context());
  assert.equal(to(S3_URL).length, 1);
  assert.deepEqual(to("/api/uploads/commit")[0].body.images.map((image) => image.key), [key]);
  assert.equal(resumed.key, key);
});

test("an image the server refuses fails with its reason and forgets its key, so a retry uploads again", async () => {
  network({ commit: (body) => new Response(JSON.stringify({ images: body.images.map(({ key }) => ({ key, error: "The uploaded file was not found." })) })) });
  const events = [];
  await assert.rejects(createS3Uploader().upload(item(0), context(events)), { message: "The uploaded file was not found." });
  assert.equal(events.at(-1).key, undefined);
  assert.equal(events.at(-1).progress, 0);
});

test("a save that fails on the server is retried", async () => {
  let attempts = 0;
  const { to } = network({
    commit: (body) => (++attempts === 1
      ? new Response(JSON.stringify({ error: "Upload operation failed." }), { status: 500 })
      : new Response(JSON.stringify({ images: body.images.map(({ key }) => ({ key, imageId: "img-retried" })) }))),
  });
  const result = await createS3Uploader().upload(item(0), context());
  assert.equal(result.imageId, "img-retried");
  assert.equal(to("/api/uploads/commit").length, 2);
});

test("files over the single-request limit still use multipart upload", async () => {
  const { to } = network();
  const result = await createS3Uploader().upload(item(0, 8 * MiB + 1), context());
  assert.equal(to(S3_URL).length, 0);
  assert.equal(to("/api/uploads/create").length, 1);
  assert.deepEqual(to("/api/uploads/complete")[0].body.parts, [{ partNumber: 1, eTag: '"1"' }, { partNumber: 2, eTag: '"2"' }]);
  assert.equal(result.imageId, "img-big");
});

test("cancelling a stored image before its save is sent deletes its object, but not once the save was sent", async () => {
  const { to } = network();
  const uploader = createS3Uploader();
  const events = [];
  const controller = new AbortController();
  const pending = uploader.upload(item(0), context(events, controller));
  while (!events.some((event) => event.key)) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const { key } = events.find((event) => event.key);
  await uploader.abort(item(0, 100, { key }));
  assert.deepEqual(to("/api/uploads/abort").map((request) => request.body), [{ key }]);

  const saved = await uploader.upload(item(1), context());
  await uploader.abort(item(1, 100, { key: saved.key }));
  assert.equal(to("/api/uploads/abort").length, 1);
});
