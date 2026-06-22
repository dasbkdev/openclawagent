/**
 * Zero-dependency text extraction from .xlsx (Excel). An .xlsx is a ZIP:
 * shared strings live in `xl/sharedStrings.xml`; each worksheet
 * (`xl/worksheets/sheet*.xml`) holds rows/cells that reference shared strings by
 * index (t="s") or carry inline/number values. We flatten every sheet to
 * tab-separated rows of plain text. Only node:* used (via docx-text's ZIP reader).
 */
import { readZipEntry, listZipEntries } from "./docx-text.js";

export function extractXlsxText(buffer, { maxRowsPerSheet = 200, maxCellsPerRow = 40 } = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const shared = parseSharedStrings(readZipEntry(buf, "xl/sharedStrings.xml"));
  const sheetNames = listZipEntries(buf)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(n))
    .sort();
  if (sheetNames.length === 0) {
    return "";
  }
  const out = [];
  let idx = 0;
  for (const name of sheetNames) {
    idx += 1;
    const xml = readZipEntry(buf, name);
    if (!xml) {
      continue;
    }
    const rows = parseSheet(xml.toString("utf8"), shared, { maxRowsPerSheet, maxCellsPerRow });
    if (rows.length === 0) {
      continue;
    }
    if (sheetNames.length > 1) {
      out.push(`# Лист ${idx}`);
    }
    out.push(rows.map((cells) => cells.join("\t")).join("\n"));
  }
  return out.join("\n\n").trim();
}

function parseSharedStrings(xmlBuf) {
  if (!xmlBuf) {
    return [];
  }
  const xml = xmlBuf.toString("utf8");
  const strings = [];
  // Each <si>…</si> is one shared string; it may contain several <t> runs.
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gu;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const runs = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gu;
    let t;
    while ((t = tRe.exec(m[1])) !== null) {
      runs.push(decodeXml(t[1]));
    }
    strings.push(runs.join(""));
  }
  return strings;
}

function parseSheet(xml, shared, { maxRowsPerSheet, maxCellsPerRow }) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gu;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null && rows.length < maxRowsPerSheet) {
    const cells = [];
    const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gu;
    let cm;
    while ((cm = cRe.exec(rm[1])) !== null && cells.length < maxCellsPerRow) {
      const attrs = cm[1] || cm[3] || "";
      const inner = cm[2] || "";
      const type = /\bt="([^"]+)"/u.exec(attrs)?.[1] || "";
      cells.push(cellValue(type, inner, shared));
    }
    // Trim trailing empty cells.
    while (cells.length && cells[cells.length - 1] === "") {
      cells.pop();
    }
    if (cells.some((c) => c !== "")) {
      rows.push(cells);
    }
  }
  return rows;
}

function cellValue(type, inner, shared) {
  if (type === "s") {
    const idx = Number(/<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(inner)?.[1] ?? "");
    return Number.isInteger(idx) && shared[idx] !== undefined ? shared[idx] : "";
  }
  if (type === "inlineStr") {
    const t = /<t\b[^>]*>([\s\S]*?)<\/t>/u.exec(inner)?.[1];
    return t !== undefined ? decodeXml(t) : "";
  }
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(inner)?.[1];
  return v !== undefined ? decodeXml(v) : "";
}

function decodeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCp(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeCp(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function safeCp(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
