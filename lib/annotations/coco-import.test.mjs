// Run with: node --test lib/annotations/coco-import.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import JSZip from "jszip";

// Use the installed TypeScript compiler without introducing a test dependency.
function loadTypeScript(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const parser = loadTypeScript("./coco-import.ts");
const { parseCocoDataset, normalizeDatasetPath } = parser;
const { readCocoDatasetZip } = loadTypeScript("../uploads/dataset-zip.ts", {
  jszip: JSZip, "@/lib/annotations/coco-import": parser,
});

function dataset() {
  return {
    images: [{ id: 42, file_name: "a.png", width: 2, height: 3 }],
    categories: [{ id: 9, name: " Cat " }],
    annotations: [{ id: 7, image_id: 42, category_id: 9, bbox: [0, 0, 2, 3] }],
  };
}

test("normalizes geometry, source IDs, names, and includes empty images", () => {
  const data = dataset();
  data.images.push({ id: 0, file_name: "empty.jpg", width: 4, height: 5 });
  const plan = parseCocoDataset(JSON.stringify(data));
  assert.deepEqual(plan.categories, [{ id: "9", name: "Cat" }]);
  assert.deepEqual(plan.images[0].boxes, [{ id: "7", categoryId: "9", x: 0, y: 0, width: 2, height: 3 }]);
  assert.deepEqual(plan.images[1].boxes, []);
  assert.equal(data.categories[0].name, " Cat ");
});

const invalidCases = [
  ["duplicate image", (d) => d.images.push(d.images[0]), /Duplicate image ID/],
  ["duplicate category", (d) => d.categories.push(d.categories[0]), /Duplicate category ID/],
  ["duplicate annotation", (d) => d.annotations.push(d.annotations[0]), /Duplicate annotation ID/],
  ["unsafe ID", (d) => { d.images[0].id = Number.MAX_SAFE_INTEGER + 1; }, /safe integer/],
  ["unknown image", (d) => { d.annotations[0].image_id = 1; }, /unknown image/],
  ["unknown category", (d) => { d.annotations[0].category_id = 1; }, /unknown category/],
  ["blank name", (d) => { d.categories[0].name = "  "; }, /non-empty name/],
  ["zero dimension", (d) => { d.images[0].width = 0; }, /positive integer/],
  ["infinite dimension", (d) => { d.images[0].height = Infinity; }, /positive integer/],
  ["fractional dimension", (d) => { d.images[0].height = 2.5; }, /positive integer/],
  ["nonfinite bbox", (d) => { d.annotations[0].bbox[0] = NaN; }, /finite numbers/],
  ["short bbox", (d) => { d.annotations[0].bbox.pop(); }, /four finite/],
  ["negative origin", (d) => { d.annotations[0].bbox[0] = -1; }, /nonnegative/],
  ["zero extent", (d) => { d.annotations[0].bbox[2] = 0; }, /positive width/],
  ["outside width", (d) => { d.annotations[0].bbox[2] = 3; }, /exceeds image/],
  ["outside height", (d) => { d.annotations[0].bbox[1] = 1; }, /exceeds image/],
  ["crowd", (d) => { d.annotations[0].iscrowd = 1; }, /crowd/],
  ["polygon", (d) => { d.annotations[0].segmentation = [[0, 1]]; }, /segmentation/],
  ["RLE", (d) => { d.annotations[0].segmentation = { counts: "abc" }; }, /segmentation/],
  ["keypoints", (d) => { d.annotations[0].keypoints = [0, 0, 0]; }, /keypoints/],
  ["keypoint count", (d) => { d.annotations[0].num_keypoints = 1; }, /keypoint/],
  ["unsupported image", (d) => { d.images[0].file_name = "a.webp"; }, /JPEG and PNG/],
  ["traversal", (d) => { d.images[0].file_name = "../a.png"; }, /Unsafe dataset path/],
];
for (const [name, mutate, error] of invalidCases) {
  test(`rejects ${name}`, () => { const data = dataset(); mutate(data); assert.throws(() => parseCocoDataset(data), error); });
}
test("JSON structure and harmless empty optional fields", () => {
  assert.throws(() => parseCocoDataset("{"), /valid JSON/);
  assert.throws(() => parseCocoDataset({}), /images must be an array/);
  const data = dataset();
  Object.assign(data.annotations[0], { iscrowd: 0, segmentation: [], keypoints: [], num_keypoints: 0 });
  assert.equal(parseCocoDataset(data).images.length, 1);
});
test("50,000 boxes accepted; 50,001 rejected", () => {
  const data = dataset();
  data.annotations = Array.from({ length: 50_000 }, (_, id) => ({ ...data.annotations[0], id }));
  assert.equal(parseCocoDataset(data).images[0].boxes.length, 50_000);
  data.annotations.push({ ...data.annotations[0], id: 50_000 });
  assert.throws(() => parseCocoDataset(data), /50,000-box limit/);
});
test("path normalization preserves relative identity and rejects unsafe paths", () => {
  assert.equal(normalizeDatasetPath("./train\\folder//a.png"), "train/folder/a.png");
  for (const path of ["/a.png", "C:\\a.png", "https://a.png", "a/../b.png", "a\0.png", ""]) {
    assert.throws(() => normalizeDatasetPath(path));
  }
});

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function archive(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return new File([await zip.generateAsync({ type: "uint8array" })], "dataset.zip");
}

test("ZIP integration (browser decoder stubbed)", async (t) => {
  let closed = 0;
  const originalDecoder = globalThis.createImageBitmap;
  t.after(() => { globalThis.createImageBitmap = originalDecoder; });
  globalThis.createImageBitmap = async () => ({ width: 2, height: 3, close() { closed++; } });
  const json = JSON.stringify(dataset());
  for (const [name, files, expected] of [
    ["app export", { "annotations.json": json, "images/a.png": png, "readme.txt": "extra" }, "images/a.png"],
    ["relative to document", { "folder/annotations.json": json, "folder/a.png": png }, "folder/a.png"],
    ["unique basename", { "annotations.json": json, "train/a.png": png }, "train/a.png"],
    ["exact before basename", { "annotations.json": json, "a.png": png, "other/a.png": png }, "a.png"],
    ["unrelated JSON", { "annotations.json": json, "a.png": png, "extra.json": "oops" }, "a.png"],
  ]) {
    await t.test(name, async () => {
      const plan = await readCocoDatasetZip(await archive(files));
      assert.equal(plan.images[0].archivePath, expected);
      assert.equal(plan.images[0].file.type, "image/png");
      assert.equal(plan.images[0].boxes.length, 1);
    });
  }
  for (const [name, files, error] of [
    ["missing file", { "annotations.json": json }, /Missing referenced/],
    ["ambiguous basename", { "annotations.json": json, "x/a.png": png, "y/a.png": png }, /Ambiguous referenced/],
    ["multiple documents", { "one.json": json, "two.json": json }, /multiple COCO/],
    ["invalid JSON", { "annotations.json": "{" }, /not valid JSON/],
    ["no document", { "a.png": png }, /one COCO JSON/],
    ["wrong signature", { "annotations.json": json, "a.png": "not an image" }, /contents do not match/],
    ["unsafe entry", { "annotations.json": json, "../a.png": png }, /Missing referenced/],
  ]) {
    await t.test(name, async () => { await assert.rejects(readCocoDatasetZip(await archive(files)), error); });
  }
  assert.equal(closed, 5);
  const file = await archive({ "annotations.json": json, "a.png": png });
  globalThis.createImageBitmap = async () => ({ width: 3, height: 2, close() { closed++; } });
  await assert.rejects(readCocoDatasetZip(file), /actual dimensions 3×2/);
  assert.equal(closed, 6);
  globalThis.createImageBitmap = async () => { throw new Error("corrupt image"); };
  await assert.rejects(readCocoDatasetZip(file), /could not decode/);
  await assert.rejects(readCocoDatasetZip(new File(["bad"], "bad.zip")), /Could not read/);
});

// Node has no image decoder. Only the ZIP integration suite substitutes it;
// real pixel decoding is exercised by the browser's createImageBitmap at runtime.
