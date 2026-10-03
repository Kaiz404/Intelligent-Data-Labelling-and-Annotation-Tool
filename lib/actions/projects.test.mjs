// node --test lib/actions/projects.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as dataset-labels.test.mjs.
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

const SOURCE = "source";
const TARGET = "target";
const keyFor = (id) => `projects/${SOURCE}/images/${id}/${id}.jpg`;

/**
 * In-memory Supabase + S3. `fail(ctx)` may return `{ error, commit }` to make a
 * query fail; with `commit: true` the write still happens (lost response).
 */
function setup({ fail, s3DeleteFails } = {}) {
  const rows = {
    projects: [{ id: SOURCE, user_id: "user" }, { id: TARGET, user_id: "user" }],
    project_labels: [{ id: "cat", project_id: SOURCE, name: "Cat", color: "#f00" }],
    images: ["a", "b"].map((id) => ({
      id,
      project_id: SOURCE,
      name: `${id}.jpg`,
      object_key: keyFor(id),
      content_type: "image/jpeg",
      size_bytes: 10,
      annotation: [{ id: `box-${id}`, labelId: "cat", x: 0, y: 0, width: 1, height: 1 }],
    })),
  };
  const objects = new Set(rows.images.map((image) => image.object_key));
  const events = [];
  let nextId = 1;

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from(table) {
      const filters = [];
      const conditions = {};
      let op = "select";
      let payload;
      const query = {
        select() { return query; },
        order() { return query; },
        eq(key, value) { conditions[key] = value; filters.push((row) => row[key] === value); return query; },
        in(key, values) { conditions[key] = values; filters.push((row) => values.includes(row[key])); return query; },
        insert(value) { op = "insert"; payload = value; return query; },
        update(value) { op = "update"; payload = value; return query; },
        delete() { op = "delete"; return query; },
        async run(single) {
          const ctx = { table, op, payload, conditions };
          const failure = fail?.(ctx);
          if (failure && !failure.commit) return { data: null, error: failure.error };
          let data;
          if (op === "insert") {
            data = { id: `new-${nextId++}`, ...payload };
            rows[table].push(data);
          } else {
            data = rows[table].filter((row) => filters.every((filter) => filter(row)));
            if (op === "update") data.forEach((row) => Object.assign(row, payload));
            if (op === "delete") rows[table] = rows[table].filter((row) => !data.includes(row));
          }
          if (op !== "select") events.push(`${table}.${op}:${[data].flat().map((row) => row.id).join(",")}`);
          if (failure) return { data: null, error: failure.error };
          return { data: single ? [data].flat()[0] ?? null : data, error: null };
        },
        single() { return query.run(true); },
        maybeSingle() { return query.run(true); },
        then(resolve, reject) { return query.run(false).then(resolve, reject); },
      };
      return query;
    },
  };

  const s3 = {
    async copyImageObject(sourceKey, targetProjectId, fileName) {
      assert.ok(objects.has(sourceKey), `copy source ${sourceKey} must exist`);
      const key = `projects/${targetProjectId}/images/copy-${nextId++}/${fileName}`;
      objects.add(key);
      events.push(`s3.copy:${sourceKey}`);
      return key;
    },
    async deleteImageObject(key) {
      if (s3DeleteFails?.(key)) throw new Error("S3 unavailable");
      objects.delete(key);
      events.push(`s3.delete:${key}`);
    },
  };

  const actions = load("./projects.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/images": { fetchProjectImages: async () => [] },
    "@/lib/labels": { fetchProjectLabels: async () => [] },
    "@/lib/uploads/s3-server": s3,
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect() {} },
  });
  const imagesIn = (projectId) => rows.images.filter((image) => image.project_id === projectId);
  return { ...actions, rows, objects, events, imagesIn };
}

const isSourceRowDelete = ({ table, op, conditions }) =>
  table === "images" && op === "delete" && conditions.project_id === SOURCE;

function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = original; });
}

test("move copies and inserts first, then deletes source rows, then source objects", async () => {
  const s = setup();
  await s.transferProjectImages(SOURCE, TARGET, ["a", "b"], "move", true);

  const firstInsert = s.events.findIndex((event) => event.startsWith("images.insert"));
  const sourceDelete = s.events.findIndex((event) => event === "images.delete:a,b");
  const objectDeletes = s.events.flatMap((event, index) => (event.startsWith(`s3.delete:projects/${SOURCE}/`) ? [index] : []));
  assert.ok(firstInsert >= 0 && firstInsert < sourceDelete);
  assert.equal(objectDeletes.length, 2);
  assert.ok(objectDeletes.every((index) => index > sourceDelete));

  assert.equal(s.imagesIn(SOURCE).length, 0);
  assert.equal(s.imagesIn(TARGET).length, 2);
  assert.ok(s.imagesIn(TARGET).every((image) => s.objects.has(image.object_key)));
  assert.ok(!s.objects.has(keyFor("a")) && !s.objects.has(keyFor("b")));
});

test("move tolerates source object delete failures and keeps the destination", async () => {
  const s = setup({ s3DeleteFails: (key) => key.startsWith(`projects/${SOURCE}/`) });
  await quietly(() => s.transferProjectImages(SOURCE, TARGET, ["a", "b"], "move", true));
  assert.equal(s.imagesIn(SOURCE).length, 0);
  assert.equal(s.imagesIn(TARGET).length, 2);
  assert.ok(s.imagesIn(TARGET).every((image) => s.objects.has(image.object_key)));
  // Orphaned source objects are acceptable; lost images are not.
  assert.ok(s.objects.has(keyFor("a")));
});

test("move rolls back the copies when the source row delete fails cleanly", async () => {
  const s = setup({ fail: (ctx) => (isSourceRowDelete(ctx) ? { error: { message: "db down" } } : null) });
  await assert.rejects(s.transferProjectImages(SOURCE, TARGET, ["a", "b"], "move", true), /nothing was changed/);
  assert.equal(s.imagesIn(SOURCE).length, 2);
  assert.equal(s.imagesIn(TARGET).length, 0);
  assert.ok(s.objects.has(keyFor("a")) && s.objects.has(keyFor("b")));
  assert.equal(s.objects.size, 2, "copied objects are cleaned up");
});

test("move keeps every copy when the source delete may have committed", async () => {
  const s = setup({ fail: (ctx) => (isSourceRowDelete(ctx) ? { error: { message: "timeout" }, commit: true } : null) });
  await assert.rejects(s.transferProjectImages(SOURCE, TARGET, ["a", "b"], "move", true), /No images were lost/);
  assert.equal(s.imagesIn(SOURCE).length, 0);
  assert.equal(s.imagesIn(TARGET).length, 2);
  assert.ok(s.imagesIn(TARGET).every((image) => s.objects.has(image.object_key)));
  assert.ok(!s.events.some((event) => event.startsWith("s3.delete")), "no objects deleted in an unknown state");
});

test("a failed copy rolls back only the destination and never touches the source", async () => {
  let inserts = 0;
  const s = setup({
    fail: ({ table, op }) => (table === "images" && op === "insert" && ++inserts === 2 ? { error: { message: "insert failed" } } : null),
  });
  await quietly(() => assert.rejects(s.transferProjectImages(SOURCE, TARGET, ["a", "b"], "move", true), /Could not copy project images/));
  assert.equal(s.imagesIn(SOURCE).length, 2);
  assert.equal(s.imagesIn(TARGET).length, 0);
  assert.deepEqual([...s.objects].sort(), [keyFor("a"), keyFor("b")]);
});

test("copies without kept annotations are unannotated (null), with kept ones remapped", async () => {
  const raw = setup();
  await raw.transferProjectImages(SOURCE, TARGET, ["a"], "copy", false);
  assert.equal(raw.imagesIn(TARGET)[0].annotation, null);
  assert.equal(raw.imagesIn(SOURCE).length, 2);

  const kept = setup();
  await kept.transferProjectImages(SOURCE, TARGET, ["a"], "copy", true);
  const [copy] = kept.imagesIn(TARGET);
  const targetLabel = kept.rows.project_labels.find((label) => label.project_id === TARGET);
  assert.equal(copy.annotation[0].labelId, targetLabel.id);
});
