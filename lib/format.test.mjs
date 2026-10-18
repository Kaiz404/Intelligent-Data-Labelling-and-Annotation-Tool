// node --test lib/format.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./format.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const compiled = { exports: {} };
new Function("exports", outputText)(compiled.exports);
const { formatTimeLeft } = compiled.exports;

test("formatTimeLeft rounds to whole minutes and splits hours", () => {
  assert.equal(formatTimeLeft(0), "less than a minute left");
  assert.equal(formatTimeLeft(59_999), "less than a minute left");
  assert.equal(formatTimeLeft(60_000), "about 1 min left");
  assert.equal(formatTimeLeft(12 * 60_000 + 20_000), "about 12 min left");
  assert.equal(formatTimeLeft(59 * 60_000 + 40_000), "about 1 h left");
  assert.equal(formatTimeLeft(125 * 60_000), "about 2 h 5 min left");
  assert.equal(formatTimeLeft(26 * 60 * 60_000), "about 26 h left");
});
