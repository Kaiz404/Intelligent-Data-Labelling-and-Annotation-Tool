/**
 * The file-name segment of an image's S3 key
 * (`projects/{projectId}/images/{uuid}/{name}`), or null when nothing usable
 * is left. Shared because the browser names its own keys for direct uploads.
 */
export function objectKeyFileName(fileName: string) {
  const name = fileName
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return name && name !== "." && name !== ".." ? name : null;
}
