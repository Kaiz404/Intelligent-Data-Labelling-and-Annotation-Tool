// node --test lib/annotations/yolo-yaml.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import JSZip from "jszip";
import * as YAML from "yaml";
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
const manifestParser = load("./yolo-yaml.ts", { yaml: YAML });
const { parseYoloYaml, MAX_YOLO_YAML_BYTES } = manifestParser;
const coco = load("./coco-import.ts");
const geometry = load("./yolo-import.ts", {
  "@/lib/annotations/coco-import": coco, "@/lib/annotations/formats": load("./formats.ts"),
});
const { readYoloDatasetZip } = load("../uploads/yolo-dataset-zip.ts", {
  jszip: JSZip, "@/lib/annotations/coco-import": coco, "@/lib/annotations/yolo-import": geometry,
  "@/lib/annotations/yolo-yaml": manifestParser, "@/lib/uploads/dataset-image": load("../uploads/dataset-image.ts"),
});
const categories = [{ id: "0", name: "person" }, { id: "1", name: "car" }];
const basic = "names: [person, car]\ntrain: train/images\n";
const parse = (text) => parseYoloYaml(text, "dataset/data.yaml");

test("lists and numeric maps preserve class IDs, duplicates, unused names, BOM/CRLF", () => {
  for (const names of ["names: [person, car]", "names:\n  - person\n  - car", "names:\n  0: person\n  1: car", 'names:\n  "1": car\n  "0": person']) {
    assert.deepEqual(parse(`${names}\nnc: 2\ntrain: train/images`).categories, categories);
  }
  assert.deepEqual(parse(`\uFEFFnames: [' person ', car]\r\ntrain: train/images\r\n`).categories, categories);
  assert.deepEqual(parse("names: [Cat, Cat, cat, Unused]\ntrain: train/images").categories.map((category) => category.name), ["Cat", "Cat", "cat", "Unused"]);
  assert.equal(parse("names: [person]\ntrain: train/images\ntask: detect\nroboflow: {url: 'https://example.com', script: 'echo inert'}").categories.length, 1);
});
for (const [name, text, error] of [
  ["missing names", "nc: 2\ntrain: train/images", /names is required/],
  ["empty names", "names: []\ntrain: train/images", /at least one class/],
  ["blank name", "names: [' ']\ntrain: train/images", /non-blank string/],
  ["numeric name", "names: [123]\ntrain: train/images", /non-blank string/],
  ["boolean name", "names: [true]\ntrain: train/images", /non-blank string/],
  ["null name", "names: [null]\ntrain: train/images", /non-blank string/],
  ["nested name", "names: [{value: Cat}]\ntrain: train/images", /non-blank string/],
  ["gap", "names: {0: person, 2: car}\ntrain: train/images", /contiguous/],
  ["negative ID", "names: {-1: person}\ntrain: train/images", /canonical/],
  ["fractional ID", "names: {0.5: person}\ntrain: train/images", /canonical/],
  ["unsafe ID", "names: {9007199254740992: person}\ntrain: train/images", /safe integers/],
  ["noncanonical ID", 'names: {"00": person}\ntrain: train/images', /canonical/],
  ["duplicate numeric index", 'names: {0: person, "0": car}\ntrain: train/images', /duplicate class index/],
  ["duplicate YAML key", "names: {0: person, 0: car}\ntrain: train/images", /unique/],
  ["duplicate root key", basic + "train: valid/images", /unique/],
  ["nc mismatch", basic + "nc: 3", /matching names/],
  ["nc string", basic + 'nc: "2"', /positive integer/],
  ["nc fractional", basic + "nc: 2.5", /positive integer/],
  ["malformed YAML", "names: [\ntrain: train/images", /invalid YAML/],
  ["multiple documents", basic + "---\n" + basic, /invalid YAML/],
  ["nonmapping", "[person, car]", /mapping document/],
  ["anchor", "names: &classes [person, car]\ntrain: train/images", /aliases, anchors/],
  ["alias", basic + "meta: &m foo\nother: *m", /aliases, anchors/],
  ["merge", basic + "meta: {<<: {foo: bar}}", /merge keys/],
  ["custom tag", "names: !custom [person, car]\ntrain: train/images", /invalid YAML|tags/],
  ["explicit tag", "names: [!!str person, car]\ntrain: train/images", /tags/],
  ["no splits", "names: [person]\ntest:", /at least one populated/],
  ["split array", "names: [person]\ntrain: [train/images]", /split arrays/],
  ["image list", "names: [person]\ntrain: train.txt", /image-list/],
  ["nonstring path", basic + "path: 5", /relative directory string/],
  ["conflicting alias", basic + "val: val/images\nvalid: valid/images", /conflicting/],
  ["download configuration", basic + "download: 'echo dangerous'", /download-based/],
  ["non-detection task", basic + "task: segment", /object-detection/],
  ["keypoints", basic + "kpt_shape: [17, 3]", /object-detection/],
]) test(`manifest rejects ${name}`, () => assert.throws(() => parse(text), (failure) => failure.message.includes("dataset/data.yaml") && error.test(failure.message)));

test("path resolution syntax and Roboflow convention are explicitly bounded", () => {
  const result = parse("names: [person]\npath: content\ntrain: ./images//train/\nval: images/val\nvalid: images/val/\ntest:");
  assert.equal(result.path, "content");
  assert.deepEqual(result.splits, [{ name: "train", directory: "images/train" }, { name: "val", directory: "images/val" }]);
  assert.deepEqual(parse("names: [person]\ntrain: ../train/images\nval: ../valid/images\ntest: ../test/images").splits.map((split) => split.directory), ["train/images", "valid/images", "test/images"]);
});
for (const path of ["../../train/images", "../datasets/coco8", "train/../valid/images", "/train/images", "C:/train/images", "//server/share/images", "https://example.com/images", "$HOME/images", "%HOME%/images", "~/images", "train/*", "train/images;echo", "train/(images)", "train/images|echo"]) {
  test(`rejects unsafe path ${path}`, () => assert.throws(() => parse(`names: [person]\ntrain: '${path}'`), /unsafe|traversal/));
}

test("Roboflow compatibility does not apply to path itself or custom base directories", () => {
  assert.throws(() => parse(basic + "path: ../datasets/coco8"), /traversal/);
  assert.throws(() => parse("names: [person]\npath: content\ntrain: ../train/images"), /traversal/);
});

test("YAML byte, depth and node limits", () => {
  assert.throws(() => parse("#".repeat(MAX_YOLO_YAML_BYTES + 1)), /256 KiB/);
  assert.throws(() => parse(basic + "meta: " + "[".repeat(40) + "0" + "]".repeat(40)), /complexity/);
  assert.throws(() => parse(basic + "meta: [" + Array(20_001).fill("a").join(",") + "]"), /complexity/);
});

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const row = "0 0.5 0.5 0.25 0.4";
async function archive(files) {
  const zip = new JSZip();
  for (const [path, value] of Object.entries(files)) zip.file(path, value);
  return new File([await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })], "dataset.zip");
}
const files = () => ({ "data.yaml": basic, "train/images/a.png": png, "train/labels/a.txt": row });

test("YAML ZIP integration reuses signatures, decoding, geometry and split-scoped matching", async (t) => {
  const previous = globalThis.createImageBitmap;
  t.after(() => { globalThis.createImageBitmap = previous; });
  globalThis.createImageBitmap = async () => ({ width: 101, height: 73, close() {} });
  await t.test("split-first train/valid/test; same basename, empty and missing labels", async () => {
    const result = await readYoloDatasetZip(await archive({
      "data.yaml": basic + "val: valid/images\ntest: test/images\nnc: 2",
      "train/images/cat.png": png, "train/labels/cat.txt": row,
      "valid/images/cat.png": png, "valid/labels/cat.txt": "1 0.5 0.5 0.2 0.2",
      "test/images/empty.png": png, "test/labels/empty.txt": "",
      "test/images/negative.png": png,
    }));
    assert.deepEqual(result.categories, categories);
    assert.deepEqual(result.images.map((image) => image.path), ["train/images/cat.png", "valid/images/cat.png", "test/images/empty.png", "test/images/negative.png"]);
    assert.equal(new Set(result.images.map((image) => image.id)).size, 4);
    assert.equal(result.images[0].boxes[0].x, 37.875);
    assert.equal(result.images[0].boxes[0].width, 25.25);
    assert.equal(result.images[1].boxes[0].categoryId, "1");
    assert.deepEqual(result.images.slice(2).map((image) => image.boxes), [[], []]);
    assert.deepEqual(result.missingLabelImagePaths, ["test/images/negative.png"]);
    assert.equal(result.annotationPath, "data.yaml");
  });
  for (const [name, content, expected] of [
    ["images-first train/val", { "data.yaml": "names: {1: car, 0: person}\ntrain: images/train\nval: images/val", "images/train/a.png": png, "labels/train/a.txt": row, "images/val/a.png": png, "labels/val/a.txt": row }, "images/train/a.png"],
    ["valid YAML alias", { ...files(), "data.yaml": basic + "valid: valid/images", "valid/images/b.png": png }, "train/images/a.png"],
    ["nested root, custom base and nested paths", { "dataset/data.yaml": "names: [person]\npath: content\ntrain: images/train", "dataset/content/images/train/nested/a.png": png, "dataset/content/labels/train/nested/a.txt": row }, "dataset/content/images/train/nested/a.png"],
    ["Roboflow split-first", { ...files(), "data.yaml": basic.replace("train: train/images", "train: ../train/images") }, "train/images/a.png"],
    ["safe declared directory", { ...files(), "data.yaml": "names: [person]\ntrain: ./train//images/" }, "train/images/a.png"],
    ["sanitized fallback", { "data.yaml": basic, "train/images/nested/street scene.png": png, "train/labels/nested/street-scene.txt": row }, "train/images/nested/street scene.png"],
    ["consistent dual manifests use YAML", { ...files(), "classes.txt": " person \r\ncar\r\n" }, "train/images/a.png"],
  ]) await t.test(name, async () => {
    const result = await readYoloDatasetZip(await archive(content));
    assert.equal(result.images[0].archivePath, expected);
    assert.equal(result.images[0].file.size, 8);
    assert.equal(result.images[0].boxes.length, 1);
  });
  for (const [name, content, error] of [
    ["orphan labels", { ...files(), "train/labels/orphan.txt": row }, /Orphan/],
    ["sanitized collisions", { ...files(), "train/images/a b.png": png, "train/images/a-b.png": png, "train/labels/a-b.txt": row }, /Ambiguous label/],
    ["stem collisions", { ...files(), "train/images/a.jpg": png }, /Ambiguous image stem/],
    ["no cross-split fallback", { ...files(), "data.yaml": basic + "val: valid/images", "valid/images/b.png": png, "valid/labels/a.txt": row }, /Orphan/],
    ["overlapping splits", { ...files(), "data.yaml": basic + "val: train/images" }, /Overlapping/],
    ["nested overlap", { ...files(), "data.yaml": basic + "val: train/images/nested" }, /Overlapping/],
    ["undeclared test split", { ...files(), "test/images/b.png": png }, /outside the declared/],
    ["inconsistent manifests", { ...files(), "classes.txt": "person\ntruck" }, /inconsistent/],
    ["different manifest roots", { ...files(), "other/classes.txt": "person\ncar" }, /same dataset root/],
    ["multiple YAML roots", { ...files(), "other/data.yaml": basic }, /multiple data.yaml/],
    ["other image root", { ...files(), "other/train/images/b.png": png }, /outside the declared/],
    ["deep root", { "outer/inner/data.yaml": basic, "outer/inner/train/images/a.png": png }, /one enclosing/],
    ["oversized streamed YAML", { ...files(), "data.yaml": basic + "#".repeat(MAX_YOLO_YAML_BYTES) }, /256 KiB/],
    ["invalid signature", { ...files(), "train/images/a.png": "bad" }, /contents do not match/],
    ["unsupported layout", { ...files(), "data.yaml": "names: [person]\ntrain: train/pictures" }, /images\/ component/],
    ["missing declared split", { ...files(), "data.yaml": basic + "val: valid/images" }, /image bytes/],
    ["unsupported segmentation rows", { ...files(), "train/labels/a.txt": "0 0 0 1 0 1 1" }, /exactly five/],
    ["unsupported pose rows", { ...files(), "train/labels/a.txt": row + " 1 2 3" }, /exactly five/],
    ["unsupported OBB rows", { ...files(), "train/labels/a.txt": "0 0 0 1 0 1 1 0 1" }, /exactly five/],
    ["prediction confidence", { ...files(), "train/labels/a.txt": row + " 0.9" }, /exactly five/],
    ["invalid geometry", { ...files(), "train/labels/a.txt": "0 0 0 1 1" }, /exceeds/],
    ["unknown class", { ...files(), "train/labels/a.txt": "2 0.5 0.5 0.2 0.2" }, /not declared/],
  ]) await t.test(`rejects ${name}`, async () => assert.rejects(readYoloDatasetZip(await archive(content)), error));
});
