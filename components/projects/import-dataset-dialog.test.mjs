// Lightweight component interaction tests, following the repo's transpiled hook tests.
// Radix/browser rendering is not exercised by this harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./import-dataset-dialog.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const zip = (name) => new File(["zip"], name);
function plan() {
  return {
    annotationPath: "annotations.json", categories: [{ id: "1", name: "Cat" }, { id: "2", name: "Dog" }],
    images: [
      { id: "1", file: new File(["1234"], "cat.png"), boxes: [{}, {}] },
      { id: "2", file: new File(["123456"], "dog.png"), boxes: [{}] },
    ],
  };
}
function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
function setup(reader) {
  const slots = [], calls = [];
  let cursor = 0, cleanup, closed = false;
  const jsx = (type, props) => ({ type, props });
  const primitives = new Proxy({}, { get: (_, key) => key });
  const dependencies = {
    react: {
      useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = value; }];
      },
      useEffect(effect) { if (!cleanup) cleanup = effect(); },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": primitives,
    "@/components/ui/badge": primitives,
    "@/components/ui/button": primitives,
    "@/components/ui/dialog": primitives,
    "@/lib/format": { formatBytes: (bytes) => `${bytes} B`, numberFormatter: new Intl.NumberFormat("en-US") },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/uploads/dataset-zip": { readCocoDatasetZip: (file) => { calls.push(file); return reader(file); } },
  };
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  const wrapper = exports.ImportDatasetDialog({ open: true, onOpenChange: () => { closed = true; } });
  const form = nodes(wrapper).find((node) => typeof node.type === "function");
  function render() { cursor = 0; return form.type(form.props); }
  const find = (predicate) => nodes(render()).find((node) => node?.props && predicate(node));
  const input = () => find((node) => node.type === "input");
  function select(files) {
    const target = { files, value: "selected" };
    input().props.onChange({ currentTarget: target });
    assert.equal(target.value, "");
  }
  return { render, find, select, calls, unmount: () => cleanup(), isClosed: () => closed };
}

test("selection validates one ZIP and previews counts, categories, filename and extracted size", async () => {
  const pending = deferred();
  const ui = setup(() => pending.promise);
  assert.ok(nodes(ui.render()).includes("Browse files"));
  ui.select([zip("dataset.zip")]);
  assert.equal(ui.calls.length, 1);
  assert.ok(nodes(ui.render()).includes("Validating..."));
  assert.ok(nodes(ui.render()).includes("Replace ZIP"));
  pending.resolve(plan()); await tick();
  const text = nodes(ui.render());
  for (const value of ["dataset.zip", "Dataset validated", "Images", "Bounding boxes", "Categories", "Extracted image size", "2", "3", "10 B", "Cat", "Dog"]) {
    assert.ok(text.includes(value), `Missing preview value: ${value}`);
  }
  assert.equal(ui.find((node) => node.type === "Button" && node.props.children === "Import"), undefined);
});

test("drag/drop validates; multiple files and non-ZIP selections show errors without calling reader", async () => {
  const ui = setup(async () => plan());
  let prevented = false;
  ui.find((node) => node.props.onDrop).props.onDrop({ preventDefault() { prevented = true; }, dataTransfer: { files: [zip("drop.ZIP")] } });
  await tick();
  assert.ok(prevented);
  assert.equal(ui.calls[0].name, "drop.ZIP");
  ui.select([zip("a.zip"), zip("b.zip")]);
  assert.ok(nodes(ui.render()).includes("Choose one COCO ZIP at a time."));
  ui.select([zip("wrong.json")]);
  assert.equal(ui.calls.length, 1);
  assert.ok(ui.find((node) => node.props.role === "alert"));
});

test("validator errors and empty datasets show validation errors", async () => {
  const ui = setup(async (file) => {
    if (file.name === "bad.zip") throw new Error("Missing referenced image: cat.png");
    return { ...plan(), images: [] };
  });
  ui.select([zip("bad.zip")]); await tick();
  assert.ok(nodes(ui.render()).includes("Missing referenced image: cat.png"));
  ui.select([zip("empty.zip")]); await tick();
  assert.ok(nodes(ui.render()).some((node) => typeof node === "string" && node.includes("contains no images")));
});

test("replacement ignores older successful and failed validation results", async () => {
  for (const oldFails of [false, true]) {
    const older = deferred(), newer = deferred();
    const ui = setup((file) => file.name === "old.zip" ? older.promise : newer.promise);
    ui.select([zip("old.zip")]);
    ui.select([zip("new.zip")]);
    newer.resolve(plan()); await tick();
    if (oldFails) older.reject(new Error("Stale error")); else older.resolve({ ...plan(), categories: [] });
    await tick();
    const text = nodes(ui.render());
    assert.ok(text.includes("new.zip"));
    assert.ok(text.includes("Cat"));
    assert.ok(!text.includes("old.zip") && !text.includes("Stale error"));
  }
});

test("removal and unmount invalidate pending validation; close remains available", async () => {
  const pending = deferred();
  const ui = setup(() => pending.promise);
  ui.select([zip("remove.zip")]);
  ui.find((node) => node.props["aria-label"] === "Remove selected ZIP").props.onClick();
  pending.resolve(plan()); await tick();
  assert.ok(nodes(ui.render()).includes("Browse files"));
  assert.ok(!nodes(ui.render()).includes("Dataset validated"));

  const late = deferred();
  const second = setup(() => late.promise);
  second.select([zip("close.zip")]);
  second.find((node) => node.type === "Button" && node.props.children === "Close").props.onClick();
  assert.ok(second.isClosed());
  second.unmount();
  late.resolve(plan()); await tick();
  assert.ok(!nodes(second.render()).includes("Dataset validated"));
});
