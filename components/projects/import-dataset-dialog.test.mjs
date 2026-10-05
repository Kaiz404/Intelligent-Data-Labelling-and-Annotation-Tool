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
function setup(reader, start) {
  const calls = [], starts = [], completions = [], hookProjects = [];
  const instances = new Map();
  let slots, cursor = 0, closed = false, open = true;
  let importState = {
    status: "idle", totalImageCount: 0, completedImageCount: 0,
    successfulImageCount: 0, failedImageCount: 0, uploadProgress: 0,
    images: [], labelResolutionFailed: false,
  };
  const jsx = (type, props) => ({ type, props });
  const primitives = new Proxy({}, { get: (_, key) => key });
  const dependencies = {
    react: {
      useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
      useState(initial) {
        const index = cursor++;
        const values = slots;
        if (!(index in values)) values[index] = initial;
        return [values[index], (value) => { values[index] = value; }];
      },
      useEffect(effect) { const index = cursor++; if (!(index in slots)) slots[index] = { cleanup: effect() }; },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "lucide-react": primitives,
    "@/components/ui/badge": primitives,
    "@/components/ui/button": primitives,
    "@/components/ui/dialog": primitives,
    "@/components/ui/progress": primitives,
    "@/components/ui/table": primitives,
    "@/hooks/use-dataset-import": {
      useDatasetImport({ projectId }) {
        hookProjects.push(projectId);
        return {
          ...importState,
          isImporting: ["resolving_labels", "importing"].includes(importState.status),
          async startImport(value) {
            starts.push(value);
            importState = { ...importState, status: "resolving_labels", totalImageCount: value.images.length };
            try {
              const result = start ? await start(value) : outcome("completed");
              importState = result;
              return result;
            } catch (error) {
              importState = { ...importState, status: "idle" };
              throw error;
            }
          },
        };
      },
    },
    "@/lib/format": { formatBytes: (bytes) => `${bytes} B`, numberFormatter: new Intl.NumberFormat("en-US") },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/uploads/dataset-zip": { readCocoDatasetZip: (file) => { calls.push(file); return reader(file); } },
  };
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  function renderComponent(type, props) {
    if (!instances.has(type)) instances.set(type, []);
    slots = instances.get(type); cursor = 0;
    return type(props);
  }
  function expand(tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (typeof tree.type === "function") return expand(renderComponent(tree.type, tree.props));
    return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
  }
  function render() {
    return expand(renderComponent(exports.ImportDatasetDialog, {
      projectId: "project-id", open,
      onOpenChange: (value) => { open = value; closed = !value; },
      onImportComplete: (value) => completions.push(value),
    }));
  }
  const find = (predicate) => nodes(render()).find((node) => node?.props && predicate(node));
  const input = () => find((node) => node.type === "input");
  function select(files) {
    const target = { files, value: "selected" };
    input().props.onChange({ currentTarget: target });
    assert.equal(target.value, "");
  }
  return {
    render, find, select, calls, starts, completions, hookProjects,
    setImportState: (value) => { importState = value; },
    setOpen: (value) => { open = value; },
    unmount: () => { for (const values of instances.values()) for (const value of values) value?.cleanup?.(); },
    isClosed: () => closed,
  };
}

function outcome(status, patch = {}) {
  return {
    status, totalImageCount: 2, completedImageCount: 2, successfulImageCount: 2,
    failedImageCount: 0, uploadProgress: 100, images: [], labelResolutionFailed: false,
    ...patch,
  };
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
  assert.ok(ui.find((node) => node.type === "Button" && node.props.children === "Import"));
  assert.equal(ui.starts.length, 0);
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

test("Import starts only the current plan explicitly and prevents duplicate starts before re-render", async () => {
  const pending = deferred();
  const first = plan(), latest = plan();
  const ui = setup(async (file) => file.name === "first.zip" ? first : latest, () => pending.promise);
  ui.select([zip("first.zip")]); await tick();
  const staleClick = ui.find((node) => node.props.children === "Import").props.onClick;
  ui.select([zip("latest.zip")]);
  staleClick();
  assert.equal(ui.starts.length, 0);
  await tick();
  const importClick = ui.find((node) => node.props.children === "Import").props.onClick;
  assert.equal(ui.starts.length, 0);
  importClick(); importClick();
  assert.deepEqual(ui.starts, [latest]);
  assert.ok(ui.hookProjects.every((id) => id === "project-id"));
  pending.resolve(outcome("completed")); await tick();
  importClick();
  assert.equal(ui.starts.length, 1);
});

test("active runs block all dismissal and file changes, including immediate stale handlers", async () => {
  const pending = deferred();
  const ui = setup(async () => plan(), () => pending.promise);
  ui.select([zip("active.zip")]); await tick();
  const close = ui.find((node) => node.type === "Dialog").props.onOpenChange;
  const remove = ui.find((node) => node.props["aria-label"] === "Remove selected ZIP").props.onClick;
  const content = ui.find((node) => node.type === "DialogContent");
  ui.find((node) => node.props.children === "Import").props.onClick();
  close(false); remove();
  let prevented = 0;
  const event = { preventDefault() { prevented++; } };
  content.props.onEscapeKeyDown(event); content.props.onInteractOutside(event);
  assert.equal(prevented, 2);
  assert.equal(ui.isClosed(), false);
  assert.equal(ui.find((node) => node.type === "DialogContent").props.showCloseButton, false);
  for (const label of ["Remove selected ZIP", "Choose COCO ZIP"]) {
    assert.equal(ui.find((node) => node.props["aria-label"] === label).props.disabled, true);
  }
  assert.equal(ui.find((node) => node.props.children === "Replace ZIP").props.disabled, true);
  assert.equal(ui.find((node) => node.props.children === "Close").props.disabled, true);
  ui.select([zip("blocked.zip")]);
  assert.equal(ui.calls.length, 1);
  ui.setOpen(false);
  assert.equal(ui.find((node) => node.type === "Dialog").props.open, true);
  assert.ok(nodes(ui.render()).includes("active.zip"));
  pending.resolve(outcome("completed")); await tick();
});

test("progress distinguishes upload completion from annotation saves and displays all image states", async () => {
  const pending = deferred();
  const ui = setup(async () => plan(), () => pending.promise);
  ui.select([zip("progress.zip")]); await tick();
  ui.find((node) => node.props.children === "Import").props.onClick();
  assert.ok(nodes(ui.render()).includes("Preparing labels..."));
  ui.setImportState(outcome("importing", {
    totalImageCount: 5, completedImageCount: 2, successfulImageCount: 1, failedImageCount: 1,
    images: ["queued", "uploading", "saving_annotations", "succeeded", "failed"].map((status, index) => ({
      sourceImageId: String(index), path: `${index}.png`, sizeBytes: 1, status, uploadProgress: 100,
    })),
  }));
  const text = nodes(ui.render());
  for (const label of ["Import is still running...", "Completed images", "Successful images", "Failed images", "Pending", "Uploading", "Saving annotations", "Success", "Failed"]) assert.ok(text.includes(label));
  assert.equal(ui.find((node) => node.type === "Progress").props.value, 100);
  assert.ok(text.some((node) => typeof node === "string" && node.includes("100% uploaded does not mean")));
  assert.equal(ui.completions.length, 0);
  pending.resolve(outcome("completed")); await tick();
});

test("success releases dismissal and notifies completion once with the exact outcome", async () => {
  const pending = deferred();
  const ui = setup(async () => plan(), () => pending.promise);
  ui.select([zip("success.zip")]); await tick();
  ui.find((node) => node.props.children === "Import").props.onClick();
  const result = outcome("completed");
  pending.resolve(result); await tick();
  assert.ok(nodes(ui.render()).includes("Import complete"));
  assert.deepEqual(ui.completions, [result]);
  assert.equal(ui.find((node) => node.type === "DialogContent").props.showCloseButton, true);
  assert.equal(ui.find((node) => node.props.children === "Import"), undefined);
  ui.render();
  assert.equal(ui.completions.length, 1);
  ui.find((node) => node.props.children === "Close").props.onClick();
  assert.ok(ui.isClosed());
});

test("partial failures retain uploaded-image context and do not offer automatic retries", async () => {
  const result = outcome("completed_with_errors", {
    successfulImageCount: 1, failedImageCount: 1,
    images: [{ sourceImageId: "1", path: "cat.png", status: "failed", uploadProgress: 100,
      failureStage: "annotations", error: "Save refused", imageId: "uploaded-id" }],
  });
  const ui = setup(async () => plan(), async () => result);
  ui.select([zip("partial.zip")]); await tick();
  ui.find((node) => node.props.children === "Import").props.onClick(); await tick();
  const text = nodes(ui.render());
  for (const value of ["Import finished with failures", "Image uploaded, but its annotations were not imported.", "Save refused"]) assert.ok(text.includes(value));
  assert.ok(text.some((node) => typeof node === "string" && node.includes("duplicate images")));
  assert.deepEqual(ui.completions, [result]);
  assert.equal(ui.starts.length, 1);
  assert.equal(ui.find((node) => node.props.children === "Import"), undefined);
});

test("fatal and label-resolution failures surface errors and notify the parent", async () => {
  for (const labelResolutionFailed of [false, true]) {
    const result = outcome("failed", { labelResolutionFailed, error: "Access denied", completedImageCount: 0, successfulImageCount: 0 });
    const ui = setup(async () => plan(), async () => result);
    ui.select([zip("fatal.zip")]); await tick();
    ui.find((node) => node.props.children === "Import").props.onClick(); await tick();
    const text = nodes(ui.render());
    assert.ok(text.includes("Import failed") && text.includes("Access denied"));
    assert.equal(text.some((node) => typeof node === "string" && node.includes("No image uploads were started")), labelResolutionFailed);
    assert.deepEqual(ui.completions, [result]);
    assert.equal(ui.find((node) => node.props.children === "Close").props.disabled, false);
  }
});

test("a rejected start produces a fatal outcome and releases the dialog", async () => {
  const ui = setup(async () => plan(), async () => { throw new Error("Start rejected"); });
  ui.select([zip("rejected.zip")]); await tick();
  ui.find((node) => node.props.children === "Import").props.onClick(); await tick();
  assert.ok(nodes(ui.render()).includes("Start rejected"));
  assert.equal(ui.completions[0].status, "failed");
  assert.equal(ui.find((node) => node.props.children === "Close").props.disabled, false);
});
