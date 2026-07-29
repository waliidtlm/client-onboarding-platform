import { describe, expect, it } from "vitest";

import { isValidOfficeOpenXml } from "@/domain/requirements/ooxml-validation";

function storedZip(entries: ReadonlyArray<readonly [string, string]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, nameBytes);
    localOffset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

const docxContentTypes =
  '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const xlsxContentTypes =
  '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';

function validDocx(extra: ReadonlyArray<readonly [string, string]> = []): Buffer {
  return storedZip([
    ["[Content_Types].xml", docxContentTypes],
    ["_rels/.rels", "<Relationships/>"],
    ["word/document.xml", "<document/>"],
    ...extra,
  ]);
}

function validXlsx(): Buffer {
  return storedZip([
    ["[Content_Types].xml", xlsxContentTypes],
    ["_rels/.rels", "<Relationships/>"],
    ["xl/workbook.xml", "<workbook/>"],
    ["xl/_rels/workbook.xml.rels", "<Relationships/>"],
    ["xl/worksheets/sheet1.xml", "<worksheet/>"],
  ]);
}

describe("OOXML validation", () => {
  it("accepts bounded canonical DOCX and XLSX structures", () => {
    expect(isValidOfficeOpenXml(validDocx(), "docx")).toBe(true);
    expect(isValidOfficeOpenXml(validXlsx(), "xlsx")).toBe(true);
  });

  it("rejects malformed, traversing, macro-enabled, and wrong-kind containers", () => {
    expect(isValidOfficeOpenXml(Buffer.from("not a zip"), "docx")).toBe(false);
    expect(isValidOfficeOpenXml(validDocx([["../payload", "x"]]), "docx")).toBe(false);
    expect(isValidOfficeOpenXml(validDocx([["word/vbaProject.bin", "macro"]]), "docx")).toBe(false);
    expect(isValidOfficeOpenXml(validDocx(), "xlsx")).toBe(false);
  });

  it("rejects excessive compression ratios before decompression", () => {
    const archive = validDocx();
    const centralOffset = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE(1, centralOffset + 20);
    archive.writeUInt32LE(1_000, centralOffset + 24);
    expect(isValidOfficeOpenXml(archive, "docx")).toBe(false);
  });

  it("rejects archives above the bounded entry count", () => {
    const entries = Array.from(
      { length: 513 },
      (_, index) => [`part-${index}.xml`, "<part/>"] as const,
    );
    expect(isValidOfficeOpenXml(storedZip(entries), "docx")).toBe(false);
  });
});
