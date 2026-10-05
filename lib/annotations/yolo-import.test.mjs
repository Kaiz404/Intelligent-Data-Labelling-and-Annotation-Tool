// node --test lib/annotations/yolo-import.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import JSZip from "jszip";

function load(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const coco = load("./coco-import.ts");
const parser = load("./yolo-import.ts", {
  "@/lib/annotations/coco-import": coco, "@/lib/annotations/formats": load("./formats.ts"),
});
const { parseYoloClasses, parseYoloAnnotations, parseYoloDataset } = parser;
const { decodeDatasetImage } = load("../uploads/dataset-image.ts");
const { readYoloDatasetZip } = load("../uploads/yolo-dataset-zip.ts", {
  jszip: JSZip, "@/lib/annotations/coco-import": coco,
  "@/lib/annotations/yolo-import": parser, "@/lib/uploads/dataset-image": { decodeDatasetImage },
});
const categories = parseYoloClasses("Cat\nDog\nUnused");
const size = { width: 101, height: 73 };
const row = "0 0.5 0.5 0.25 0.4";

test("class table preserves IDs, unused classes, BOM, CRLF, and trimmed names", () => {
  assert.deepEqual(parseYoloClasses("\uFEFF Cat \r\nDog\r\nUnused\r\n"), categories);
  // Equivalent names retain separate source IDs; project label resolution merges later.
  assert.deepEqual(parseYoloClasses("Cat\ncat").map((category) => category.id), ["0", "1"]);
  for (const text of ["", "Cat\n\nDog", "Cat\n \nDog", "Cat\n\n"]) {
    assert.throws(() => parseYoloClasses(text, "data/classes.txt"), /data\/classes\.txt:\d+:.*non-empty/);
  }
});

test("multiple images and classes produce source-local IDs and fractional original pixels", () => {
  const result = parseYoloDataset("Cat\nDog\nUnused", [
    { path: "nested/cat.png", ...size, annotation: { path: "labels/nested/cat.txt", text: `\uFEFF${row}\r\n1 0.2 0.3 0.1 0.2\r\n` } },
    { path: "empty.jpg", width: 10, height: 20, annotation: { path: "labels/empty.txt", text: " \r\n" } },
    { path: "missing.png", width: 10, height: 20 },
  ]);
  assert.deepEqual(result.categories, categories);
  assert.equal(result.images.length, 3);
  const box = result.images[0].boxes[0];
  assert.equal(box.id, "labels/nested/cat.txt:1");
  assert.equal(box.categoryId, "0");
  assert.equal(box.x, 37.875);
  assert.equal(box.width, 25.25);
  assert.ok(Math.abs(box.y - 21.9) < 1e-10);
  assert.ok(Math.abs(box.height - 29.2) < 1e-10);
  assert.equal(result.images[0].boxes[1].categoryId, "1");
  assert.deepEqual(result.images.slice(1).map((image) => image.boxes), [[], []]);
});

for (const [name, text, error] of [
  ["negative ID", "-1 0.5 0.5 0.2 0.2", /nonnegative safe integer/],
  ["fractional ID", "0.5 0.5 0.5 0.2 0.2", /nonnegative safe integer/],
  ["unsafe ID", "9007199254740992 0.5 0.5 0.2 0.2", /safe integer/],
  ["unknown ID", "3 0.5 0.5 0.2 0.2", /not declared/],
  ["short row", "0 0.5 0.5 0.2", /exactly five/],
  ["confidence", "0 0.5 0.5 0.2 0.2 0.9", /exactly five/],
  ["segmentation", "0 0 0 1 0 1 1", /exactly five/],
  ["pose", "0 0.5 0.5 0.2 0.2 0.1 0.2 2", /exactly five/],
  ["OBB", "0 0 0 1 0 1 1 0 1", /exactly five/],
  ["NaN", "0 NaN 0.5 0.2 0.2", /finite decimal/],
  ["infinity", "0 Infinity 0.5 0.2 0.2", /finite decimal/],
  ["overflow", "0 1e999 0.5 0.2 0.2", /finite decimal/],
  ["hexadecimal", "0 0x1 0.5 0.2 0.2", /finite decimal/],
  ["negative centre", "0 -0.01 0.5 0.2 0.2", /normalized/],
  ["centre above one", "0 1.01 0.5 0.2 0.2", /normalized/],
  ["size above one", "0 0.5 0.5 1.000001 0.2", /normalized/],
  ["zero width", "0 0.5 0.5 0 0.2", /must be positive/],
  ["negative height", "0 0.5 0.5 0.2 -0.2", /must be positive/],
  ["left overflow", "0 0.05 0.5 0.2 0.2", /exceeds image bounds/],
  ["right overflow", "0 0.95 0.5 0.2 0.2", /exceeds image bounds/],
  ["top overflow", "0 0.5 0.05 0.2 0.2", /exceeds image bounds/],
  ["bottom overflow", "0 0.5 0.95 0.2 0.2", /exceeds image bounds/],
]) {
  test(`rejects ${name} with annotation path and physical line number`, () => {
    assert.throws(() => parseYoloAnnotations(`\r\n${row}\r\n${text}`, categories, size, "labels/bad.txt"),
      (failure) => /labels\/bad\.txt:3:/.test(failure.message) && error.test(failure.message));
  });
}

test("rounding-sized corner excursions snap to the edge; material violations are rejected", () => {
  const [left] = parseYoloAnnotations("0 0.166666 0.5 0.333333 1", categories, size, "left.txt");
  assert.equal(left.x, 0);
  assert.ok(left.width > 0 && left.width < 0.333333 * size.width);
  const [right] = parseYoloAnnotations("0 0.833334 0.5 0.333333 1", categories, size, "right.txt");
  assert.ok(Math.abs(right.x + right.width - size.width) < 1e-10);
  const [top] = parseYoloAnnotations("0 0.5 0.166666 1 0.333333", categories, size, "top.txt");
  assert.equal(top.y, 0);
  const [bottom] = parseYoloAnnotations("0 0.5 0.833334 1 0.333333", categories, size, "bottom.txt");
  assert.ok(Math.abs(bottom.y + bottom.height - size.height) < 1e-10);
  const [full] = parseYoloAnnotations("0 0.5 0.5 1 1", categories, size, "full.txt");
  assert.equal(full.width, 101); assert.equal(full.height, 73);
  assert.throws(() => parseYoloAnnotations("0 0.166665 0.5 0.333333 1", categories, size, "bad.txt"), /exceeds/);
});

test("50,000 boxes accepted, 50,001 rejected with offending line", () => {
  const text = Array(50_000).fill(row).join("\n");
  assert.equal(parseYoloAnnotations(text, categories, size, "big.txt").length, 50_000);
  assert.throws(() => parseYoloAnnotations(`${text}\n${row}`, categories, size, "big.txt"), /big\.txt:50001:.*50,000-box/);
});

test("pure dataset parser rejects invalid dimensions, duplicate/unsafe paths and unsupported images", () => {
  const image = { path: "a.png", ...size };
  assert.throws(() => parseYoloDataset("Cat", [image, image]), /Duplicate/);
  for (const width of [0, -1, 1.5, Infinity]) assert.throws(() => parseYoloDataset("Cat", [{ ...image, width }]), /positive safe/);
  assert.throws(() => parseYoloDataset("Cat", [{ ...image, path: "../a.png" }]), /Unsafe/);
  assert.throws(() => parseYoloDataset("Cat", [{ ...image, path: "a.webp" }]), /JPEG and PNG/);
});

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Uint8Array.from([255, 216, 255, 1]);
async function archive(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return new File([await zip.generateAsync({ type: "uint8array" })], "dataset.zip");
}

test("YOLO ZIP integration (browser decoder stubbed)", async (t) => {
  const previous = globalThis.createImageBitmap;
  let closed = 0;
  t.after(() => { globalThis.createImageBitmap = previous; });
  globalThis.createImageBitmap = async () => ({ ...size, close() { closed++; } });
  await t.test("multiple classes/images, empty labels and missing-label negatives", async () => {
    const result = await readYoloDatasetZip(await archive({
      "classes.txt": "\uFEFFCat\r\nDog\r\nUnused\r\n",
      "images/a.png": png, "labels/a.txt": `\uFEFF${row}\r\n1 0.5 0.5 0.1 0.1\r\n`,
      "images/empty.jpg": jpeg, "labels/empty.txt": "",
      "images/negative.png": png,
    }));
    assert.equal(result.annotationPath, "classes.txt");
    assert.deepEqual(result.categories, categories);
    assert.equal(result.images.length, 3);
    assert.equal(result.images[0].boxes.length, 2);
    assert.equal(result.images[0].width, 101);
    assert.equal(result.images[0].file.name, "a.png");
    assert.equal(result.images[1].file.type, "image/jpeg");
    assert.equal(result.images[1].boxes.length, 0);
    assert.equal(result.images[2].boxes.length, 0);
    assert.deepEqual(result.missingLabelImagePaths, ["images/negative.png"]);
  });
  for (const [name, files, expectedPath] of [
    ["enclosing folder and nested paths", { "dataset/classes.txt": "Cat", "dataset/images/train/a.png": png, "dataset/labels/train/a.txt": row }, "dataset/images/train/a.png"],
    ["nested duplicate basenames remain distinct", { "classes.txt": "Cat", "images/a/cat.png": png, "images/b/cat.png": png, "labels/a/cat.txt": row, "labels/b/cat.txt": row }, "images/a/cat.png"],
    ["sanitized fallback", { "classes.txt": "Cat", "images/street scene.png": png, "labels/street-scene.txt": row }, "images/street scene.png"],
    ["nested sanitized fallback", { "classes.txt": "Cat", "images/train/street scene.png": png, "labels/train/street-scene.txt": row }, "images/train/street scene.png"],
    ["flattened app-export fallback", { "classes.txt": "Cat", "images/train/street scene.png": png, "labels/street-scene.txt": row }, "images/train/street scene.png"],
    ["case-insensitive extensions", { "classes.txt": "Cat", "images/a.PNG": png, "labels/a.TXT": row }, "images/a.PNG"],
  ]) {
    await t.test(name, async () => {
      const result = await readYoloDatasetZip(await archive(files));
      assert.equal(result.images[0].archivePath, expectedPath);
      assert.equal(result.images[0].boxes.length, 1);
      assert.deepEqual(result.missingLabelImagePaths, []);
    });
  }
  for (const [name, files, error] of [
    ["missing classes", { "images/a.png": png, "labels/a.txt": row }, /requires classes\.txt/],
    ["YAML only", { "data.yaml": "names: [Cat]", "images/a.png": png }, /data.yaml-only/],
    ["missing image bytes", { "classes.txt": "Cat", "labels/a.txt": row }, /image bytes/],
    ["orphan label", { "classes.txt": "Cat", "images/a.png": png, "labels/orphan.txt": row }, /Orphan label/],
    ["same stem different extensions", { "classes.txt": "Cat", "images/a.png": png, "images/a.jpg": jpeg, "labels/a.txt": row }, /Ambiguous image stem/],
    ["sanitization collision", { "classes.txt": "Cat", "images/a b.png": png, "images/a-b.png": png, "labels/a-b.txt": row }, /Ambiguous label/],
    ["flattened collision", { "classes.txt": "Cat", "images/train/a.png": png, "images/test/a.png": png, "labels/a.txt": row }, /Ambiguous label/],
    ["multiple labels per image", { "classes.txt": "Cat", "images/train/a b.png": png, "labels/train/a b.txt": row, "labels/a-b.txt": row }, /Multiple label files/],
    ["label extension collision", { "classes.txt": "Cat", "images/a.png": png, "labels/a.txt": row, "labels/a.TXT": row }, /Colliding label stem/],
    ["path normalization collision", { "classes.txt": "Cat", "images/a.png": png, "images\\a.png": png }, /Colliding ZIP paths/],
    ["unsafe traversal", { "classes.txt": "Cat", "../images/a.png": png }, /Unsafe dataset path/],
    ["multiple roots", { "classes.txt": "Cat", "other/classes.txt": "Cat", "images/a.png": png }, /multiple classes/],
    ["two enclosing folders", { "outer/inner/classes.txt": "Cat", "outer/inner/images/a.png": png }, /one enclosing/],
    ["outside image root", { "classes.txt": "Cat", "images/a.png": png, "other/images/b.png": png }, /outside the selected/],
    ["outside label root", { "data/classes.txt": "Cat", "data/images/a.png": png, "labels/a.txt": row }, /outside the selected/],
    ["unsupported image", { "classes.txt": "Cat", "images/a.webp": png }, /JPEG and PNG/],
    ["invalid label extension", { "classes.txt": "Cat", "images/a.png": png, "labels/a.json": "{}" }, /\.txt detection/],
    ["wrong image signature", { "classes.txt": "Cat", "images/a.png": "not an image" }, /contents do not match/],
    ["bad class in label", { "classes.txt": "Cat", "images/a.png": png, "labels/a.txt": "1 0.5 0.5 0.2 0.2" }, /labels\/a.txt:1:.*not declared/],
  ]) await t.test(name, async () => { await assert.rejects(readYoloDatasetZip(await archive(files)), error); });
  assert.ok(closed >= 10);
  globalThis.createImageBitmap = async () => { throw new Error("corrupt image"); };
  await assert.rejects(readYoloDatasetZip(await archive({ "classes.txt": "Cat", "images/a.png": png })), /could not decode/);
  globalThis.createImageBitmap = async () => ({ width: 0, height: 73, close() { closed++; } });
  await assert.rejects(readYoloDatasetZip(await archive({ "classes.txt": "Cat", "images/a.png": png })), /positive safe integers/);
  delete globalThis.createImageBitmap;
  await assert.rejects(readYoloDatasetZip(await archive({ "classes.txt": "Cat", "images/a.png": png })), /createImageBitmap support/);
  await assert.rejects(readYoloDatasetZip(new File(["bad"], "bad.zip")), /Could not read/);
});
