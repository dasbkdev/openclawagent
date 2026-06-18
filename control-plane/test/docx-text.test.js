import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { extractDocxText, stripDocumentXml, readZipEntry } from "../src/domain/docx-text.js";
import { extractIncomingMedia, isExtractableText } from "../src/domain/media-actions.js";

// Build a minimal valid one-entry .docx (ZIP with word/document.xml, deflated).
function buildDocx(documentXml) {
  const name = Buffer.from("word/document.xml", "utf8");
  const data = Buffer.from(documentXml, "utf8");
  const comp = zlib.deflateRawSync(data);

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(8, 8); // deflate
  lfh.writeUInt32LE(comp.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  const localPart = Buffer.concat([lfh, name, comp]);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(8, 10); // deflate
  cdh.writeUInt32LE(comp.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28);
  cdh.writeUInt32LE(0, 42); // local header offset
  const cdPart = Buffer.concat([cdh, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, cdPart, eocd]);
}

test("extractDocxText reads text from a real (built) .docx with paragraphs/tabs/entities", () => {
  const xml =
    '<?xml version="1.0"?><w:document><w:body>' +
    "<w:p><w:r><w:t>Привет</w:t></w:r><w:tab/><w:r><w:t>мир</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Вторая строка &amp; &lt;тег&gt;</w:t></w:r></w:p>" +
    "</w:body></w:document>";
  const docx = buildDocx(xml);
  const text = extractDocxText(docx);
  assert.match(text, /Привет\tмир/);
  assert.match(text, /Вторая строка & <тег>/);
  assert.equal(readZipEntry(docx, "missing.xml"), null);
});

test("extractDocxText returns empty string on a non-docx buffer", () => {
  assert.equal(extractDocxText(Buffer.from("not a zip")), "");
});

test("stripDocumentXml preserves paragraph breaks and decodes entities", () => {
  const xml = "<w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B&amp;C</w:t></w:r></w:p>";
  assert.equal(stripDocumentXml(xml), "A\nB&C");
});

test("media classification: .docx and .txt are extractable text", () => {
  const docx = extractIncomingMedia({
    document: { file_id: "f1", file_name: "ТЗ.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  });
  assert.equal(docx.kind, "docx");
  assert.equal(isExtractableText(docx), true);

  const txt = extractIncomingMedia({ document: { file_id: "f2", file_name: "notes.txt", mime_type: "text/plain" } });
  assert.equal(txt.kind, "text");
  assert.equal(isExtractableText(txt), true);

  const pdf = extractIncomingMedia({ document: { file_id: "f3", file_name: "doc.pdf", mime_type: "application/pdf" } });
  assert.equal(pdf.kind, "pdf");
  assert.equal(isExtractableText(pdf), false);
});
