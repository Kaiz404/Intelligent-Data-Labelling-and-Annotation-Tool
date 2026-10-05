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
function setup() {
  const slots = [];
  let cursor = 0, refreshCount = 0, transitions = 0, aiOptions;
  const navigations = [], queryWrites = [], aiStarts = [];
  const query = { q: "cat", filter: "all", status: "annotated", labels: "", sort: "name", dir: "descending" };
  const router = { refresh() { refreshCount++; }, push(value) { navigations.push(value); }, replace(value) { navigations.push(value); } };
  let props = {
    project: { id: "project-id", name: "Project" }, projects: [], labels: [], initialJob: null, initialAiStates: {},
    images: [{ id: "cat-1", fileName: "cat.png", status: "Annotated", annotations: [] }],
  };
  function memo(factory, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) slots[index] = { value: factory(), dependencies };
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
  function render() { cursor = 0; return exports.ProjectDetailClient(props); }
  const find = (predicate) => nodes(render()).find((node) => node?.props && predicate(node));
  const dialog = () => find((node) => node.type === "ImportDatasetDialog");
  const click = (label) => find((node) => node.type === "Button" && nodes(node.props.children).includes(label)).props.onClick();
  return {
    render, find, dialog, click, query, queryWrites, navigations, aiStarts,
    refreshCount: () => refreshCount, transitions: () => transitions, aiOptions: () => aiOptions,
    mergeServerProps: (value) => { props = { ...props, ...value }; },
  };
}

for (const status of ["completed", "completed_with_errors", "failed"]) {
  test(`${status} completion uses shared refresh and preserves open dialog and URL state`, () => {
    const ui = setup();
    ui.click("Import Dataset");
    const before = ui.dialog();
    assert.equal(before.props.projectId, "project-id");
    assert.equal(before.props.open, true);
    assert.equal(before.props.onImportComplete, ui.find((node) => node.type === "UploadImagesDialog").props.onUploadComplete);
    assert.equal(before.props.onImportComplete, ui.aiOptions().onFinished);
    const query = { ...ui.query };
    before.props.onImportComplete({ status, labelResolutionFailed: status === "failed" });
    assert.equal(ui.refreshCount(), 1);
    assert.equal(ui.transitions(), 1);
    ui.mergeServerProps({
      images: [{ id: "imported-cat", fileName: "cat-imported.png", status: "Annotated", annotations: [] }],
      labels: [{ id: "new-label", name: "Cat", color: "#fff" }],
    });
    const after = ui.dialog();
    assert.equal(after.type, before.type);
    assert.equal(after.key, before.key);
    assert.equal(after.key, undefined); // Refresh must not key/remount the summary owner.
    assert.equal(after.props.open, true);
    assert.equal(after.props.onImportComplete, before.props.onImportComplete);
    assert.equal(ui.find((node) => node.type === "ImageCard").props.image.id, "imported-cat");
    assert.equal(ui.find((node) => node.type === "Input").props.value, "cat");
    assert.deepEqual(ui.query, query);
    assert.deepEqual(ui.queryWrites, []);
    assert.deepEqual(ui.navigations, []);
    after.props.onOpenChange(false);
    assert.equal(ui.dialog().props.open, false);
    ui.click("Import Dataset");
    assert.equal(ui.dialog().props.open, true);
  });
}

test("upload and AI project actions retain their own state and callbacks", async () => {
  const ui = setup();
  ui.click("Upload Images");
  const upload = ui.find((node) => node.type === "UploadImagesDialog");
  assert.equal(upload.props.open, true);
  assert.equal(upload.props.projectId, "project-id");
  assert.equal(ui.dialog().props.open, false);
  upload.props.onUploadComplete();
  assert.equal(ui.refreshCount(), 1);
  ui.click("AI Annotate");
  const ai = ui.find((node) => node.type === "BatchAiAnnotateDialog");
  assert.equal(ai.props.open, true);
  assert.deepEqual(ai.props.imageIds, ["cat-1"]);
  await ai.props.onStart({ labels: ["Cat"] });
  assert.deepEqual(ui.aiStarts, [{ projectId: "project-id", labels: ["Cat"] }]);
  assert.equal(ui.refreshCount(), 1);
  assert.equal(ui.dialog().props.open, false);
});
