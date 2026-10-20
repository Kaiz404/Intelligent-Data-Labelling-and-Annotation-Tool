// node --test lib/annotations/batch-scopes.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as coco-import.test.mjs.
function load(path) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  new Function("require", "exports", outputText)((name) => {
    throw new Error(`Unexpected dependency: ${name}`);
  }, compiled.exports);
  return compiled.exports;
}

const { defaultBatchScope, resolveBatchScopes } = load("./batch-scopes.ts");

// Grid order: a, b, c, d, e.
const IMAGES = [
  { id: "a", status: "Annotated" },
  { id: "b", status: "Unannotated" },
  { id: "c", status: "Unannotated" },
  { id: "d", status: "Annotated" },
  { id: "e", status: "Unannotated" },
];

test("unannotated covers images without saved boxes, whatever their AI history", () => {
  const scopes = resolveBatchScopes(IMAGES, [], {
    b: { status: "succeeded", pendingSuggestions: 0 },
    c: { status: "failed", pendingSuggestions: 0 },
    d: { status: "succeeded", pendingSuggestions: 0 },
  });
  assert.deepEqual(scopes.unannotated, ["b", "c", "e"]);
});

test("unannotated skips images with AI suggestions waiting for review", () => {
  const scopes = resolveBatchScopes(IMAGES, [], {
    b: { status: "succeeded", pendingSuggestions: 3 },
    a: { status: "succeeded", pendingSuggestions: 1 },
  });
  assert.deepEqual(scopes.unannotated, ["c", "e"]);
});

test("selected and all follow grid order, not selection order", () => {
  const scopes = resolveBatchScopes(IMAGES, ["e", "a", "missing"], {});
  assert.deepEqual(scopes.selected, ["a", "e"]);
  assert.deepEqual(scopes.all, ["a", "b", "c", "d", "e"]);
});

test("the default scope is the first with images: selected, unannotated, all", () => {
  assert.equal(defaultBatchScope(resolveBatchScopes(IMAGES, ["a"], {})), "selected");
  assert.equal(defaultBatchScope(resolveBatchScopes(IMAGES, [], {})), "unannotated");
  const allAnnotated = IMAGES.map((image) => ({ ...image, status: "Annotated" }));
  assert.equal(defaultBatchScope(resolveBatchScopes(allAnnotated, [], {})), "all");
});
