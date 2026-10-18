import JSZip from "jszip";
import { normalizeDatasetPath } from "@/lib/annotations/coco-import";
import { buildYoloDatasetPlan, parseYoloClasses, type YoloDatasetImageInput } from "@/lib/annotations/yolo-import";
import { MAX_YOLO_YAML_BYTES, parseYoloYaml } from "@/lib/annotations/yolo-yaml";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { decodeDatasetImage } from "@/lib/uploads/dataset-image";

type Entry = { path: string; entry: JSZip.JSZipObject };
type Scope = { imagePrefix: string; labelPrefix: string };
function stem(path: string) { return path.replace(/\.[^/.]+$/, ""); }
function basename(path: string) { return path.slice(path.lastIndexOf("/") + 1); }
/** Matches annotation-export-sheet.tsx's safeName; fallback only, never a guess. */
function sanitizedStem(path: string) {
  return basename(stem(path)).trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "annotations";
}

/** Stop streamed extraction before an oversized YAML is fully materialized. */
async function readYamlEntry({ entry, path }: Entry): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let oversized = false;
    // JSZip exposes this streaming API at runtime, but its JSZipObject types omit it.
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_YOLO_YAML_BYTES) {
        oversized = true;
        stream.pause();
        reject(new Error(`${path}: YAML exceeds the 256 KiB limit.`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (oversized) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { reject(new Error(`${path}: YAML must be valid UTF-8.`)); }
    });
    stream.resume();
  });
}

/** Browser-only legacy TXT or YAML detection ZIP validation. No writes. */
export async function readYoloDatasetZip(archive: File): Promise<ValidatedDatasetImportPlan> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await archive.arrayBuffer()); }
  catch { throw new Error(`Could not read ${archive.name} as a ZIP file.`); }
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    const path = normalizeDatasetPath(original);
    if (seen.has(path)) throw new Error(`Colliding ZIP paths: ${path}`);
    seen.add(path);
    entries.push({ path, entry });
  }
  const classManifests = entries.filter(({ path }) => basename(path) === "classes.txt");
  const yamlManifests = entries.filter(({ path }) => basename(path) === "data.yaml");
  if (classManifests.length > 1) throw new Error("Ambiguous YOLO ZIP: multiple classes.txt dataset roots.");
  if (yamlManifests.length > 1) throw new Error("Ambiguous YOLO ZIP: multiple data.yaml dataset roots.");
  const yaml = yamlManifests[0], classes = classManifests[0];
  const manifest = yaml ?? classes;
  if (!manifest || !/^(?:[^/]+\/)?(?:classes\.txt|data\.yaml)$/.test(manifest.path)) {
    throw new Error("YOLO ZIP requires classes.txt or data.yaml at the root or inside one enclosing dataset directory.");
  }
  const root = manifest.path.slice(0, manifest.path.lastIndexOf("/") + 1);
  if (classes && classes.path !== `${root}classes.txt`) throw new Error("Ambiguous YOLO ZIP: classes.txt and data.yaml must belong to the same dataset root.");
  const yamlPlan = yaml ? parseYoloYaml(await readYamlEntry(yaml), yaml.path) : null;
  const classCategories = classes ? parseYoloClasses(await classes.entry.async("string"), classes.path) : null;
  if (yamlPlan && classCategories && (yamlPlan.categories.length !== classCategories.length ||
      yamlPlan.categories.some((category, index) => category.id !== classCategories[index].id || category.name !== classCategories[index].name))) {
    throw new Error("classes.txt and data.yaml declare inconsistent class names by class ID.");
  }
  const categories = yamlPlan?.categories ?? classCategories!;
  const scopes: Scope[] = yamlPlan ? yamlPlan.splits.map((split) => {
    const base = yamlPlan.path === "." ? root : `${root}${yamlPlan.path}/`;
    const directory = split.directory === "." ? base.replace(/\/$/, "") : `${base}${split.directory}`;
    const parts = directory.split("/");
    const imagesIndex = parts.lastIndexOf("images");
    if (imagesIndex < 0) throw new Error(`${yaml!.path}/${split.name}: image directories must contain an images/ component so labels can be matched.`);
    const labelParts = [...parts]; labelParts[imagesIndex] = "labels";
    return { imagePrefix: `${directory}/`, labelPrefix: `${labelParts.join("/")}/` };
  }) : [{ imagePrefix: `${root}images/`, labelPrefix: `${root}labels/` }];
  for (const [index, scope] of scopes.entries()) {
    if (scopes.slice(0, index).some((other) => scope.imagePrefix.startsWith(other.imagePrefix) || other.imagePrefix.startsWith(scope.imagePrefix))) {
      throw new Error("Overlapping YOLO split image directories would import the same source images more than once.");
    }
  }
  if (!yamlPlan) {
    if (entries.some(({ path }) => /^(?:[^/]+\/)?(?:images|labels)\//.test(path) &&
        !path.startsWith(scopes[0].imagePrefix) && !path.startsWith(scopes[0].labelPrefix))) {
      throw new Error("Ambiguous YOLO ZIP: image or label files outside the selected dataset root.");
    }
  } else {
    for (const { path } of entries) {
      // Reject undeclared image/label trees instead of quietly dropping a split.
      if (path.split("/").slice(0, -1).some((part) => part === "images" || part === "labels") &&
          !scopes.some((scope) => path.startsWith(scope.imagePrefix) || path.startsWith(scope.labelPrefix))) {
        throw new Error(`${path}: image or label files outside the declared YOLO splits or selected dataset root.`);
      }
    }
  }
  const inputs: YoloDatasetImageInput[] = [];
  const files = new Map<string, { file: File; archivePath: string }>();
  const missingLabelImagePaths: string[] = [];
  for (const scope of scopes) {
    const { imageEntries, imageLabels } = matchScope(entries, scope);
    for (const image of imageEntries) {
      // Legacy path/ID shape stays unchanged; YAML retains split-qualified paths.
      const relative = image.path.slice(yamlPlan ? root.length : scope.imagePrefix.length);
      const file = new File([await image.entry.async("blob")], basename(image.path), {
        type: /\.png$/i.test(image.path) ? "image/png" : "image/jpeg",
      });
      const size = await decodeDatasetImage(file);
      const label = imageLabels.get(image.path);
      if (!label) missingLabelImagePaths.push(image.path);
      inputs.push({ path: relative, ...size,
        annotation: label ? { path: label.path, text: await label.entry.async("string") } : undefined,
      });
      files.set(relative, { file, archivePath: image.path });
    }
  }
  const plan = buildYoloDatasetPlan(categories, inputs);
  return { ...plan, annotationPath: manifest.path, missingLabelImagePaths,
    images: plan.images.map((image) => ({ ...image, ...files.get(image.path)! })),
  };
}

/** Matching is isolated per split; flattened fallback never crosses a scope. */
function matchScope(entries: Entry[], { imagePrefix, labelPrefix }: Scope) {
  const imageEntries = entries.filter(({ path }) => path.startsWith(imagePrefix));
  if (!imageEntries.length) throw new Error("YOLO ZIP requires JPEG/PNG image bytes in images/.");
  for (const { path } of imageEntries) {
    if (!/\.(jpe?g|png)$/i.test(path)) throw new Error(`${path}: only JPEG and PNG images are supported.`);
  }
  const labelEntries = entries.filter(({ path }) => path.startsWith(labelPrefix));
  for (const { path } of labelEntries) {
    if (!/\.txt$/i.test(path)) throw new Error(`${path}: YOLO labels must be .txt detection files.`);
  }

  const imagesByStem = new Map<string, Entry>();
  for (const image of imageEntries) {
    const relative = image.path.slice(imagePrefix.length);
    const key = stem(relative);
    if (imagesByStem.has(key)) throw new Error(`Ambiguous image stem: ${key} (multiple image extensions).`);
    imagesByStem.set(key, image);
  }
  const labelsByStem = new Map<string, Entry>();
  for (const label of labelEntries) {
    const key = stem(label.path.slice(labelPrefix.length));
    if (labelsByStem.has(key)) throw new Error(`Colliding label stem: ${key}`);
    labelsByStem.set(key, label);
  }

  // A label is valid only when its full candidate set contains one image.
  // Include sanitized candidates even if an exact match exists: otherwise a
  // collision such as "a b.jpg" + "a-b.jpg" could silently lose annotations.
  const fallbackCandidates = new Map<string, Set<Entry>>();
  for (const image of imageEntries) {
    const relative = image.path.slice(imagePrefix.length);
    const directory = relative.slice(0, relative.lastIndexOf("/") + 1);
    // Directory-preserving fallback, plus the app's flattened export convention.
    for (const key of new Set([`${directory}${sanitizedStem(relative)}`, sanitizedStem(relative)])) {
      const candidates = fallbackCandidates.get(key) ?? new Set<Entry>();
      candidates.add(image);
      fallbackCandidates.set(key, candidates);
    }
  }
  const imageLabels = new Map<string, Entry>();
  for (const [key, label] of labelsByStem) {
    const candidates = new Set(fallbackCandidates.get(key) ?? []);
    const exact = imagesByStem.get(key);
    if (exact) candidates.add(exact);
    if (candidates.size === 0) throw new Error(`Orphan label file: ${label.path} (no matching image).`);
    if (candidates.size !== 1) throw new Error(`Ambiguous label file: ${label.path} matches multiple images.`);
    const image = [...candidates][0];
    if (imageLabels.has(image.path)) throw new Error(`Multiple label files match image: ${image.path}`);
    imageLabels.set(image.path, label);
  }

  return { imageEntries, imageLabels };
}
