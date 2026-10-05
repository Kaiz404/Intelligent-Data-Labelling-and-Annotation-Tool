/** Browser-only signature and pixel validation shared by dataset ZIP readers. */
export async function decodeDatasetImage(file: File): Promise<{ width: number; height: number }> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((file.type === "image/png" && !png) || (file.type === "image/jpeg" && !jpeg) ||
      !["image/png", "image/jpeg"].includes(file.type)) {
    throw new Error(`${file.name}: file contents do not match its JPEG/PNG extension.`);
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("Dataset image validation requires a browser with createImageBitmap support.");
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "none" }); }
  catch { throw new Error(`${file.name}: could not decode the image.`); }
  try {
    if (![bitmap.width, bitmap.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error(`${file.name}: decoded image dimensions must be positive safe integers.`);
    }
    return { width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}
