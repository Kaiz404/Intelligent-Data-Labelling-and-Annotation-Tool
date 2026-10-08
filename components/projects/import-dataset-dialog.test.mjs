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
const isActive = (state) => ["resolving_labels", "importing"].includes(state.status);
function setup(reader, yoloReader = reader, vocReader = reader) {
  const calls = [], yoloCalls = [], vocCalls = [], starts = [], dismissals = [], hookProjects = [];
  const instances = new Map();
  let slots, cursor = 0, closed = false, open = true, run;
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
    "@/components/ui/select": primitives,
    "@/components/ui/table": primitives,
    // Mirrors the store: one active run per project, replaced only once finished.
    "@/components/projects/dataset-import-provider": {
      useDatasetImportRun(projectId) { hookProjects.push(projectId); return run; },
      useDatasetImportActions: () => ({
        startDatasetImport(input) {
          if (run && isActive(run.state)) return false;
          starts.push(input);
          run = {
            id: `run-${starts.length}`, projectId: input.projectId, projectName: input.projectName, fileName: input.fileName,
            state: outcome("resolving_labels", { totalImageCount: input.plan.images.length, completedImageCount: 0, successfulImageCount: 0, uploadProgress: 0 }),
            importedImages: [],
          };
          return true;
        },
        dismissDatasetImport(projectId) {
          dismissals.push(projectId);
          if (run && !isActive(run.state)) run = undefined;
        },
      }),
    },
    "@/lib/uploads/dataset-import": { isImportActive: isActive },
    "@/lib/format": { formatBytes: (bytes) => `${bytes} B`, numberFormatter: new Intl.NumberFormat("en-US") },
    "@/lib/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "@/lib/uploads/dataset-zip": { readCocoDatasetZip: (file) => { calls.push(file); return reader(file); } },
    "@/lib/uploads/yolo-dataset-zip": { readYoloDatasetZip: (file) => { yoloCalls.push(file); return yoloReader(file); } },
    "@/lib/uploads/voc-dataset-zip": { readVocDatasetZip: (file, options) => { vocCalls.push({ file, options }); return vocReader(file, options); } },
  };
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  let rendered;
  function renderComponent(type, props) {
    rendered.add(type);
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
  // A component left out of a render unmounts: its effects clean up and its state is dropped.
  function unmountMissing() {
    for (const [type, values] of instances) {
      if (rendered.has(type)) continue;
      for (const value of values) value?.cleanup?.();
      instances.delete(type);
    }
  }
  function render() {
    rendered = new Set();
    const tree = expand(renderComponent(exports.ImportDatasetDialog, {
      projectId: "project-id", projectName: "Project", open,
      onOpenChange: (value) => { open = value; closed = !value; },
    }));
    unmountMissing();
    return tree;
  }
  const find = (predicate) => nodes(render()).find((node) => node?.props && predicate(node));
  const input = () => find((node) => node.type === "input");
  function select(files) {
    const target = { files, value: "selected" };
    input().props.onChange({ currentTarget: target });
    assert.equal(target.value, "");
  }
  return {
    render, find, select, calls, yoloCalls, vocCalls, starts, dismissals, hookProjects,
    changeFormat: (value) => find((node) => node.type === "Select").props.onValueChange(value),
    changeProfile: (value) => find((node) => node.type === "Select" && ["app-native", "one-based-inclusive"].includes(node.props.value)).props.onValueChange(value),
    setRunState: (state) => { run = { ...run, state }; },
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

async function startImport(ui, name) {
  ui.select([zip(name)]); await tick();
  ui.find((node) => node.props.children === "Import").props.onClick();
}

test("Import starts only the current plan explicitly and prevents duplicate starts before re-render", async () => {
  const first = plan(), latest = plan();
  const ui = setup(async (file) => file.name === "first.zip" ? first : latest);
  ui.select([zip("first.zip")]); await tick();
  const staleClick = ui.find((node) => node.props.children === "Import").props.onClick;
  ui.select([zip("latest.zip")]);
  staleClick();
  assert.equal(ui.starts.length, 0);
  await tick();
  const importClick = ui.find((node) => node.props.children === "Import").props.onClick;
  assert.equal(ui.starts.length, 0);
  importClick(); importClick();
  assert.deepEqual(ui.starts, [{ projectId: "project-id", projectName: "Project", fileName: "latest.zip", plan: latest }]);
  assert.ok(ui.hookProjects.every((id) => id === "project-id"));
  assert.ok(nodes(ui.render()).includes("Preparing labels..."));
  assert.equal(ui.find((node) => node.props.children === "Import"), undefined);
});

test("the dialog can be dismissed at any time; the run keeps going and shows again on reopen", async () => {
  const ui = setup(async () => plan());
  await startImport(ui, "active.zip");
  const content = ui.find((node) => node.type === "DialogContent");
  assert.equal(content.props.showCloseButton, undefined);
  assert.equal(content.props.onEscapeKeyDown, undefined);
  assert.equal(content.props.onInteractOutside, undefined);
  const text = nodes(ui.render());
  assert.ok(text.some((node) => typeof node === "string" && node.includes("keeps running in the background")));
  assert.ok(text.some((node) => typeof node === "string" && node.includes("active.zip")));
  assert.equal(ui.find((node) => node.type === "Select"), undefined, "the picker is replaced while a run exists");
  assert.equal(ui.find((node) => node.props.children === "Import another dataset"), undefined);
  ui.find((node) => node.type === "Button" && node.props.children === "Close").props.onClick();
  assert.ok(ui.isClosed());
  assert.equal(ui.find((node) => node.type === "Dialog").props.open, false);
  ui.setOpen(true);
  assert.ok(nodes(ui.render()).includes("Preparing labels..."));
  ui.find((node) => node.type === "Dialog").props.onOpenChange(false);
  assert.ok(ui.isClosed());
  assert.equal(ui.starts.length, 1);
});

test("progress distinguishes upload completion from annotation saves and displays all image states", async () => {
  const ui = setup(async () => plan());
  await startImport(ui, "progress.zip");
  assert.ok(nodes(ui.render()).includes("Preparing labels..."));
  ui.setRunState(outcome("importing", {
    totalImageCount: 5, completedImageCount: 2, successfulImageCount: 1, failedImageCount: 1,
    images: ["queued", "uploading", "saving_annotations", "succeeded", "failed"].map((status, index) => ({
      sourceImageId: String(index), path: `${index}.png`, sizeBytes: 1, status, uploadProgress: 100,
      ...(status === "failed" ? { failureStage: "upload", error: "Network down" } : {}),
    })),
  }));
  const text = nodes(ui.render());
  for (const label of ["Import is still running...", "Completed images", "Successful images", "Failed images", "Pending", "Uploading", "Saving annotations", "Success", "Failed", "Network down"]) assert.ok(text.includes(label));
  assert.equal(ui.find((node) => node.type === "Progress").props.value, 100);
  assert.ok(text.some((node) => typeof node === "string" && node.includes("100% uploaded does not mean")));
});

test("a finished run shows its outcome until another import dismisses it", async () => {
  const ui = setup(async () => plan());
  await startImport(ui, "success.zip");
  ui.setRunState(outcome("completed"));
  assert.ok(nodes(ui.render()).includes("Import complete"));
  assert.equal(ui.find((node) => node.props.children === "Import"), undefined);
  assert.ok(!nodes(ui.render()).some((node) => typeof node === "string" && node.includes("keeps running in the background")));
  ui.find((node) => node.props.children === "Import another dataset").props.onClick();
  assert.deepEqual(ui.dismissals, ["project-id"]);
  const text = nodes(ui.render());
  assert.ok(text.includes("Browse files"));
  assert.ok(!text.includes("success.zip") && !text.includes("Dataset validated"), "the picker starts fresh");
  assert.equal(ui.find((node) => node.type === "Select").props.value, "coco");
});

test("partial failures retain uploaded-image context and do not offer automatic retries", async () => {
  const ui = setup(async () => plan());
  await startImport(ui, "partial.zip");
  ui.setRunState(outcome("completed_with_errors", {
    successfulImageCount: 1, failedImageCount: 1,
    images: [{ sourceImageId: "1", path: "cat.png", status: "failed", uploadProgress: 100,
      failureStage: "annotations", error: "Save refused", imageId: "uploaded-id" }],
  }));
  const text = nodes(ui.render());
  for (const value of ["Import finished with failures", "Image uploaded, but its annotations were not imported.", "Save refused"]) assert.ok(text.includes(value));
  assert.ok(text.some((node) => typeof node === "string" && node.includes("duplicate images")));
  assert.equal(ui.starts.length, 1);
  assert.equal(ui.find((node) => node.props.children === "Import"), undefined);
});

test("fatal and label-resolution failures surface errors", async () => {
  for (const labelResolutionFailed of [false, true]) {
    const ui = setup(async () => plan());
    await startImport(ui, "fatal.zip");
    ui.setRunState(outcome("failed", { labelResolutionFailed, error: "Access denied", completedImageCount: 0, successfulImageCount: 0 }));
    const text = nodes(ui.render());
    assert.ok(text.includes("Import failed") && text.includes("Access denied"));
    assert.equal(text.some((node) => typeof node === "string" && node.includes("No image uploads were started")), labelResolutionFailed);
    assert.ok(ui.find((node) => node.props.children === "Import another dataset"));
  }
});

test("COCO is the default format and dispatches only to the COCO reader", async () => {
  const ui = setup(async () => plan());
  assert.equal(ui.find((node) => node.type === "Select").props.value, "coco");
  assert.ok(nodes(ui.render()).some((value) => typeof value === "string" && value.includes("COCO annotation JSON")));
  ui.select([zip("coco.zip")]); await tick();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.yoloCalls.length, 0);
  const preview = ui.find((node) => node.props["aria-label"] === "Dataset preview");
  assert.ok(nodes(preview).includes("COCO"));
});

test("YOLO dispatches validation and imports the same plan through the shared orchestration", async () => {
  const validated = { ...plan(), annotationPath: "classes.txt", missingLabelImagePaths: ["images/negative.png", "images/other.png"] };
  const ui = setup(async () => plan(), async () => validated);
  ui.changeFormat("yolo");
  const guidance = nodes(ui.render()).filter((value) => typeof value === "string").join(" ");
  assert.ok(guidance.includes("classes.txt with images/labels") && guidance.includes("data.yaml datasets"));
  assert.ok(guidance.includes("Dataset splits are combined into this project."));
  assert.equal(ui.find((node) => node.type === "input").props["aria-label"], "Choose YOLO ZIP");
  ui.select([zip("yolo.zip")]); await tick();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.yoloCalls[0].name, "yolo.zip");
  const preview = nodes(ui.find((node) => node.props["aria-label"] === "Dataset preview"));
  assert.ok(preview.includes("YOLO") && preview.includes("classes.txt"));
  assert.ok(preview.includes("2") && preview.includes("images have"));
  assert.ok(preview.some((value) => typeof value === "string" && value.includes("no label file")));
  assert.equal(ui.find((node) => node.props.role === "alert"), undefined);
  assert.equal(ui.starts.length, 0);
  ui.find((node) => node.props.children === "Import").props.onClick();
  assert.deepEqual(ui.starts.map((start) => start.plan), [validated]);
});

test("changing format clears validated preview, filename, errors and stale Import handlers", async () => {
  const ui = setup(async () => plan());
  ui.select([zip("old.zip")]); await tick();
  const oldImport = ui.find((node) => node.props.children === "Import").props.onClick;
  ui.changeFormat("yolo"); oldImport();
  assert.equal(ui.starts.length, 0);
  assert.equal(ui.find((node) => node.props["aria-label"] === "Dataset preview"), undefined);
  assert.ok(!nodes(ui.render()).includes("old.zip"));
  assert.ok(nodes(ui.render()).includes("Browse files"));
  ui.select([zip("bad.json")]);
  assert.ok(ui.find((node) => node.props.role === "alert"));
  ui.changeFormat("coco");
  assert.equal(ui.find((node) => node.props.role === "alert"), undefined);
  assert.ok(!nodes(ui.render()).includes("bad.json"));
});

test("format changes invalidate old-format success and errors, even before re-render", async () => {
  for (const fails of [false, true]) {
    const old = deferred(), current = deferred();
    const ui = setup(() => old.promise, () => current.promise);
    const staleInput = ui.find((node) => node.type === "input").props.onChange;
    ui.select([zip("old.zip")]);
    ui.changeFormat("yolo");
    assert.ok(!nodes(ui.render()).includes("Validating..."));
    staleInput({ currentTarget: { files: [zip("current.zip")], value: "selected" } });
    assert.equal(ui.yoloCalls.length, 1);
    current.resolve({ ...plan(), annotationPath: "classes.txt" }); await tick();
    if (fails) old.reject(new Error("Old-format error")); else old.resolve(plan());
    await tick();
    const text = nodes(ui.render());
    assert.ok(text.includes("current.zip") && text.includes("classes.txt"));
    assert.ok(!text.includes("old.zip") && !text.includes("Old-format error"));
  }
});

test("format changes retained from before the import cannot alter the next picker", async () => {
  const ui = setup(async () => plan());
  ui.select([zip("active.zip")]); await tick();
  const change = ui.find((node) => node.type === "Select").props.onValueChange;
  ui.find((node) => node.props.children === "Import").props.onClick();
  change("yolo");
  assert.equal(ui.find((node) => node.type === "Select"), undefined);
  ui.setRunState(outcome("completed"));
  ui.find((node) => node.props.children === "Import another dataset").props.onClick();
  assert.equal(ui.find((node) => node.type === "Select").props.value, "coco");
  assert.equal(ui.starts.length, 1);
});

test("missing-label notice is limited to YOLO plans with missing labels", async () => {
  for (const missingLabelImagePaths of [undefined, [], ["images/negative.png"]]) {
    const ui = setup(async () => ({ ...plan(), missingLabelImagePaths }));
    ui.select([zip("coco.zip")]); await tick();
    assert.equal(ui.find((node) => node.props.role === "note"), undefined);
    ui.changeFormat("yolo"); ui.select([zip("yolo.zip")]); await tick();
    const notice = ui.find((node) => node.props.role === "note");
    assert.equal(!!notice, !!missingLabelImagePaths?.length);
    if (notice) assert.ok(nodes(notice).includes("image has"));
  }
});

test("VOC selector defaults to app-native, provides guidance, and dispatches explicit profiles", async () => {
  const ui = setup(async () => plan());
  assert.ok(ui.find((node) => node.type === "SelectItem" && node.props.value === "voc" && node.props.children === "Pascal VOC"));
  assert.equal(ui.find((node) => node.props["aria-label"] === "Coordinate profile"), undefined);
  ui.changeFormat("voc");
  assert.ok(ui.find((node) => node.type === "Select" && node.props.value === "app-native"));
  const guidance = nodes(ui.render()).filter((node) => typeof node === "string").join(" ");
  for (const text of ["images/", "annotations/", "JPEGImages/", "Annotations/", "zero objects", "metadata is not preserved", "exported by this application"]) assert.ok(guidance.includes(text));
  ui.select([zip("native.zip")]); await tick();
  assert.deepEqual(ui.vocCalls[0].options, { coordinateProfile: "app-native" });
  assert.equal(ui.calls.length + ui.yoloCalls.length, 0);
  let preview = nodes(ui.find((node) => node.props["aria-label"] === "Dataset preview"));
  assert.ok(preview.includes("Pascal VOC") && preview.includes("App-native"));
  ui.changeProfile("one-based-inclusive");
  ui.select([zip("standard.zip")]); await tick();
  assert.deepEqual(ui.vocCalls[1].options, { coordinateProfile: "one-based-inclusive" });
  preview = nodes(ui.find((node) => node.props["aria-label"] === "Dataset preview"));
  assert.ok(preview.includes("Standard Pascal VOC (1-based inclusive)"));
  for (const text of ["Images", "Bounding boxes", "Categories", "Extracted image size", "10 B", "Cat", "Dog", "annotations.json"]) assert.ok(preview.includes(text));
  assert.equal(ui.starts.length, 0);
});

test("profile changes clear ZIP, preview, errors and retained Import handlers", async () => {
  const ui = setup(async () => plan());
  ui.changeFormat("voc"); ui.select([zip("old.zip")]); await tick();
  const oldStart = ui.find((node) => node.props.children === "Import").props.onClick;
  ui.changeProfile("one-based-inclusive"); oldStart();
  assert.equal(ui.starts.length, 0);
  assert.equal(ui.find((node) => node.props["aria-label"] === "Dataset preview"), undefined);
  assert.ok(!nodes(ui.render()).includes("old.zip"));
  assert.ok(nodes(ui.render()).includes("Browse files"));
  ui.select([zip("wrong.json")]);
  assert.ok(ui.find((node) => node.props.role === "alert"));
  ui.changeProfile("app-native");
  assert.equal(ui.find((node) => node.props.role === "alert"), undefined);
  assert.ok(!nodes(ui.render()).includes("wrong.json"));
});

test("old-profile validation success and errors cannot restore state", async () => {
  for (const fails of [false, true]) {
    const old = deferred(), current = deferred();
    const ui = setup(async () => plan(), undefined, (_file, options) => options.coordinateProfile === "app-native" ? old.promise : current.promise);
    ui.changeFormat("voc");
    const inputHandler = ui.find((node) => node.type === "input").props.onChange;
    ui.select([zip("old.zip")]);
    ui.changeProfile("one-based-inclusive");
    assert.ok(!nodes(ui.render()).includes("Validating..."));
    inputHandler({ currentTarget: { files: [zip("current.zip")], value: "selected" } });
    assert.deepEqual(ui.vocCalls[1].options, { coordinateProfile: "one-based-inclusive" });
    current.resolve({ ...plan(), annotationPath: "Annotations" }); await tick();
    if (fails) old.reject(new Error("Old profile error")); else old.resolve(plan());
    await tick();
    const text = nodes(ui.render());
    assert.ok(text.includes("current.zip") && text.includes("Annotations"));
    assert.ok(!text.includes("old.zip") && !text.includes("Old profile error"));
  }
});

test("changing format invalidates pending VOC validation and hides profile selector", async () => {
  const pending = deferred();
  const ui = setup(async () => plan(), undefined, () => pending.promise);
  ui.changeFormat("voc"); ui.select([zip("voc.zip")]);
  ui.changeFormat("coco");
  assert.equal(ui.find((node) => node.props["aria-label"] === "Coordinate profile"), undefined);
  pending.resolve(plan()); await tick();
  assert.equal(ui.find((node) => node.props["aria-label"] === "Dataset preview"), undefined);
  assert.ok(!nodes(ui.render()).includes("voc.zip"));
});

test("VOC imports use shared progress and ignore retained profile and format changes", async () => {
  const validated = plan();
  const ui = setup(async () => validated);
  ui.changeFormat("voc"); ui.select([zip("voc.zip")]); await tick();
  const profileChange = ui.find((node) => node.type === "Select" && node.props.value === "app-native").props.onValueChange;
  const formatChange = ui.find((node) => node.type === "Select" && node.props.value === "voc").props.onValueChange;
  const start = ui.find((node) => node.props.children === "Import").props.onClick;
  start(); start(); profileChange("one-based-inclusive"); formatChange("yolo");
  assert.deepEqual(ui.starts.map((value) => value.plan), [validated]);
  assert.ok(nodes(ui.render()).includes("Preparing labels..."));
  assert.equal(ui.find((node) => node.type === "Select"), undefined);
  ui.setRunState(outcome("completed"));
  assert.ok(nodes(ui.render()).includes("Import complete"));
});
