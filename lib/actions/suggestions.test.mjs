// node --test lib/actions/suggestions.test.mjs
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

const suggestion = (id, x = 0) => ({ id, labelId: "cat", x, y: 0, width: 2, height: 3, confidence: 0.9 });

/** `beforeUpdate(row)` runs before each update, e.g. to simulate a worker writing first. */
function setup({ items, signedOut = false, beforeUpdate } = {}) {
  const rows = items ?? [
    { id: "item", project_id: "project", suggestions: [suggestion("a"), suggestion("b"), suggestion("c")], updated_at: "t0" },
  ];
  const updates = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: signedOut ? null : { id: "user" } } }) },
    from() {
      const filters = [];
      let payload;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        update(value) { payload = value; return query; },
        async run(single) {
          if (payload) {
            beforeUpdate?.(rows);
            updates.push(payload);
          }
          const found = rows.filter((row) => filters.every((filter) => filter(row)));
          if (payload) found.forEach((row) => Object.assign(row, payload));
          return { data: single ? found[0] ?? null : found, error: null };
        },
        maybeSingle() { return query.run(true); },
        then(resolve, reject) { return query.run(false).then(resolve, reject); },
      };
      return query;
    },
  };
  const { resolveSuggestions } = load("./suggestions.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
  });
  return { resolveSuggestions, rows, updates };
}

test("keeps only suggestions still pending server-side, with the client's geometry", async () => {
  const s = setup();
  await s.resolveSuggestions("project", [
    { itemId: "item", remaining: [suggestion("a", 40), suggestion("c"), suggestion("new")] },
  ]);
  assert.deepEqual(s.rows[0].suggestions, [suggestion("a", 40), suggestion("c")]);
});

test("a stale client cannot restore suggestions that were already cleared", async () => {
  const s = setup({ items: [{ id: "item", project_id: "project", suggestions: [], updated_at: "t0" }] });
  await s.resolveSuggestions("project", [{ itemId: "item", remaining: [suggestion("a"), suggestion("b")] }]);
  assert.deepEqual(s.rows[0].suggestions, []);
  assert.equal(s.updates.length, 0);
});

test("an empty remaining list clears the item", async () => {
  const s = setup();
  await s.resolveSuggestions("project", [{ itemId: "item", remaining: [] }]);
  assert.deepEqual(s.rows[0].suggestions, []);
});

test("a concurrent clear between read and write is not overwritten", async () => {
  let raced = false;
  const s = setup({
    beforeUpdate(rows) {
      if (raced) return;
      raced = true;
      Object.assign(rows[0], { suggestions: [], updated_at: "t1" }); // newer run supersedes
    },
  });
  await s.resolveSuggestions("project", [{ itemId: "item", remaining: [suggestion("a")] }]);
  assert.deepEqual(s.rows[0].suggestions, []);
});

test("an unchanged list is not rewritten, regardless of stored key order", async () => {
  const stored = { confidence: 0.9, height: 3, id: "a", labelId: "cat", width: 2, x: 0, y: 0 };
  const s = setup({ items: [{ id: "item", project_id: "project", suggestions: [stored], updated_at: "t0" }] });
  await s.resolveSuggestions("project", [{ itemId: "item", remaining: [suggestion("a")] }]);
  assert.equal(s.updates.length, 0);
});

test("items in another project are left untouched", async () => {
  const s = setup({
    items: [{ id: "item", project_id: "other", suggestions: [suggestion("a")], updated_at: "t0" }],
  });
  await s.resolveSuggestions("project", [{ itemId: "item", remaining: [] }]);
  assert.deepEqual(s.rows[0].suggestions, [suggestion("a")]);
  assert.equal(s.updates.length, 0);
});

test("rejects invalid input and signed-out users before any write", async () => {
  for (const remaining of [[{ ...suggestion("a"), width: 0 }], [{ ...suggestion("a"), confidence: "high" }], [null]]) {
    const s = setup();
    await assert.rejects(s.resolveSuggestions("project", [{ itemId: "item", remaining }]), /invalid/);
    assert.equal(s.updates.length, 0);
  }
  const s = setup({ signedOut: true });
  await assert.rejects(s.resolveSuggestions("project", [{ itemId: "item", remaining: [] }]), /signed in/);
  assert.equal(s.updates.length, 0);
});
