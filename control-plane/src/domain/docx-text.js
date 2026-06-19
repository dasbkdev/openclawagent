/**
 * Zero-dependency text extraction from .docx (Word) files.
 *
 * A .docx is a ZIP archive; the body text lives in `word/document.xml`. We read
 * that one entry straight from the ZIP central directory (node:zlib for the
 * DEFLATE), then strip the WordprocessingML tags to plain text. No external
 * libraries — only node:* per the project's zero-dependency rule.
 */
import zlib from "node:zlib";

const EOCD_SIG = 0x06054b50; // End Of Central Directory
const CDH_SIG = 0x02014b50; // Central Directory Header
const LFH_SIG = 0x04034b50; // Local File Header

/** Extract plain text from a .docx Buffer. Returns "" if it can't be read. */
export function extractDocxText(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const xml = readZipEntry(buf, "word/document.xml");
  if (!xml) {
    return "";
  }
  return stripDocumentXml(xml.toString("utf8"));
}

/** Read a single entry from a ZIP buffer by name. Returns a Buffer or null. */
export function readZipEntry(buf, entryName) {
  const eocd = findEocd(buf);
  if (eocd < 0) {
    return null;
  }
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);

  let p = cdOffset;
  for (let i = 0; i < cdCount; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) {
      break;
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    if (name === entryName) {
      return readLocalEntry(buf, localOffset, method, compSize);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function readLocalEntry(buf, localOffset, method, compSize) {
  if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LFH_SIG) {
    return null;
  }
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  try {
    if (method === 0) {
      return Buffer.from(data); // stored
    }
    if (method === 8) {
      return zlib.inflateRawSync(data); // deflate
    }
  } catch {
    return null;
  }
  return null;
}

function findEocd(buf) {
  // EOCD is near the end; scan backwards (comment is usually empty).
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

/** WordprocessingML XML -> plain text, preserving paragraph/line/tab breaks. */
export function stripDocumentXml(xml) {
  let s = String(xml || "");
  s = s.replace(/<w:tab\b[^>]*\/?>/g, "\t");
  s = s.replace(/<w:br\b[^>]*\/?>/g, "\n");
  // Tables: a cell ends with a tab separator, a row with a newline. Done before
  // the paragraph rule so cell paragraphs don't each become their own line.
  s = s.replace(/<\/w:p>\s*(?=<\/w:tc>)/g, " "); // paragraphs inside a cell -> space
  s = s.replace(/<\/w:tc>/g, "\t"); // end of table cell
  s = s.replace(/<\/w:tr>/g, "\n"); // end of table row
  s = s.replace(/<\/w:p>/g, "\n"); // end of paragraph
  s = s.replace(/<[^>]+>/g, ""); // strip all remaining tags
  s = decodeXmlEntities(s);
  s = s.replace(/\r/g, "");
  s = s.replace(/\t+\n/g, "\n"); // trailing cell tab before row break
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&"); // last, so &amp;lt; -> &lt;
}

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
