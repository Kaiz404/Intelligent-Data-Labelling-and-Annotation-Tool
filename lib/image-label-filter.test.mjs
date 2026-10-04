// node --test lib/image-label-filter.test.mjs
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

const { NO_LABELS, countImagesByLabel, matchesLabelFilter, parseLabelFilter, toggleLabelFilter } =
  load("./image-label-filter.ts");

const LABELS = ["cat", "dog", "bird"];
const image = (...labelIds) => ({ annotations: labelIds.map((labelId) => ({ labelId })) });
const IMAGES = {
  catOnly: image("cat", "cat"),
  catAndDog: image("cat", "dog"),
  dogOnly: image("dog"),
  empty: image(),
};

const matching = (selection) =>
  Object.entries(IMAGES)
    .filter(([, candidate]) => matchesLabelFilter(candidate, new Set(selection)))
    .map(([name]) => name);

test("an empty selection matches every image", () => {
  assert.deepEqual(matching([]), ["catOnly", "catAndDog", "dogOnly", "empty"]);
});

test("images match when they contain ANY selected label", () => {
  assert.deepEqual(matching(["cat"]), ["catOnly", "catAndDog"]);
  assert.deepEqual(matching(["cat", "dog"]), ["catOnly", "catAndDog", "dogOnly"]);
  assert.deepEqual(matching(["bird"]), []);
});

test("No labels matches only images without boxes, alone or with labels", () => {
  assert.deepEqual(matching([NO_LABELS]), ["empty"]);
  assert.deepEqual(matching(["dog", NO_LABELS]), ["catAndDog", "dogOnly", "empty"]);
});

test("parsing keeps project label order, drops unknown ids, and puts No labels last", () => {
  assert.deepEqual(parseLabelFilter(`${NO_LABELS},dog,deleted,cat`, LABELS), ["cat", "dog", NO_LABELS]);
  assert.deepEqual(parseLabelFilter("", LABELS), []);
  assert.deepEqual(parseLabelFilter("deleted", LABELS), []);
});

test("toggling adds or removes one key", () => {
  assert.equal(toggleLabelFilter(["cat"], "dog"), "cat,dog");
  assert.equal(toggleLabelFilter(["cat", "dog"], "cat"), "dog");
  assert.equal(toggleLabelFilter([NO_LABELS], NO_LABELS), "");
});

test("counts each image once per label, and images without boxes under No labels", () => {
  const counts = countImagesByLabel(Object.values(IMAGES));
  assert.equal(counts.get("cat"), 2);
  assert.equal(counts.get("dog"), 2);
  assert.equal(counts.get("bird"), undefined);
  assert.equal(counts.get(NO_LABELS), 1);
});
