// node --test lib/uploads/zip-source.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import JSZip from "jszip";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./zip-source.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const compiled = { exports: {} };
new Function("require", "exports", outputText)((name) => { throw new Error(`Unexpected dependency: ${name}`); }, compiled.exports);
const { listZipImages, openUploadSource } = compiled.exports;

const jpeg = Uint8Array.from({ length: 5000 }, (_, index) => (index * 31) % 256);
const png = Uint8Array.from({ length: 300 }, (_, index) => (index * 7) % 256);

async function archive(files, name = "images.zip") {
  const zip = new JSZip();
  for (const [path, bytes, compression] of files) zip.file(path, bytes, { compression });
  zip.folder("empty-dir");
  return new File([await zip.generateAsync({ type: "uint8array" })], name);
}

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test("lists nested JPG and PNG entries and opens each to its exact bytes", async () => {
  const file = await archive([
    ["set/n01/a.jpg", jpeg, "DEFLATE"],
    ["set/n02/b.PNG", png, "STORE"],
    ["set/readme.txt", "not an image", "DEFLATE"],
  ]);

  const entries = await listZipImages(file);

  assert.deepEqual(entries.map(({ fileName, mimeType, sizeBytes }) => ({ fileName, mimeType, sizeBytes })), [
    { fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: jpeg.length },
    { fileName: "b.PNG", mimeType: "image/png", sizeBytes: png.length },
  ]);
  assert.deepEqual(entries.map((entry) => entry.source.compressed), [true, false]);
  assert.deepEqual(await bytesOf(await openUploadSource(entries[0].source)), jpeg);
  assert.deepEqual(await bytesOf(await openUploadSource(entries[1].source)), png);
});

test("a file source opens to the file itself", async () => {
  const file = new File([png], "c.png", { type: "image/png" });
  assert.equal(await openUploadSource({ kind: "file", file }), file);
});

test("rejects a file that is not a ZIP", async () => {
  await assert.rejects(listZipImages(new File(["not a zip"], "photos.zip")), {
    message: "Could not read photos.zip as a ZIP file.",
  });
});

test("rejects a ZIP without JPG or PNG images", async () => {
  const file = await archive([["notes.txt", "hello", "DEFLATE"]], "docs.zip");
  await assert.rejects(listZipImages(file), { message: "docs.zip contains no JPG or PNG images." });
});

test("refuses an entry that inflates past its declared size", async () => {
  const [entry] = await listZipImages(await archive([["a.jpg", jpeg, "DEFLATE"]]));
  await assert.rejects(openUploadSource({ ...entry.source, uncompressedSize: jpeg.length - 1 }));
});
