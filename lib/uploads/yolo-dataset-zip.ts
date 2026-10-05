import JSZip from "jszip";
import { normalizeDatasetPath } from "@/lib/annotations/coco-import";
import { parseYoloDataset, type YoloDatasetImageInput } from "@/lib/annotations/yolo-import";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { decodeDatasetImage } from "@/lib/uploads/dataset-image";

type Entry = { path: string; entry: JSZip.JSZipObject };
function stem(path: string) { return path.replace(/\.[^/.]+$/, ""); }
function basename(path: string) { return path.slice(path.lastIndexOf("/") + 1); }
/** Matches annotation-export-sheet.tsx's safeName; fallback only, never a guess. */
function sanitizedStem(path: string) {
  return basename(stem(path)).trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "annotations";
}

/** Browser-only YOLO detection ZIP validation. No uploads or database writes. */
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
  const manifests = entries.filter(({ path }) => /^(?:[^/]+\/)?classes\.txt$/.test(path));
  if (manifests.length !== 1) {
    throw new Error(manifests.length === 0
      ? "YOLO ZIP requires classes.txt at the root or inside one enclosing dataset directory. data.yaml-only datasets are not supported."
      : "Ambiguous YOLO ZIP: multiple classes.txt dataset roots.");
  }
  const manifest = manifests[0];
  const root = manifest.path.slice(0, -"classes.txt".length);
  const imagePrefix = `${root}images/`, labelPrefix = `${root}labels/`;
  // Other dataset trees would otherwise be silently left out of the plan.
  if (entries.some(({ path }) => /^(?:[^/]+\/)?(?:images|labels)\//.test(path) &&
      !path.startsWith(imagePrefix) && !path.startsWith(labelPrefix))) {
    throw new Error("Ambiguous YOLO ZIP: image or label files outside the selected dataset root.");
  }
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

  const inputs: YoloDatasetImageInput[] = [];
  const files = new Map<string, File>();
  const missingLabelImagePaths: string[] = [];
  for (const image of imageEntries) {
    const relative = image.path.slice(imagePrefix.length);
    const file = new File([await image.entry.async("blob")], basename(image.path), {
      type: /\.png$/i.test(image.path) ? "image/png" : "image/jpeg",
    });
    const size = await decodeDatasetImage(file);
    const label = imageLabels.get(image.path);
    if (!label) missingLabelImagePaths.push(image.path);
    inputs.push({ path: relative, ...size,
      annotation: label ? { path: label.path, text: await label.entry.async("string") } : undefined,
    });
    files.set(relative, file);
  }
  const plan = parseYoloDataset(await manifest.entry.async("string"), inputs, manifest.path);
  return {
    ...plan, annotationPath: manifest.path, missingLabelImagePaths,
    images: plan.images.map((image) => ({ ...image, archivePath: `${imagePrefix}${image.path}`, file: files.get(image.path)! })),
  };
}
