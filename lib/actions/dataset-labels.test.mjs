// node --test lib/actions/dataset-labels.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as coco-import.test.mjs.
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
const palette = load("../annotations/label-colors.ts");
const box = (labelId = "cat") => ({ id: "box-1", labelId, x: 0, y: 0, width: 2, height: 3 });

function setup(options = {}) {
  const rows = {
    projects: [{ id: "project", user_id: "user" }, { id: "foreign", user_id: "other" }],
    project_labels: options.labels ?? [{ id: "cat", project_id: "project", name: "Cat", color: "existing" }],
    images: [{ id: "image", project_id: "project", annotation: [box()] }],
  };
  const queries = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: "user" } } }) },
    from(table) {
      const filters = [];
      let operation = "read", payload, bounds;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        order() { return query; },
        range(start, end) { bounds = [start, end]; return query; },
        insert(value) { operation = "insert"; payload = value; return query; },
        update(value) { operation = "update"; payload = value; return query; },
        async execute(single = false) {
          queries.push({ table, operation, payload, bounds });
          const error = options.fail?.(table, operation);
          if (error) return { data: null, error };
          if (operation === "insert") {
            if (options.race) {
              options.race = false;
              rows[table].push({ id: "concurrent", ...payload });
              return { data: null, error: { code: "23505", message: "duplicate name" } };
            }
            const created = { id: `new-${rows[table].length}`, ...payload };
            rows[table].push(created);
            return { data: created, error: null };
          }
          let found = rows[table].filter((row) => filters.every((filter) => filter(row)));
          if (bounds) found = found.slice(bounds[0], bounds[1] + 1);
          if (operation === "update") for (const row of found) Object.assign(row, payload);
          return { data: single ? found[0] ?? null : found, error: null };
        },
        single() { return query.execute(true); },
        maybeSingle() { return query.execute(true); },
        then(resolve, reject) { return query.execute().then(resolve, reject); },
      };
      return query;
    },
  };
  const dependencies = {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/annotations/label-colors": palette,
  };
  return { rows, queries, ...load("./labels.ts", dependencies), ...load("./annotations.ts", dependencies) };
}

test("reuses existing labels and merges source names without changing existing colors", async () => {
  const s = setup();
  const result = await s.resolveDatasetLabels("project", [
    { id: "1", name: " CAT " }, { id: "2", name: " Dog " },
    { id: "3", name: "dog" }, { id: "__proto__", name: "Bird" },
  ]);
  assert.deepEqual(result, [
    { categoryId: "1", labelId: "cat" }, { categoryId: "2", labelId: "new-1" },
    { categoryId: "3", labelId: "new-1" }, { categoryId: "__proto__", labelId: "new-2" },
  ]);
  assert.equal(s.rows.project_labels[0].color, "existing");
  assert.equal(s.rows.project_labels[1].name, "Dog");
  assert.equal(s.rows.project_labels[1].color, palette.pickLabelColor(1));
  assert.equal(s.rows.project_labels[2].color, palette.pickLabelColor(2));
});

test("does not reuse a same-name label from another project", async () => {
  const s = setup({ labels: [{ id: "foreign-cat", project_id: "foreign", name: "Cat", color: "foreign" }] });
  const result = await s.resolveDatasetLabels("project", [{ id: "1", name: "Cat" }]);
  assert.notEqual(result[0].labelId, "foreign-cat");
  assert.equal(s.rows.project_labels[1].project_id, "project");
  assert.equal(s.rows.project_labels[1].color, palette.pickLabelColor(0));
});

test("rejects malformed batches before any write", async () => {
  for (const categories of [null, {}, [null], [{ id: "", name: "Cat" }],
    [{ id: "a", name: " " }], [{ id: "a", name: "Dog" }, { id: "a", name: "Bird" }],
    [{ id: "a", name: "Dog" }, { id: "b", name: null }]]) {
    const s = setup();
    await assert.rejects(s.resolveDatasetLabels("project", categories));
    assert.equal(s.queries.length, 0);
  }
});

test("both actions reject unauthenticated and unowned projects without writes", async () => {
  for (const [options, projectId] of [[{ signedOut: true }, "project"], [{}, "foreign"], [{}, "missing"]]) {
    const s = setup(options);
    await assert.rejects(s.resolveDatasetLabels(projectId, [{ id: "1", name: "Cat" }]));
    await assert.rejects(s.saveImageAnnotations(projectId, "image", [box()]));
    assert.ok(s.queries.every((q) => q.operation === "read"));
  }
});

test("empty categories still authenticate and verify ownership", async () => {
  const s = setup();
  assert.deepEqual(await s.resolveDatasetLabels("project", []), []);
  assert.deepEqual(s.queries.map((q) => q.table), ["projects"]);
  await assert.rejects(s.resolveDatasetLabels("foreign", []), /access/);
});

test("paginates label reads beyond the first page", async () => {
  const labels = Array.from({ length: 501 }, (_, i) => ({ id: `label-${i}`, name: `Name ${i}`, project_id: "project", color: "existing" }));
  const s = setup({ labels });
  assert.deepEqual(await s.resolveDatasetLabels("project", [{ id: "source", name: "name 500" }]), [{ categoryId: "source", labelId: "label-500" }]);
  assert.equal(s.queries.filter((q) => q.table === "project_labels").length, 2);
  assert.equal(labels.length, 501);
});

test("concurrent duplicate creation reuses the newly created label", async () => {
  const s = setup({ race: true });
  assert.deepEqual(await s.resolveDatasetLabels("project", [{ id: "1", name: "Dog" }, { id: "2", name: "DOG" }]), [
    { categoryId: "1", labelId: "concurrent" }, { categoryId: "2", labelId: "concurrent" },
  ]);
  assert.equal(s.queries.filter((q) => q.operation === "insert").length, 1);
});

test("label read and insert errors are propagated", async () => {
  for (const operation of ["read", "insert"]) {
    const s = setup({ fail: (table, op) => table === "project_labels" && op === operation ? { message: "database unavailable" } : null });
    await assert.rejects(s.resolveDatasetLabels("project", [{ id: "1", name: "Dog" }]), /database unavailable/);
  }
});

test("saves valid annotations, deduplicating membership checks", async () => {
  const s = setup();
  const boxes = [box(), { ...box(), id: "box-2" }];
  const result = await s.saveImageAnnotations("project", "image", boxes);
  assert.ok(Number.isFinite(Date.parse(result.savedAt)));
  assert.deepEqual(s.rows.images[0].annotation, boxes);
  assert.equal(s.queries.filter((q) => q.table === "project_labels").length, 1);
});

test("missing and cross-project labels never update annotations", async () => {
  for (const labelId of ["missing", "foreign-cat"]) {
    const s = setup();
    s.rows.project_labels.push({ id: "foreign-cat", project_id: "foreign", name: "Foreign" });
    await assert.rejects(s.saveImageAnnotations("project", "image", [box(labelId)]), /do not belong/);
    assert.ok(s.queries.every((q) => q.operation !== "update"));
    assert.deepEqual(s.rows.images[0].annotation, [box()]);
  }
});

test("label lookup errors fail closed", async () => {
  const s = setup({ fail: (table) => table === "project_labels" ? { message: "lookup failed" } : null });
  await assert.rejects(s.saveImageAnnotations("project", "image", [box()]), /lookup failed/);
  assert.ok(s.queries.every((q) => q.operation !== "update"));
});

test("later validation batches must succeed before image update", async () => {
  const labels = Array.from({ length: 101 }, (_, i) => ({ id: `label-${i}`, name: `Name ${i}`, project_id: "project", color: "x" }));
  const s = setup({ labels });
  const boxes = labels.map((label, i) => ({ ...box(label.id), id: `box-${i}` }));
  await s.saveImageAnnotations("project", "image", boxes);
  assert.equal(s.queries.filter((q) => q.table === "project_labels").length, 2);
  s.queries.length = 0;
  boxes.push({ ...box("missing"), id: "bad" });
  await assert.rejects(s.saveImageAnnotations("project", "image", boxes), /do not belong/);
  assert.ok(s.queries.every((q) => q.operation !== "update"));
});

test("empty annotation saves still clear boxes without label lookup", async () => {
  const s = setup();
  await s.saveImageAnnotations("project", "image", []);
  assert.deepEqual(s.rows.images[0].annotation, []);
  assert.ok(s.queries.every((q) => q.table !== "project_labels"));
});

test("existing geometry, count, image membership, and update-error checks remain", async () => {
  const s = setup();
  for (const boxes of [[{ ...box(), x: -1 }], [{ ...box(), width: 0 }], [{ ...box(), height: Infinity }], Array(50_001).fill(box())]) {
    await assert.rejects(s.saveImageAnnotations("project", "image", boxes), /bounding-box/);
  }
  assert.equal(s.queries.length, 0);
  await assert.rejects(s.saveImageAnnotations("project", "missing", [box()]), /Image not found/);
  const failure = setup({ fail: (table) => table === "images" ? { message: "write failed" } : null });
  await assert.rejects(failure.saveImageAnnotations("project", "image", [box()]), /write failed/);
});
