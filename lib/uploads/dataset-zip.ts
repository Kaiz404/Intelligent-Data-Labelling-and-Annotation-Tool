import JSZip from "jszip";
import { normalizeDatasetPath, parseCocoDataset } from "@/lib/annotations/coco-import";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { decodeDatasetImage } from "@/lib/uploads/dataset-image";

type Entry = { path: string; entry: JSZip.JSZipObject };

function basename(path: string) { return path.slice(path.lastIndexOf("/") + 1); }

function isCocoCandidate(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    ["images", "categories", "annotations"].every((key) => key in value);
}

async function validateImage(file: File, width: number, height: number) {
  const actual = await decodeDatasetImage(file);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`${file.name}: actual dimensions ${actual.width}×${actual.height} do not match declared dimensions ${width}×${height}.`);
  }
}

/** Browser-only validation. No uploads, label creation, or database writes. */
export async function readCocoDatasetZip(archive: File): Promise<ValidatedDatasetImportPlan> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await archive.arrayBuffer()); }
  catch { throw new Error(`Could not read ${archive.name} as a ZIP file.`); }

  const entries: Entry[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(json|jpe?g|png)$/i.test(entry.name)) continue;
    // JSZip sanitizes '..'; inspect the original name before using its output.
    const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    let path: string;
    try { path = normalizeDatasetPath(original); }
    catch { continue; } // Unsafe extras cannot participate in matching.
    entries.push({ path, entry });
  }
  const candidates: Array<Entry & { document: unknown }> = [];
  for (const item of entries.filter(({ path }) => /\.json$/i.test(path))) {
    let document: unknown;
    try { document = JSON.parse(await item.entry.async("string")); }
    catch {
      if (basename(item.path).toLowerCase() === "annotations.json") {
        throw new Error(`${item.path}: annotation document is not valid JSON.`);
      }
      continue;
    }
    if (isCocoCandidate(document)) candidates.push({ ...item, document });
  }
  if (candidates.length !== 1) {
    throw new Error(candidates.length === 0
      ? "ZIP must contain one COCO JSON document with images, categories, and annotations."
      : `Ambiguous ZIP: multiple COCO annotation documents (${candidates.map((c) => c.path).join(", ")}).`);
  }
  const candidate = candidates[0];
  const plan = parseCocoDataset(candidate.document);
  const imageEntries = entries.filter(({ path }) => /\.(jpe?g|png)$/i.test(path));
  const directory = candidate.path.slice(0, candidate.path.lastIndexOf("/") + 1);
  const usedPaths = new Set<string>();
  const images: ValidatedDatasetImportPlan["images"] = [];
  for (const image of plan.images) {
    // Exact archive/document-relative matches precede the export images/ layout.
    let matches = imageEntries.filter(({ path }) => path === image.path || path === directory + image.path);
    if (matches.length === 0) {
      matches = imageEntries.filter(({ path }) => path === `images/${image.path}` || path === `${directory}images/${image.path}`);
    }
    if (matches.length === 0) {
      matches = imageEntries.filter(({ path }) => basename(path) === basename(image.path));
    }
    if (matches.length !== 1) {
      throw new Error(matches.length === 0 ? `Missing referenced image: ${image.path}` : `Ambiguous referenced image: ${image.path}`);
    }
    const match = matches[0];
    if (usedPaths.has(match.path)) throw new Error(`Multiple COCO images reference the same ZIP file: ${match.path}`);
    usedPaths.add(match.path);
    const type = /\.png$/i.test(match.path) ? "image/png" : "image/jpeg";
    const file = new File([await match.entry.async("blob")], basename(match.path), { type });
    await validateImage(file, image.width, image.height);
    images.push({ ...image, archivePath: match.path, file });
  }
  return { categories: plan.categories, annotationPath: candidate.path, images };
}
