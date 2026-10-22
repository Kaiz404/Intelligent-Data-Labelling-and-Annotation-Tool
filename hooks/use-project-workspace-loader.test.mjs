import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./use-project-workspace-loader.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});

function setup() {
  const slots = [];
  let cursor = 0, effects = [];
  const changed = (previous, dependencies) => !previous || dependencies.some((value, i) => value !== previous.dependencies[i]);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (changed(slots[index], dependencies)) {
        slots[index] = { dependencies };
        effects.push(effect);
      }
    },
    useEffectEvent(callback) {
      const index = cursor++;
      slots[index] ??= { latest: null, call: (...args) => slots[index].latest(...args) };
      slots[index].latest = callback;
      return slots[index].call;
    },
  };
  const loaderModule = { exports: {} };
  new Function("require", "module", "exports", outputText)(() => react, loaderModule, loaderModule.exports);
  const loadWorkspace = loaderModule.exports.useProjectWorkspaceLoader;

  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    const body = url.endsWith("/detail-meta")
      ? { labels: [], latestJob: null, aiStates: {} }
      : url.includes("/images?")
        ? { images: [{ id: "image-a" }, { id: "image-b" }], total: 2 }
        : { image: { id: url.split("/").pop() } };
    return { ok: true, json: async () => body };
  };

  let result;
  return {
    requests,
    get result() { return result; },
    async render(priorityImageId) {
      cursor = 0;
      result = loadWorkspace("project-id", true, { priorityImageId });
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      await new Promise((resolve) => setTimeout(resolve, 0));
      cursor = 0;
      result = loadWorkspace("project-id", true, { priorityImageId });
    },
  };
}

test("switching the open image keeps the loaded workspace and fetches nothing", async () => {
  const loader = setup();
  await loader.render("image-a");
  assert.equal(loader.result.status, "ready");
  assert.deepEqual(loader.requests, [
    "/api/projects/project-id/detail-meta",
    "/api/projects/project-id/images/image-a",
    "/api/projects/project-id/images?offset=0&limit=32",
  ]);

  await loader.render("image-b");
  assert.equal(loader.requests.length, 3);
  assert.equal(loader.result.status, "ready");
  assert.deepEqual(loader.result.images.map((image) => image.id), ["image-a", "image-b"]);
});
