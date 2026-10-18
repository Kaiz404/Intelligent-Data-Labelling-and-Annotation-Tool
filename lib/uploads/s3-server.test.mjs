// node --test lib/uploads/s3-server.test.mjs
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

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROJECT = id(1);
const OTHER_PROJECT = id(2);
const key = (n, projectId = PROJECT) => `projects/${projectId}/images/${id(100 + n)}/${n}.jpg`;

/** S3 objects by key, the images table, and a log of what each fake saw. */
function setup({ objects = {}, images = [] } = {}) {
  process.env.AWS_REGION = "test-region";
  process.env.AWS_S3_BUCKET = "bucket";
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  const seen = { heads: [], deletes: [], upserts: [], lookups: [], presignedPost: null };
  const rows = images.map((row) => ({ ...row }));

  const command = (name) => class { constructor(input) { this.name = name; this.input = input; } };
  const s3 = Object.fromEntries([
    "AbortMultipartUploadCommand", "CompleteMultipartUploadCommand", "CopyObjectCommand",
    "CreateMultipartUploadCommand", "DeleteObjectCommand", "GetObjectCommand", "HeadObjectCommand",
    "ListObjectsV2Command", "PutObjectCommand", "UploadPartCommand",
  ].map((name) => [name, command(name)]));
  s3.S3Client = class {
    async send({ name, input }) {
      if (name === "DeleteObjectCommand") {
        seen.deletes.push(input.Key);
        return {};
      }
      assert.equal(name, "HeadObjectCommand");
      seen.heads.push(input.Key);
      const object = objects[input.Key];
      if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
      return object;
    }
  };

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from(table) {
      const filters = [];
      let upserted;
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        in(column, values) {
          seen.lookups.push(values);
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        limit() { return query; },
        maybeSingle: async () => ({ data: { id: PROJECT }, error: null }),
        upsert(values, options) {
          seen.upserts.push({ values, options });
          upserted = values.filter((value) => !rows.some((row) => row.object_key === value.object_key))
            .map((value, index) => ({ ...value, id: `new-${index}` }));
          rows.push(...upserted);
          return query;
        },
        then(resolve) {
          assert.equal(table, "images");
          const data = upserted ?? rows.filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data: data.map(({ id: rowId, object_key }) => ({ id: rowId, object_key })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };

  const server = load("./s3-server.ts", {
    "@aws-sdk/client-s3": s3,
    "@aws-sdk/s3-presigned-post": {
      createPresignedPost: async (_client, options) => {
        seen.presignedPost = options;
        return { url: "https://bucket.s3.test", fields: { key: options.Key } };
      },
    },
    "@aws-sdk/s3-request-presigner": { getSignedUrl: async () => "signed" },
    "@/lib/image-placeholder": { isThumbhash: (value) => value === "valid-hash" },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/uploads/object-key": load("./object-key.ts"),
    "@/lib/uploads/types": { MAX_COMMIT_IMAGES: 100, SINGLE_REQUEST_UPLOAD_MAX_BYTES: 8 * 1024 * 1024 },
  });
  return { server, seen, rows };
}

test("the upload policy only allows images of up to 8 MiB under the project's image folder", async () => {
  const { server, seen } = setup();
  const policy = await server.createUploadPolicy({ projectId: PROJECT });

  assert.equal(policy.keyPrefix, `projects/${PROJECT}/images/`);
  assert.equal(seen.presignedPost.Key, `projects/${PROJECT}/images/\${filename}`);
  assert.deepEqual(seen.presignedPost.Conditions, [
    ["starts-with", "$Content-Type", "image/"],
    ["content-length-range", 1, 8 * 1024 * 1024],
  ]);
  assert.equal(seen.presignedPost.Expires, 3600);
});

test("commit saves rows with the size and type S3 reports, and refuses missing or non-image objects one by one", async () => {
  const { server, seen } = setup({
    objects: {
      [key(1)]: { ContentType: "image/jpeg", ContentLength: 1234 },
      [key(3)]: { ContentType: "text/html", ContentLength: 50 },
    },
  });
  const { images } = await server.commitUploadedImages({
    projectId: PROJECT,
    images: [
      { key: key(1), fileName: "cat.jpg", thumbhash: "valid-hash" },
      { key: key(2), fileName: "missing.jpg", thumbhash: "valid-hash" },
      { key: key(3), fileName: "page.jpg", thumbhash: "not-a-hash" },
    ],
  });

  assert.deepEqual(images, [
    { key: key(1), imageId: "new-0" },
    { key: key(2), error: "The uploaded file was not found." },
    { key: key(3), error: "Only JPEG and PNG files are supported." },
  ]);
  assert.deepEqual(seen.upserts, [{
    values: [{ project_id: PROJECT, name: "cat.jpg", object_key: key(1), content_type: "image/jpeg", size_bytes: 1234, thumbhash: "valid-hash" }],
    options: { onConflict: "object_key", ignoreDuplicates: true },
  }]);
});

test("a repeated commit returns the rows the first one saved instead of adding more", async () => {
  const { server, rows } = setup({
    objects: { [key(1)]: { ContentType: "image/png", ContentLength: 10 } },
    images: [{ id: "saved-earlier", project_id: PROJECT, object_key: key(1) }],
  });
  const { images } = await server.commitUploadedImages({
    projectId: PROJECT, images: [{ key: key(1), fileName: "a.png", thumbhash: null }],
  });

  assert.deepEqual(images, [{ key: key(1), imageId: "saved-earlier" }]);
  assert.equal(rows.length, 1);
});

test("commit refuses a key from another project or a bad file name without touching S3, and saves the rest", async () => {
  const { server, seen } = setup({ objects: { [key(1)]: { ContentType: "image/jpeg", ContentLength: 5 } } });
  const { images } = await server.commitUploadedImages({
    projectId: PROJECT,
    images: [
      { key: key(2, OTHER_PROJECT), fileName: "a.jpg" },
      { key: key(3), fileName: "x".repeat(256) },
      { key: key(4), fileName: "  " },
      { key: key(1), fileName: "ok.jpg" },
    ],
  });
  assert.deepEqual(images, [
    { key: key(2, OTHER_PROJECT), error: "Invalid upload object key." },
    { key: key(3), error: "The file name is invalid." },
    { key: key(4), error: "The file name is invalid." },
    { key: key(1), imageId: "new-0" },
  ]);
  assert.deepEqual(seen.heads, [key(1)]);
  assert.deepEqual(seen.deletes, []);
});

test("commit deletes objects it refuses for their type, since no image can use them", async () => {
  const { server, seen } = setup({ objects: { [key(1)]: { ContentType: "image/svg+xml", ContentLength: 5 } } });
  await server.commitUploadedImages({ projectId: PROJECT, images: [{ key: key(1), fileName: "a.svg" }] });
  assert.deepEqual(seen.deletes, [key(1)]);
});

test("a repeated commit of 100 images looks up the saved rows 25 keys at a time", async () => {
  const keys = Array.from({ length: 100 }, (_, n) => key(n));
  const { server, seen } = setup({
    objects: Object.fromEntries(keys.map((k) => [k, { ContentType: "image/jpeg", ContentLength: 5 }])),
    images: keys.map((k, n) => ({ id: `saved-${n}`, project_id: PROJECT, object_key: k })),
  });
  const { images } = await server.commitUploadedImages({
    projectId: PROJECT, images: keys.map((k, n) => ({ key: k, fileName: `${n}.jpg` })),
  });
  assert.deepEqual(images, keys.map((k, n) => ({ key: k, imageId: `saved-${n}` })));
  assert.deepEqual(seen.lookups.map((chunk) => chunk.length), [25, 25, 25, 25]);
});

test("discarding an upload deletes its object only when no image row uses it", async () => {
  const { server, seen } = setup({ images: [{ id: "saved", project_id: PROJECT, object_key: key(1) }] });
  await server.discardUploadedObject({ key: key(1) });
  await server.discardUploadedObject({ key: key(2) });
  assert.deepEqual(seen.deletes, [key(2)]);
});

test("commit rejects more than 100 images or a repeated key", async () => {
  const { server } = setup();
  const many = Array.from({ length: 101 }, (_, n) => ({ key: key(n), fileName: `${n}.jpg` }));
  await assert.rejects(server.commitUploadedImages({ projectId: PROJECT, images: many }), { status: 400 });
  await assert.rejects(server.commitUploadedImages({
    projectId: PROJECT, images: [{ key: key(1), fileName: "a.jpg" }, { key: key(1), fileName: "b.jpg" }],
  }), { message: "images must not repeat a key.", status: 400 });
});
