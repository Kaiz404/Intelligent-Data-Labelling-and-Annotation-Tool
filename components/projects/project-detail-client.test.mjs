// Focused parent integration tests; child dialog lifecycle is covered in import-dataset-dialog.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./project-detail-client.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
});
function nodes(tree) {
  if (tree == null || typeof tree === "boolean") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const image = (id, fileName, patch = {}) => ({ id, fileName, status: "Annotated", annotations: [], ...patch });
function importRun(status, importedImages = []) {
  return {
    id: "run", projectId: "project-id", projectName: "Project", fileName: "set.zip", importedImages,
    state: { status, totalImageCount: 2, completedImageCount: 0, successfulImageCount: 0, failedImageCount: 0, uploadProgress: 0, images: [], labelResolutionFailed: false },
  };
}
function setup({ query: queryPatch = {} } = {}) {
  let slots = [], effects = [];
  let cursor = 0, refreshCount = 0, transitions = 0, aiOptions, run;
  const navigations = [], queryWrites = [], aiStarts = [], dismissals = [];
  const query = { q: "cat", filter: "all", status: "annotated", labels: "", sort: "name", dir: "descending", ...queryPatch };
  const router = { refresh() { refreshCount++; }, push(value) { navigations.push(value); }, replace(value) { navigations.push(value); } };
  let props = {
    project: { id: "project-id", name: "Project" }, projects: [], labels: [], initialJob: null, initialAiStates: {},
    images: [image("cat-1", "cat.png")],
  };
  const changed = (previous, dependencies) => !previous || dependencies.some((value, i) => value !== previous.dependencies[i]);
  function memo(factory, dependencies) {
    const index = cursor++;
    if (changed(slots[index], dependencies)) slots[index] = { value: factory(), dependencies };
    return slots[index].value;
  }
  const primitive = new Proxy({}, { get: (_, key) => key });
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
      useEffect(effect, dependencies) {
        const index = cursor++;
        if (changed(slots[index], dependencies)) { slots[index] = { dependencies }; effects.push(effect); }
      },
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      startTransition(callback) { transitions++; callback(); },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "next/navigation": { useRouter: () => router },
    "@/hooks/use-query-params": { useQueryParams: () => [query, (value) => queryWrites.push(value)] },
    "@/hooks/use-annotation-job": { useAnnotationJob(options) {
      aiOptions = options;
      return { job: null, states: {}, isActive: false, start: async (value) => aiStarts.push(value), cancel() {} };
    } },
    "@/components/projects/dataset-import-provider": {
      useDatasetImportRun: (projectId) => (run?.projectId === projectId ? run : undefined),
      useDatasetImportActions: () => ({ dismissDatasetImport: (projectId) => dismissals.push(projectId) }),
    },
    "@/lib/image-label-filter": {
      parseLabelFilter: () => [], countImagesByLabel: () => new Map(), matchesLabelFilter: () => true, toggleLabelFilter: () => "",
    },
    "@/lib/format": { numberFormatter: new Intl.NumberFormat("en-US") },
    "@/lib/actions/recycle-bin": { moveImagesToRecycleBin() { throw new Error("Unexpected deletion"); } },
  };
  const exports = {};
  new Function("require", "exports", outputText)((name) => {
    if (name in dependencies) return dependencies[name];
    if (name === "lucide-react" || name.startsWith("@/components/")) return primitive;
    throw new Error(`Unexpected dependency: ${name}`);
  }, exports);
  function render() {
    cursor = 0; effects = [];
    const tree = exports.ProjectDetailClient(props);
    for (const effect of effects) effect();
    return tree;
  }
  const find = (predicate) => nodes(render()).find((node) => node?.props && predicate(node));
  const dialog = () => find((node) => node.type === "ImportDatasetDialog");
  const click = (label) => find((node) => node.type === "Button" && nodes(node.props.children).includes(label)).props.onClick();
  const cards = () => nodes(render()).filter((node) => node?.type === "ImageCard").map((node) => node.props.image);
  return {
    render, find, dialog, click, cards, query, queryWrites, navigations, aiStarts, dismissals,
    refreshCount: () => refreshCount, transitions: () => transitions, aiOptions: () => aiOptions,
    mergeServerProps: (value) => { props = { ...props, ...value }; },
    setRun: (value) => { run = value; },
    remount: () => { slots = []; },
  };
}

test("imported images join the grid after the server's, once each, and can be renamed before a refresh", () => {
  const ui = setup({ query: { q: "", status: "all", sort: "added", dir: "" } });
  const imported = image("new-1", "new.png", { url: "blob:local" });
  ui.setRun(importRun("importing", [image("cat-1", "cat.png"), imported]));
  assert.deepEqual(ui.cards().map((card) => card.id), ["cat-1", "new-1"]);
  assert.equal(ui.cards()[1], imported);
  ui.find((node) => node.type === "RenameImageDialog").props.onRenamed("new-1", "renamed.png");
  assert.equal(ui.cards()[1].fileName, "renamed.png");
  ui.mergeServerProps({ images: [image("cat-1", "cat.png"), image("new-1", "renamed.png", { url: "signed" })] });
  assert.deepEqual(ui.cards().map((card) => [card.id, card.fileName, card.url]), [
    ["cat-1", "cat.png", undefined], ["new-1", "renamed.png", "signed"],
  ]);
});

test("a run refreshes once its labels are resolved and once it ends, but not on remount", () => {
  const ui = setup();
  ui.render();
  ui.setRun(importRun("resolving_labels"));
  ui.render();
  assert.equal(ui.refreshCount(), 0);
  ui.setRun(importRun("importing"));
  ui.render();
  assert.equal(ui.refreshCount(), 1);
  ui.setRun(importRun("importing", [image("new-1", "cat-new.png")]));
  ui.render();
  assert.equal(ui.refreshCount(), 1);
  ui.setRun(importRun("completed_with_errors", [image("new-1", "cat-new.png")]));
  ui.render(); ui.render();
  assert.equal(ui.refreshCount(), 2);
  assert.equal(ui.transitions(), 2);
  ui.remount();
  ui.render(); ui.render();
  assert.equal(ui.refreshCount(), 2);
  assert.deepEqual(ui.navigations, []);
});

test("labels failing to resolve end the run with a single refresh", () => {
  const ui = setup();
  ui.setRun(importRun("resolving_labels"));
  ui.render();
  ui.setRun(importRun("failed"));
  ui.render(); ui.render();
  assert.equal(ui.refreshCount(), 1);
});

test("the import banner follows the run; it reopens the dialog and dismisses through the provider", () => {
  const ui = setup();
  assert.equal(ui.find((node) => node.type === "DatasetImportBanner"), undefined);
  const run = importRun("importing");
  ui.setRun(run);
  const banner = ui.find((node) => node.type === "DatasetImportBanner");
  assert.equal(banner.props.run, run);
  assert.equal(ui.dialog().props.open, false);
  banner.props.onViewDetails();
  assert.equal(ui.dialog().props.open, true);
  assert.equal(ui.dialog().props.projectId, "project-id");
  assert.equal(ui.dialog().props.projectName, "Project");
  banner.props.onDismiss();
  assert.deepEqual(ui.dismissals, ["project-id"]);
});

test("another project's run does not reach this page", () => {
  const ui = setup({ query: { q: "", status: "all" } });
  ui.setRun({ ...importRun("importing", [image("other", "cat-other.png")]), projectId: "other-project" });
  assert.equal(ui.find((node) => node.type === "DatasetImportBanner"), undefined);
  assert.deepEqual(ui.cards().map((card) => card.id), ["cat-1"]);
});

test("upload and AI project actions retain their own state and callbacks", async (t) => {
  const ui = setup();
  ui.click("Upload Images");
  const upload = ui.find((node) => node.type === "UploadImagesDialog");
  assert.equal(upload.props.open, true);
  assert.equal(upload.props.projectId, "project-id");
  assert.equal(ui.dialog().props.open, false);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  upload.props.onUploadComplete();
  upload.props.onUploadComplete();
  assert.equal(ui.refreshCount(), 1, "a burst of uploads refreshes once at first");
  t.mock.timers.tick(15_000);
  assert.equal(ui.refreshCount(), 2, "and once more after the interval");
  ui.click("AI Annotate");
  const ai = ui.find((node) => node.type === "BatchAiAnnotateDialog");
  assert.equal(ai.props.open, true);
  assert.deepEqual(ai.props.imageIds, ["cat-1"]);
  await ai.props.onStart({ labels: ["Cat"] });
  assert.deepEqual(ui.aiStarts, [{ projectId: "project-id", labels: ["Cat"] }]);
  assert.equal(ui.refreshCount(), 2);
  assert.equal(ui.dialog().props.open, false);
  ui.click("Import Dataset");
  assert.equal(ui.dialog().props.open, true);
});
