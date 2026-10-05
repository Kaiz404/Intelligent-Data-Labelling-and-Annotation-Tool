// node --test lib/annotations/voc-import.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import JSZip from "jszip";
import { DOMParser as XmlDOMParser } from "@xmldom/xmldom";

// Browser DOMParser reports malformed XML; make the real Node XML parser equally strict.
globalThis.DOMParser = class extends XmlDOMParser {
  constructor() { super({ onError() { throw new Error("Malformed XML"); } }); }
};
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
const parser = load("./voc-import.ts", { "@/lib/annotations/coco-import": coco });
const { parseVocAnnotation, buildVocDatasetPlan } = parser;
const { decodeDatasetImage } = load("../uploads/dataset-image.ts");
const { readVocDatasetZip } = load("../uploads/voc-dataset-zip.ts", {
  jszip: JSZip, "@/lib/annotations/coco-import": coco,
  "@/lib/annotations/voc-import": parser, "@/lib/uploads/dataset-image": { decodeDatasetImage },
});
const size = { width: 100, height: 80 };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Uint8Array.from([255, 216, 255, 1]);
function object(name = "Cat", coords = [0, 0, 100, 80]) {
  return `<object><name>${name}</name><pose>Unspecified</pose><truncated>1</truncated><difficult>1</difficult><bndbox>${["xmin", "ymin", "xmax", "ymax"].map((key, i) => `<${key}>${coords[i]}</${key}>`).join("")}</bndbox></object>`;
}
function xml(filename = "a.png", objects = object(), dimensions = size) {
  return `<annotation><filename>${filename}</filename><size><width>${dimensions.width}</width><height>${dimensions.height}</height><depth>3</depth></size>${objects}</annotation>`;
}
const parse = (text, options) => parseVocAnnotation(text, "annotations/test.xml", options);
async function archive(files) {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
  return new File([await zip.generateAsync({ type: "uint8array" })], "voc.zip");
}

test("native edges preserve fractional pixels and ignore VOC attributes", () => {
  const result = parse(`\uFEFF<?xml version="1.0"?>${xml("a.png", object("  Cat &amp; Dog  ", [1.25, 2.5, 90.75, 70.5]))}`);
  assert.deepEqual(result.objects, [{ name: "Cat & Dog", x: 1.25, y: 2.5, width: 89.5, height: 68 }]);
  assert.deepEqual([result.width, result.height], [100, 80]);
});

test("coordinate profiles are explicit; inclusive profile supports single pixels and full image", () => {
  const inclusive = { coordinateProfile: "one-based-inclusive" };
  assert.deepEqual(parse(xml("a.png", object("Cat", [1, 1, 100, 80])), inclusive).objects[0],
    { name: "Cat", x: 0, y: 0, width: 100, height: 80 });
  assert.deepEqual(parse(xml("a.png", object("Cat", [100, 80, 100, 80])), inclusive).objects[0],
    { name: "Cat", x: 99, y: 79, width: 1, height: 1 });
  assert.equal(parse(xml("a.png", object("Cat", [1, 1, 100, 80]))).objects[0].width, 99);
  assert.throws(() => parse(xml(), inclusive), /bounds/);
  assert.throws(() => parse(xml("a.png", object("Cat", [1.5, 1, 10, 20])), inclusive), /safe integers/);
  assert.throws(() => parse(xml(), { coordinateProfile: "guess" }), /Unsupported VOC coordinate profile/);
});

test("zero objects are valid and deterministic categories preserve trimmed case-sensitive names", () => {
  assert.deepEqual(parse(xml("empty.png", "")).objects, []);
  const inputs = [
    { path: "b.png", annotationPath: "b.xml", annotation: parse(xml("b.png", object(" Dog ") + object("Cat") + object("cat"))) },
    { path: "a.png", annotationPath: "a.xml", annotation: parse(xml("a.png", object("Cat"))) },
  ];
  const result = buildVocDatasetPlan(inputs);
  assert.deepEqual(result.categories, [{ id: "0", name: "Cat" }, { id: "1", name: "Dog" }, { id: "2", name: "cat" }]);
  assert.deepEqual(buildVocDatasetPlan([...inputs].reverse()).categories, result.categories);
  assert.deepEqual(result.images[0].boxes.map((box) => box.categoryId), ["1", "0", "2"]);
  assert.equal(result.images[0].boxes[0].id, "b.xml:1");
  assert.throws(() => buildVocDatasetPlan([inputs[0], inputs[0]]), /Multiple VOC/);
  assert.deepEqual(buildVocDatasetPlan([{ path: "empty.png", annotationPath: "empty.xml", annotation: parse(xml("empty.png", "")) }]).categories, []);
});

const valid = xml();
for (const [name, text, expected] of [
  ["malformed XML", valid.replace("</size>", "</wrong>"), /malformed XML/],
  ["extra root", valid + "<extra/>", /malformed XML/],
  ["undefined entity", valid.replace("Cat", "&custom;"), /malformed XML/],
  ["wrong root", "<other/>", /annotation.*root/],
  ["namespace", valid.replace("<annotation>", '<annotation xmlns="urn:other">'), /root/],
  ["missing filename", valid.replace("<filename>a.png</filename>", ""), /exactly one <filename>/],
  ["duplicate filename", valid.replace("<filename>", "<filename>b.png</filename><filename>"), /exactly one <filename>/],
  ["empty filename", valid.replace("a.png", " "), /non-empty/],
  ["nested filename", valid.replace("a.png", "<value>a.png</value>"), /nested/],
  ["missing size", valid.replace(/<size>.*?<\/size>/, ""), /exactly one <size>/],
  ["duplicate size", valid.replace("<size>", "<size/><size>"), /exactly one <size>/],
  ["missing width", valid.replace("<width>100</width>", ""), /exactly one <width>/],
  ["duplicate width", valid.replace("<width>", "<width>100</width><width>"), /exactly one <width>/],
  ["zero width", valid.replace("<width>100", "<width>0"), /positive safe integers/],
  ["fractional height", valid.replace("<height>80", "<height>80.5"), /positive safe integers/],
  ["empty name", valid.replace("<name>Cat", "<name> "), /non-empty/],
  ["duplicate name", valid.replace("<name>", "<name>Dog</name><name>"), /exactly one <name>/],
  ["missing box", xml("a.png", "<object><name>Cat</name></object>"), /exactly one <bndbox>/],
  ["duplicate box", valid.replace("<bndbox>", "<bndbox/><bndbox>"), /exactly one <bndbox>/],
  ["incomplete box", valid.replace("<xmax>100</xmax>", ""), /exactly one <xmax>/],
  ["duplicate coordinate", valid.replace("<xmin>", "<xmin>1</xmin><xmin>"), /exactly one <xmin>/],
  ["polygon", valid.replace("<bndbox>", "<polygon/><bndbox>"), /unsupported element/],
  ["rotated geometry", valid.replace("<bndbox>", "<robndbox/><bndbox>"), /unsupported element/],
  ["extra box geometry", valid.replace("<xmin>", "<angle>2</angle><xmin>"), /unsupported element/],
  ["DTD", '<!DOCTYPE annotation SYSTEM "https://example.com/dtd">' + valid, /DTD/],
  ["entity", '<!DOCTYPE annotation [<!ENTITY custom "Cat">]>' + valid, /DTD/],
  ["entity declaration", "<!ENTITY custom 'Cat'>" + valid, /custom entity/],
]) {
  test(`XML rejects ${name} with document context`, () => {
    assert.throws(() => parse(text), (error) => error.message.includes("annotations/test.xml") && expected.test(error.message));
  });
}
for (const [name, coords, expected] of [
  ["negative edge", [-1, 0, 100, 80], /bounds/],
  ["inverted x", [10, 0, 2, 80], /ordering/],
  ["inverted y", [0, 10, 100, 2], /ordering/],
  ["zero area", [0, 0, 0, 80], /ordering/],
  ["right overflow", [0, 0, 101, 80], /bounds/],
  ["bottom overflow", [0, 0, 100, 81], /bounds/],
  ["NaN", ["NaN", 0, 100, 80], /finite/],
  ["infinity", [0, 0, "Infinity", 80], /finite/],
  ["numeric overflow", [0, 0, "1e999", 80], /finite/],
]) test(`XML rejects ${name}`, () => assert.throws(() => parse(xml("a.png", object("Cat", coords))), expected));

test("50,000 boxes allowed; 50,001 rejected", () => {
  const objects = object().repeat(50_000);
  assert.equal(parse(xml("a.png", objects)).objects.length, 50_000);
  assert.throws(() => parse(xml("a.png", objects + object())), /50,000-box/);
});

test("VOC ZIP integration with real XML parser and stubbed image decoding", async (t) => {
  const previous = globalThis.createImageBitmap;
  let closed = 0;
  t.after(() => { globalThis.createImageBitmap = previous; });
  globalThis.createImageBitmap = async () => ({ ...size, close() { closed++; } });
  for (const [name, files, expected] of [
    ["app export; XML names need not match images", { "images/a.png": png, "annotations/sanitized-name.xml": xml() }, "images/a.png"],
    ["conventional", { "JPEGImages/a.jpg": jpeg, "Annotations/a.xml": xml("a.jpg") }, "JPEGImages/a.jpg"],
    ["enclosing dataset root", { "dataset/images/a.png": png, "dataset/annotations/a.xml": xml() }, "dataset/images/a.png"],
    ["enclosing conventional root", { "dataset/JPEGImages/a.png": png, "dataset/Annotations/a.xml": xml() }, "dataset/JPEGImages/a.png"],
    ["exact path", { "images/a.png": png, "annotations/a.xml": xml("images/a.png") }, "images/a.png"],
    ["dataset relative path", { "dataset/images/a.png": png, "dataset/annotations/a.xml": xml("images/a.png") }, "dataset/images/a.png"],
    ["nested image-directory match", { "images/train/a.png": png, "annotations/a.xml": xml("train/a.png") }, "images/train/a.png"],
    ["unique basename fallback", { "images/train/a.png": png, "annotations/unrelated/a.xml": xml() }, "images/train/a.png"],
  ]) {
    await t.test(name, async () => {
      const result = await readVocDatasetZip(await archive(files));
      assert.equal(result.images[0].archivePath, expected);
      assert.equal(result.images[0].file.name, expected.split("/").at(-1));
      assert.equal(result.images[0].file.size, files[expected].length);
      assert.equal(result.images[0].boxes[0].width, 100);
      assert.deepEqual(result.categories, [{ id: "0", name: "Cat" }]);
    });
  }
  await t.test("multiple images/classes and explicit negatives; external path is ignored", async () => {
    const result = await readVocDatasetZip(await archive({
      "images/a.png": png, "images/b.jpg": jpeg, "images/negative.png": png,
      "annotations/a.xml": xml("a.png", object("Dog") + object("Cat")),
      "annotations/b.xml": xml("b.jpg", object("cat")).replace("<size>", "<path>https://example.com/private.jpg</path><size>"),
      "annotations/negative.xml": xml("negative.png", ""),
    }));
    assert.equal(result.images.length, 3);
    assert.deepEqual(result.images.map((image) => image.boxes.length), [2, 1, 0]);
    assert.deepEqual(result.categories.map((category) => category.name), ["Cat", "Dog", "cat"]);
    assert.equal(result.annotationPath, "annotations");
  });
  await t.test("reader forwards inclusive profile", async () => {
    const result = await readVocDatasetZip(await archive({ "images/a.png": png, "annotations/a.xml": xml("a.png", object("Cat", [1, 1, 100, 80])) }), { coordinateProfile: "one-based-inclusive" });
    assert.equal(result.images[0].boxes[0].x, 0);
    assert.equal(result.images[0].boxes[0].width, 100);
  });
  await t.test("exact references take precedence over duplicate basenames", async () => {
    const result = await readVocDatasetZip(await archive({
      "images/one/a.png": png, "images/two/a.png": png,
      "annotations/first.xml": xml("images/one/a.png"),
      "annotations/second.xml": xml("two/a.png"),
    }));
    assert.deepEqual(result.images.map((image) => image.path), ["images/one/a.png", "images/two/a.png"]);
  });
  await t.test("nested image folders named annotations do not create another dataset root", async () => {
    const result = await readVocDatasetZip(await archive({
      "images/annotations/a.png": png, "annotations/a.xml": xml("annotations/a.png"),
    }));
    assert.equal(result.images[0].path, "images/annotations/a.png");
  });
  await t.test("all-negative dataset has zero categories", async () => {
    const result = await readVocDatasetZip(await archive({ "images/a.png": png, "annotations/a.xml": xml("a.png", "") }));
    assert.deepEqual(result.categories, []);
  });
  for (const [name, files, expected] of [
    ["orphan XML", { "images/a.png": png, "annotations/a.xml": xml("missing.png") }, /Orphan/],
    ["missing XML", { "images/a.png": png, "images/b.png": png, "annotations/a.xml": xml() }, /missing VOC XML/],
    ["ambiguous basename", { "images/one/a.png": png, "images/two/a.png": png, "annotations/a.xml": xml() }, /ambiguous/],
    ["multiple XML per image", { "images/a.png": png, "annotations/a.xml": xml(), "annotations/b.xml": xml() }, /Multiple VOC/],
    ["missing bytes", { "annotations/a.xml": xml() }, /requires image bytes/],
    ["missing documents", { "images/a.png": png }, /requires image bytes/],
    ["two roots", { "one/images/a.png": png, "one/annotations/a.xml": xml(), "two/images/a.png": png, "two/annotations/a.xml": xml() }, /requires one/],
    ["too-deep root", { "one/two/images/a.png": png, "one/two/annotations/a.xml": xml() }, /requires one/],
    ["mixed conventions", { "images/a.png": png, "Annotations/a.xml": xml() }, /requires one/],
    ["bad signature", { "images/a.png": jpeg, "annotations/a.xml": xml() }, /contents do not match/],
    ["unsupported bytes", { "images/a.webp": png, "annotations/a.xml": xml("a.webp") }, /JPEG and PNG/],
    ["dimensions mismatch", { "images/a.png": png, "annotations/a.xml": xml("a.png", "", { width: 99, height: 80 }) }, /does not match decoded/],
    ["traversal reference", { "images/a.png": png, "annotations/a.xml": xml("../images/a.png") }, /Unsafe/],
    ["absolute reference", { "images/a.png": png, "annotations/a.xml": xml("/images/a.png") }, /Unsafe/],
    ["external filename", { "images/a.png": png, "annotations/a.xml": xml("https://example.com/a.png") }, /Unsafe/],
    ["drive filename", { "images/a.png": png, "annotations/a.xml": xml("C:\\images\\a.png") }, /Unsafe/],
    ["ZIP traversal", { "../images/a.png": png, "annotations/a.xml": xml() }, /Unsafe/],
    ["normalized ZIP collisions", { "images/a.png": png, "images\\a.png": png, "annotations/a.xml": xml() }, /Colliding/],
    ["non-XML annotation", { "images/a.png": png, "annotations/a.txt": xml() }, /must be .xml/],
  ]) await t.test(`rejects ${name}`, async () => assert.rejects(readVocDatasetZip(await archive(files)), expected));
  await t.test("failed decode", async () => {
    globalThis.createImageBitmap = async () => { throw new Error("decode"); };
    await assert.rejects(readVocDatasetZip(await archive({ "images/a.png": png, "annotations/a.xml": xml() })), /could not decode/);
  });
  assert.ok(closed > 0);
  await assert.rejects(readVocDatasetZip(new File(["not zip"], "bad.zip")), /Could not read/);
});
