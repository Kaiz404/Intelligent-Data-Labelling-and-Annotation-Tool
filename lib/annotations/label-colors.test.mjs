// node --test lib/annotations/label-colors.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Same dependency-free TypeScript loading approach as editor.test.mjs.
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

const { LABEL_COLOR_PALETTE, pickLeastUsedLabelColor } = load("./label-colors.ts");

test("new labels take palette colours in order", () => {
  assert.equal(pickLeastUsedLabelColor([]), LABEL_COLOR_PALETTE[0]);
  assert.equal(pickLeastUsedLabelColor(LABEL_COLOR_PALETTE.slice(0, 3)), LABEL_COLOR_PALETTE[3]);
});

test("a deleted label's colour is reused before any colour repeats", () => {
  // Labels 0, 1 and 3 remain after label 2 was deleted.
  const used = [LABEL_COLOR_PALETTE[0], LABEL_COLOR_PALETTE[1], LABEL_COLOR_PALETTE[3]];
  assert.equal(pickLeastUsedLabelColor(used), LABEL_COLOR_PALETTE[2]);
});

test("once every colour is used, the least used one comes next (case-insensitive)", () => {
  const used = [...LABEL_COLOR_PALETTE, LABEL_COLOR_PALETTE[0].toUpperCase()];
  assert.equal(pickLeastUsedLabelColor(used), LABEL_COLOR_PALETTE[1]);
});
