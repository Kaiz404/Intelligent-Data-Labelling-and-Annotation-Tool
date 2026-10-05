import JSZip from "jszip";
import { normalizeDatasetPath } from "@/lib/annotations/coco-import";
import { buildVocDatasetPlan, parseVocAnnotation, type VocAnnotation, type VocImportOptions } from "@/lib/annotations/voc-import";
import type { ValidatedDatasetImportPlan } from "@/lib/types/dataset-import";
import { decodeDatasetImage } from "@/lib/uploads/dataset-image";

type Entry = { path: string; entry: JSZip.JSZipObject };
function directory(path: string) { return path.slice(0, path.lastIndexOf("/") + 1); }
function basename(path: string) { return path.slice(path.lastIndexOf("/") + 1); }

/** Browser-only VOC ZIP validation. No uploads, label creation or annotation writes. */
export async function readVocDatasetZip(archive: File, options: VocImportOptions = {}): Promise<ValidatedDatasetImportPlan> {
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
  // Permit one root and one directory convention; never silently select one dataset.
  const layouts = new Map<string, { root: string; images: string; annotations: string }>();
  for (const { path } of entries) {
    const parts = path.split("/");
    const folders = ["images", "annotations", "JPEGImages", "Annotations"];
    const offset = folders.includes(parts[0]) ? 0 : 1;
    if (parts.length <= offset + 1 || !folders.includes(parts[offset])) continue;
    const root = offset ? `${parts[0]}/` : "";
    const conventional = parts[offset] === "JPEGImages" || parts[offset] === "Annotations";
    const layout = { root, images: `${root}${conventional ? "JPEGImages" : "images"}/`, annotations: `${root}${conventional ? "Annotations" : "annotations"}/` };
    layouts.set(`${root}:${conventional}`, layout);
  }
  if (layouts.size !== 1) throw new Error("VOC ZIP requires one images/annotations or JPEGImages/Annotations dataset at the root or inside one enclosing directory.");
  const layout = [...layouts.values()][0];
  const images = entries.filter(({ path }) => path.startsWith(layout.images));
  const annotations = entries.filter(({ path }) => path.startsWith(layout.annotations));
  if (!images.length || !annotations.length) throw new Error("VOC ZIP requires image bytes and XML annotation documents.");
  for (const { path } of images) if (!/\.(jpe?g|png)$/i.test(path)) throw new Error(`${path}: only JPEG and PNG images are supported.`);
  for (const { path } of annotations) if (!/\.xml$/i.test(path)) throw new Error(`${path}: VOC annotations must be .xml files.`);
  const byPath = new Map(images.map((image) => [image.path, image]));
  const byBasename = new Map<string, Entry[]>();
  for (const image of images) byBasename.set(basename(image.path), [...(byBasename.get(basename(image.path)) ?? []), image]);
  const inputs: Array<{ path: string; annotationPath: string; annotation: VocAnnotation }> = [];
  const files = new Map<string, File>();
  for (const document of annotations.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const annotation = parseVocAnnotation(await document.entry.async("string"), document.path, options);
    const reference = annotation.filename;
    // Within a priority tier every candidate must identify the same image.
    const tiers = [
      [reference, `${directory(document.path)}${reference}`],
      [`${layout.images}${reference}`, `${layout.root}${reference}`],
    ];
    let image: Entry | undefined;
    for (const paths of tiers) {
      const candidates = [...new Set(paths.map((path) => byPath.get(path)).filter((entry): entry is Entry => !!entry))];
      if (candidates.length > 1) throw new Error(`${document.path}: ambiguous image reference ${reference}.`);
      if (candidates.length === 1) { image = candidates[0]; break; }
    }
    if (!image) {
      const candidates = byBasename.get(basename(reference)) ?? [];
      if (candidates.length > 1) throw new Error(`${document.path}: ambiguous image basename ${reference}.`);
      image = candidates[0];
    }
    if (!image) throw new Error(`Orphan VOC annotation: ${document.path} references unavailable image ${reference}.`);
    if (files.has(image.path)) throw new Error(`Multiple VOC annotation documents reference image: ${image.path}`);
    const file = new File([await image.entry.async("blob")], basename(image.path), { type: /\.png$/i.test(image.path) ? "image/png" : "image/jpeg" });
    const decoded = await decodeDatasetImage(file);
    if (decoded.width !== annotation.width || decoded.height !== annotation.height) {
      throw new Error(`${document.path}: XML size ${annotation.width}×${annotation.height} does not match decoded image ${image.path} (${decoded.width}×${decoded.height}).`);
    }
    files.set(image.path, file);
    inputs.push({ path: image.path, annotationPath: document.path, annotation });
  }
  const unannotated = images.find((image) => !files.has(image.path));
  if (unannotated) throw new Error(`${unannotated.path}: missing VOC XML annotation document; negative images require a zero-object XML document.`);
  const plan = buildVocDatasetPlan(inputs);
  return { ...plan, annotationPath: layout.annotations.slice(0, -1),
    images: plan.images.map((image) => ({ ...image, archivePath: image.path, file: files.get(image.path)! })) };
}
