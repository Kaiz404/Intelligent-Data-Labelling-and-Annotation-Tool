import type JSZip from "jszip";

function imageMimeType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return null;
}

function baseFileName(fileName: string) {
  return fileName.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** Extract JPEG and PNG entries from a ZIP for the existing browser upload queue. */
export async function extractZipImages(archive: File): Promise<File[]> {
  // Loaded on demand: only ZIP uploads need it.
  const { default: Zip } = await import("jszip");
  let zip: JSZip;

  try {
    zip = await Zip.loadAsync(archive);
  } catch {
    throw new Error(`Could not read ${archive.name} as a ZIP file.`);
  }

  try {
    const images = await Promise.all(
      Object.values(zip.files).map(async (entry) => {
        if (entry.dir) return null;

        const fileName = baseFileName(entry.name);
        const type = imageMimeType(fileName);
        if (!fileName || !type) return null;

        const blob = await entry.async("blob");
        return new File([blob], fileName, {
          type,
          lastModified: archive.lastModified,
        });
      }),
    );
    const acceptedImages = images.filter((image): image is File => image !== null);

    if (!acceptedImages.length) {
      throw new Error(`${archive.name} contains no JPG or PNG images.`);
    }

    return acceptedImages;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Could not extract images from ${archive.name}.`);
  }
}
