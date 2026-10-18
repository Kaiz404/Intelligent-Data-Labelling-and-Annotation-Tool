import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node } from "yaml";
import type { DatasetCategory } from "@/lib/types/dataset-import";

export const MAX_YOLO_YAML_BYTES = 256 * 1024;
const MAX_YAML_DEPTH = 32;
const MAX_YAML_NODES = 20_000;
export type YoloYamlManifest = {
  categories: DatasetCategory[];
  path: string;
  splits: Array<{ name: "train" | "val" | "test"; directory: string }>;
};

/** Validate directory syntax without resolving it against any filesystem. */
export function normalizeYoloYamlDirectory(value: string, context: string, allowRoboflow = false): string {
  const path = value.replace(/\\/g, "/");
  if (!path.trim() || /[\x00-\x1f\x7f:$%~*?\[\]{}();|&<>`!]/.test(path) || path.startsWith("/")) {
    throw new Error(`${context}: unsafe directory path; absolute, remote, environment, home, glob and shell paths are unsupported.`);
  }
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) {
    // Recognize only this literal export convention; never traverse a parent.
    if (allowRoboflow && /^\.\.\/(train|val|valid|test)\/images\/?$/.test(path)) return path.replace(/^\.\.\//, "").replace(/\/$/, "");
    throw new Error(`${context}: parent traversal is unsupported.`);
  }
  return parts.join("/") || ".";
}

/** Strict, inert detection manifest parser. No file access, fetching or commands. */
export function parseYoloYaml(text: string, filename = "data.yaml"): YoloYamlManifest {
  if (new TextEncoder().encode(text).byteLength > MAX_YOLO_YAML_BYTES) throw new Error(`${filename}: YAML exceeds the 256 KiB limit.`);
  const document = parseDocument(text.replace(/^\uFEFF/, ""), { version: "1.2", strict: true, uniqueKeys: true });
  if (document.errors.length || document.warnings.length) {
    throw new Error(`${filename}: invalid YAML: ${[...document.errors, ...document.warnings].map((error) => error.message).join("; ")}`);
  }
  if (!isMap(document.contents)) throw new Error(`${filename}: expected one YAML mapping document.`);
  const stack: Array<{ node: Node | null; depth: number }> = [{ node: document.contents, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node) continue;
    if (++count > MAX_YAML_NODES || depth > MAX_YAML_DEPTH) throw new Error(`${filename}: YAML exceeds the nesting/node complexity limit.`);
    if (isAlias(node) || ("anchor" in node && node.anchor) || node.tag) throw new Error(`${filename}: aliases, anchors and explicit/custom tags are unsupported.`);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key) || !["string", "number"].includes(typeof pair.key.value)) throw new Error(`${filename}: mapping keys must be scalar strings or integers.`);
        if (pair.key.value === "<<") throw new Error(`${filename}: YAML merge keys are unsupported.`);
        stack.push({ node: pair.key, depth: depth + 1 }, { node: pair.value as Node | null, depth: depth + 1 });
      }
    } else if (isSeq(node)) {
      for (const child of node.items) stack.push({ node: child as Node | null, depth: depth + 1 });
    }
  }
  const root = document.contents;
  const valueOf = (key: string): unknown => {
    const node = root.get(key, true);
    return isScalar(node) ? node.value : node;
  };
  for (const pair of root.items) if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new Error(`${filename}: top-level keys must be strings.`);
  const names = root.get("names", true);
  const categories: DatasetCategory[] = [];
  function className(node: unknown, id: number) {
    if (!isScalar(node) || typeof node.value !== "string" || !node.value.trim()) throw new Error(`${filename}: names[${id}] must be a non-blank string.`);
    return node.value.trim();
  }
  if (isSeq(names)) {
    categories.push(...names.items.map((node, id) => ({ id: String(id), name: className(node, id) })));
  } else if (isMap(names)) {
    const ids = new Set<number>();
    for (const pair of names.items) {
      if (!isScalar(pair.key) || !/^(0|[1-9]\d*)$/.test(pair.key.source ?? "") ||
          !["number", "string"].includes(typeof pair.key.value)) throw new Error(`${filename}: names keys must be canonical nonnegative integer class IDs.`);
      const id = Number(pair.key.value);
      if (!Number.isSafeInteger(id) || id < 0) throw new Error(`${filename}: class IDs must be nonnegative safe integers.`);
      if (ids.has(id)) throw new Error(`${filename}: duplicate class index ${id}.`);
      ids.add(id);
      categories.push({ id: String(id), name: className(pair.value, id) });
    }
    categories.sort((a, b) => Number(a.id) - Number(b.id));
  } else throw new Error(`${filename}: names is required and must be a list or numeric map; classes cannot be invented from nc.`);
  if (!categories.length || categories.some((category, index) => category.id !== String(index))) throw new Error(`${filename}: names must declare contiguous class IDs 0..N-1 with at least one class.`);
  if (root.has("nc")) {
    const nc = valueOf("nc");
    if (typeof nc !== "number" || !Number.isSafeInteger(nc) || nc <= 0 || nc !== categories.length) throw new Error(`${filename}: nc must be a positive integer matching names (${categories.length} classes).`);
  }
  if ((root.has("task") && valueOf("task") !== "detect") || root.has("kpt_shape") || root.has("flip_idx")) throw new Error(`${filename}: only YOLO object-detection task configurations are supported.`);
  if (root.has("download") && valueOf("download") != null && valueOf("download") !== false && valueOf("download") !== "") throw new Error(`${filename}: download-based dataset configurations are unsupported; include image bytes in the ZIP.`);
  const pathValue = valueOf("path");
  if (root.has("path") && typeof pathValue !== "string") throw new Error(`${filename}: path must be a relative directory string.`);
  const path = pathValue === undefined ? "." : normalizeYoloYamlDirectory(pathValue as string, `${filename}/path`);
  const splits: YoloYamlManifest["splits"] = [];
  for (const key of ["train", "val", "valid", "test"] as const) {
    const value = valueOf(key);
    if (value == null || value === "") continue;
    if (typeof value !== "string") throw new Error(`${filename}/${key}: split arrays and non-string split configurations are unsupported; provide an image directory.`);
    const directory = normalizeYoloYamlDirectory(value, `${filename}/${key}`, pathValue === undefined || pathValue === ".");
    if (/\.txt$/i.test(directory)) throw new Error(`${filename}/${key}: image-list .txt splits are unsupported; provide an image directory.`);
    const name = key === "valid" ? "val" : key;
    const existing = splits.find((split) => split.name === name);
    if (existing && existing.directory !== directory) throw new Error(`${filename}: val and valid declare conflicting directories.`);
    if (!existing) splits.push({ name, directory });
  }
  if (!splits.length) throw new Error(`${filename}: at least one populated train, val/valid or test split is required.`);
  return { categories, path, splits };
}
