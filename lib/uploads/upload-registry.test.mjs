// node --test lib/uploads/upload-registry.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("./upload-registry.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const compiled = { exports: {} };
new Function("exports", outputText)(compiled.exports);
const { createUploadRegistry } = compiled.exports;

function fakeStore(projectId) {
  const listeners = new Set();
  return {
    projectId,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { for (const listener of listeners) listener(); },
  };
}

function setup() {
  const created = [];
  const registry = createUploadRegistry((projectId) => {
    const store = fakeStore(projectId);
    created.push(store);
    return store;
  });
  let notified = 0;
  registry.subscribe(() => { notified++; });
  return { registry, created, notified: () => notified };
}

test("get creates one store per project, lazily", () => {
  const { registry, created } = setup();
  assert.equal(created.length, 0);
  const first = registry.get("a", "Alpha");
  assert.equal(registry.get("a", "Alpha"), first);
  assert.equal(first.projectId, "a");
  registry.get("b", "Beta");
  assert.equal(created.length, 2);
  assert.deepEqual(registry.getEntries().map(({ projectId, projectName }) => [projectId, projectName]), [["a", "Alpha"], ["b", "Beta"]]);
});

test("getEntries returns the same array until a project is added", () => {
  const { registry } = setup();
  registry.get("a", "Alpha");
  const entries = registry.getEntries();
  registry.get("a", "Alpha");
  assert.equal(registry.getEntries(), entries);
  registry.get("b", "Beta");
  assert.notEqual(registry.getEntries(), entries);
  assert.equal(entries.length, 1, "a published array is never mutated");
});

test("a new project is announced after get returns, never during it", async () => {
  const { registry, notified } = setup();
  registry.get("a", "Alpha");
  assert.equal(notified(), 0);
  await Promise.resolve();
  assert.equal(notified(), 1);
  registry.get("a", "Alpha");
  await Promise.resolve();
  assert.equal(notified(), 1, "an existing project is not announced again");
});

test("every project's store changes reach registry subscribers", async () => {
  const { registry, created, notified } = setup();
  registry.get("a", "Alpha");
  registry.get("b", "Beta");
  await Promise.resolve();
  const before = notified();
  created[0].emit();
  created[1].emit();
  assert.equal(notified(), before + 2);
});
