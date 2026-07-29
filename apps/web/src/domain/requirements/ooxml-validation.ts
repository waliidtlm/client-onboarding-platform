import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ENTRIES = 512;
const MAX_CENTRAL_DIRECTORY_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

type OfficeKind = "docx" | "xlsx";

type ZipEntry = Readonly<{
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}>;

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

function isSafeEntryName(name: string): boolean {
  if (
    !name ||
    !/^[\x20-\x7e]+$/.test(name) ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name)
  ) {
    return false;
  }
  return name.split("/").every((segment) => segment !== "." && segment !== "..");
}

function parseEntries(buffer: Buffer): ZipEntry[] | null {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) return null;

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_ENTRIES ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
    eocdOffset + 22 + commentLength !== buffer.length ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    return null;
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let totalUncompressed = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
      return null;
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (
      nextOffset > eocdOffset ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      (flags & 0x0001) !== 0 ||
      ![0, 8].includes(method) ||
      uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES ||
      (uncompressedSize > 0 && compressedSize === 0) ||
      (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) ||
      (method === 0 && compressedSize !== uncompressedSize)
    ) {
      return null;
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!isSafeEntryName(name) || names.has(name)) return null;
    names.add(name);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) return null;
    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nextOffset;
  }
  return offset === eocdOffset ? entries : null;
}

function readEntry(buffer: Buffer, entry: ZipEntry, maxBytes: number): Buffer | null {
  if (
    entry.uncompressedSize > maxBytes ||
    entry.localHeaderOffset + 30 > buffer.length ||
    buffer.readUInt32LE(entry.localHeaderOffset) !== LOCAL_FILE_HEADER
  ) {
    return null;
  }
  const localFlags = buffer.readUInt16LE(entry.localHeaderOffset + 6);
  const localMethod = buffer.readUInt16LE(entry.localHeaderOffset + 8);
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (
    localFlags !== entry.flags ||
    localMethod !== entry.method ||
    dataEnd > buffer.length ||
    buffer
      .subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + nameLength)
      .toString("utf8") !== entry.name
  ) {
    return null;
  }
  try {
    const output =
      entry.method === 0
        ? Buffer.from(buffer.subarray(dataOffset, dataEnd))
        : inflateRawSync(buffer.subarray(dataOffset, dataEnd), { maxOutputLength: maxBytes });
    return output.length === entry.uncompressedSize ? output : null;
  } catch {
    return null;
  }
}

export function isValidOfficeOpenXml(buffer: Buffer, kind: OfficeKind): boolean {
  const entries = parseEntries(buffer);
  if (!entries) return false;
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const lowerNames = entries.map((entry) => entry.name.toLowerCase());
  if (
    lowerNames.some(
      (name) =>
        name.endsWith("/vbaproject.bin") ||
        name === "vbaproject.bin" ||
        name.endsWith(".docm") ||
        name.endsWith(".xlsm"),
    )
  ) {
    return false;
  }

  const required =
    kind === "docx"
      ? ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
      : ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
  if (
    required.some((name) => !byName.has(name)) ||
    (kind === "xlsx" &&
      !entries.some((entry) => /^xl\/worksheets\/sheet[^/]*\.xml$/i.test(entry.name)))
  ) {
    return false;
  }

  const contentTypesEntry = byName.get("[Content_Types].xml");
  if (!contentTypesEntry) return false;
  const contentTypesBytes = readEntry(buffer, contentTypesEntry, MAX_CONTENT_TYPES_BYTES);
  if (!contentTypesBytes) return false;
  const contentTypes = contentTypesBytes.toString("utf8").toLowerCase();
  if (
    contentTypes.includes("macroenabled") ||
    contentTypes.includes("application/vnd.ms-office.vbaproject") ||
    contentTypes.includes("<!doctype") ||
    contentTypes.includes("<!entity")
  ) {
    return false;
  }
  const canonicalMainType =
    kind === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  return contentTypes.includes(canonicalMainType);
}
