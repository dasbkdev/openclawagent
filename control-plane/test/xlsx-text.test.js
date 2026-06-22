import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractXlsxText } from "../src/domain/xlsx-text.js";
import { extractIncomingMedia, isExtractableText } from "../src/domain/media-actions.js";

// Build a minimal valid .xlsx (zip with sharedStrings + one worksheet).
function buildXlsx() {
  const shared =
    '<?xml version="1.0"?><sst><si><t>Имя</t></si><si><t>Часы</t></si><si><t>Бегайым</t></si></sst>';
  const sheet =
    '<?xml version="1.0"?><worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>8</v></c></row>' +
    "</sheetData></worksheet>";
  return zipOf([
    ["xl/sharedStrings.xml", shared],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}

function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const comp = zlib.deflateRawSync(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([lfh, nameBuf, comp]);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(comp.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cdh, nameBuf]));
    locals.push(local);
    offset += local.length;
  }
  const localPart = Buffer.concat(locals);
  const cdPart = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
}

test("extractXlsxText flattens shared strings + numbers into tab-separated rows", () => {
  const text = extractXlsxText(buildXlsx());
  assert.match(text, /Имя\tЧасы/u);
  assert.match(text, /Бегайым\t8/u);
});

test("extractXlsxText returns empty on a non-xlsx buffer", () => {
  assert.equal(extractXlsxText(Buffer.from("nope")), "");
});

test("media classification: .xlsx is extractable text", () => {
  const m = extractIncomingMedia({
    document: { file_id: "f1", file_name: "табель.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  assert.equal(m.kind, "xlsx");
  assert.equal(isExtractableText(m), true);
});
