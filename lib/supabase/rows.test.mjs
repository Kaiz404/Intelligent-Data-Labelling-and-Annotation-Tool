// node --test lib/supabase/rows.test.mjs
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

const { forEachRowPage } = load("./rows.ts", { "server-only": {} });

/** A PostgREST-like client over `count` rows that returns at most `maxRows` per request. */
function client({ count, maxRows = 1000, withCount = true, error = null }) {
  const requests = [];
  return {
    requests,
    from: () => {
      let options;
      let range;
      const query = {
        select(_columns, selectOptions) { options = selectOptions; return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        then(resolve, reject) {
          requests.push(range);
          return Promise.resolve().then(() => {
            if (error) return { data: null, error, count: null };
            const [from, to] = range;
            const end = Math.min(to + 1, from + maxRows, count);
            const data = Array.from({ length: Math.max(0, end - from) }, (_, index) => ({ id: from + index }));
            return { data, error: null, count: options?.count && withCount ? count : null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

async function collect(supabase) {
  const ids = [];
  await forEachRowPage(supabase, "images", "id", (rows) => ids.push(...rows.map((row) => row.id)));
  return ids.sort((a, b) => a - b);
}

const range = (n) => Array.from({ length: n }, (_, index) => index);

test("reads every row past the 1000-row cap", async () => {
  const supabase = client({ count: 2500 });
  assert.deepEqual(await collect(supabase), range(2500));
  assert.equal(supabase.requests.length, 3);
});

test("a lower max-rows cap sets the page size, so no rows are skipped", async () => {
  const supabase = client({ count: 1000, maxRows: 300 });
  assert.deepEqual(await collect(supabase), range(1000));
  assert.deepEqual(supabase.requests.slice(1).sort((a, b) => a[0] - b[0]), [[300, 599], [600, 899], [900, 1199]]);
});

test("a small table takes one request", async () => {
  const supabase = client({ count: 7 });
  assert.deepEqual(await collect(supabase), range(7));
  assert.equal(supabase.requests.length, 1);
});

test("without a count it reads on until a short page", async () => {
  const supabase = client({ count: 2100, withCount: false });
  assert.deepEqual(await collect(supabase), range(2100));
});

test("errors keep the PostgREST error as cause", async () => {
  const error = { code: "42P01", message: "missing" };
  await assert.rejects(
    forEachRowPage(client({ count: 0, error }), "images", "id", () => {}),
    (thrown) => thrown.cause === error && /Could not load images: missing/.test(thrown.message),
  );
});
