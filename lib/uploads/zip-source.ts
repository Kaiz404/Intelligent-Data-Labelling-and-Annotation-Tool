import type { UploadEntry, UploadSource } from "@/lib/uploads/types";

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT_SIZE = 0xffff;
const ZIP64_EXTRA_ID = 0x0001;
const STORED = 0;
const DEFLATED = 8;

class ZipFormatError extends Error {}

async function readView(archive: Blob, start: number, end: number) {
  if (start < 0 || end > archive.size || start > end) {
    throw new ZipFormatError("Entry points outside the archive.");
  }
  return new DataView(await archive.slice(start, end).arrayBuffer());
}

function imageMimeType(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  return null;
}

function baseFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function readUint64(view: DataView, offset: number) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipFormatError("Archive offsets are too large.");
  }
  return Number(value);
}

/** Locates the central directory, reading only the archive's tail. */
async function readCentralDirectoryBounds(archive: File) {
  const tailStart = Math.max(0, archive.size - EOCD_SIZE - MAX_COMMENT_SIZE);
  const tail = await readView(archive, tailStart, archive.size);
  let eocd = -1;
  for (let offset = tail.byteLength - EOCD_SIZE; offset >= 0; offset -= 1) {
    if (tail.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("No end of central directory record.");

  let entryCount = tail.getUint16(eocd + 10, true);
  let size = tail.getUint32(eocd + 12, true);
  let offset = tail.getUint32(eocd + 16, true);

  const locator = eocd - 20;
  if (locator >= 0 && tail.getUint32(locator, true) === ZIP64_EOCD_LOCATOR_SIGNATURE) {
    const recordOffset = readUint64(tail, locator + 8);
    const record = await readView(archive, recordOffset, recordOffset + 56);
    if (record.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
      throw new ZipFormatError("Broken ZIP64 end of central directory record.");
    }
    entryCount = readUint64(record, 32);
    size = readUint64(record, 40);
    offset = readUint64(record, 48);
  }

  return { entryCount, start: offset, end: offset + size };
}

/**
 * Lists the JPEG and PNG entries of a ZIP without reading their bytes. Each
 * entry's source is opened by `openUploadSource` only when it uploads, so an
 * archive larger than the browser can hold in memory still works.
 */
export async function listZipImages(archive: File): Promise<UploadEntry[]> {
  let directory: DataView;
  let entryCount: number;
  try {
    const bounds = await readCentralDirectoryBounds(archive);
    entryCount = bounds.entryCount;
    directory = await readView(archive, bounds.start, bounds.end);
  } catch {
    throw new Error(`Could not read ${archive.name} as a ZIP file.`);
  }

  const decoder = new TextDecoder();
  const entries: UploadEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > directory.byteLength ||
      directory.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE
    ) {
      throw new Error(`${archive.name} has a damaged file list.`);
    }
    const flags = directory.getUint16(cursor + 8, true);
    const method = directory.getUint16(cursor + 10, true);
    let compressedSize = directory.getUint32(cursor + 20, true);
    let uncompressedSize = directory.getUint32(cursor + 24, true);
    const nameLength = directory.getUint16(cursor + 28, true);
    const extraLength = directory.getUint16(cursor + 30, true);
    const commentLength = directory.getUint16(cursor + 32, true);
    let localHeaderOffset = directory.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const extraStart = nameStart + nameLength;
    cursor = extraStart + extraLength + commentLength;
    if (cursor > directory.byteLength) {
      throw new Error(`${archive.name} has a damaged file list.`);
    }

    // ZIP64 stores each saturated field, in this order, in its extra block.
    for (let extra = extraStart; extra + 4 <= extraStart + extraLength; ) {
      const id = directory.getUint16(extra, true);
      const length = directory.getUint16(extra + 2, true);
      if (id === ZIP64_EXTRA_ID) {
        let field = extra + 4;
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = readUint64(directory, field);
          field += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = readUint64(directory, field);
          field += 8;
        }
        if (localHeaderOffset === 0xffffffff) {
          localHeaderOffset = readUint64(directory, field);
        }
      }
      extra += 4 + length;
    }

    const encrypted = (flags & 0x1) !== 0;
    if (encrypted || (method !== STORED && method !== DEFLATED)) continue;

    const path = decoder.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + nameStart, nameLength),
    );
    if (path.endsWith("/")) continue;
    const fileName = baseFileName(path);
    const mimeType = imageMimeType(fileName);
    if (!fileName || !mimeType || uncompressedSize === 0) continue;

    entries.push({
      fileName,
      mimeType,
      sizeBytes: uncompressedSize,
      source: {
        kind: "zip",
        archive,
        localHeaderOffset,
        compressedSize,
        uncompressedSize,
        compressed: method === DEFLATED,
      },
    });
  }

  if (!entries.length) {
    throw new Error(`${archive.name} contains no JPG or PNG images.`);
  }
  return entries;
}

/** Stops a decompression that outgrows the size the archive declared. */
function limitBytes(limit: number) {
  let total = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > limit) {
        controller.error(new ZipFormatError("Entry is larger than declared."));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/** The bytes to upload: the file itself, or one ZIP entry read on demand. */
export async function openUploadSource(source: UploadSource): Promise<Blob> {
  if (source.kind === "file") return source.file;

  const { archive, localHeaderOffset, compressedSize, uncompressedSize } = source;
  const header = await readView(archive, localHeaderOffset, localHeaderOffset + 30);
  if (header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipFormatError(`${archive.name} has a damaged entry.`);
  }
  const dataStart =
    localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (dataStart + compressedSize > archive.size) {
    throw new ZipFormatError(`${archive.name} has a damaged entry.`);
  }
  const data = archive.slice(dataStart, dataStart + compressedSize);
  if (!source.compressed) return data;

  const inflated = await new Response(
    data
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
      .pipeThrough(limitBytes(uncompressedSize)),
  ).blob();
  if (inflated.size !== uncompressedSize) {
    throw new ZipFormatError(`${archive.name} has a damaged entry.`);
  }
  return inflated;
}
