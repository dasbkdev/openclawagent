import fs from "node:fs/promises";
import path from "node:path";

const MAX_TAIL_BYTES = 512 * 1024;
const DEFAULT_SEARCH_LIMIT = 10;

export function memoryArchiveDir(dataFilePath) {
  return path.join(path.dirname(dataFilePath), "memory-archive");
}

function archiveFileForUser(dataFilePath, userId) {
  const safeUserId = sanitizeUserId(userId);
  return path.join(memoryArchiveDir(dataFilePath), `${safeUserId}.jsonl`);
}

export async function appendMemoryArchive({ dataFilePath, userId, events }) {
  if (!dataFilePath || !Array.isArray(events) || events.length === 0) {
    return { appended: 0 };
  }
  try {
    const dir = memoryArchiveDir(dataFilePath);
    await fs.mkdir(dir, { recursive: true });
    const filePath = archiveFileForUser(dataFilePath, userId);
    const lines = events.map((event) => JSON.stringify(event)).join("\n");
    await fs.appendFile(filePath, `${lines}\n`, "utf8");
    return { appended: events.length };
  } catch (error) {
    console.error(
      "appendMemoryArchive failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { appended: 0 };
  }
}

export async function searchMemoryArchive({ dataFilePath, userId, terms, limit = DEFAULT_SEARCH_LIMIT }) {
  const normalizedTerms = normalizeTerms(terms);
  if (!dataFilePath || normalizedTerms.length === 0) {
    return [];
  }
  try {
    const filePath = archiveFileForUser(dataFilePath, userId);
    const content = await readTail(filePath, MAX_TAIL_BYTES);
    if (!content) {
      return [];
    }
    const scored = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const haystack = normalizeText(`${event.text || ""} ${event.kind || ""}`);
      let score = 0;
      for (const term of normalizedTerms) {
        if (haystack.includes(term)) {
          score += 1;
        }
      }
      if (score > 0) {
        scored.push({ score, event });
      }
    }
    return scored
      .sort((a, b) => b.score - a.score || String(b.event.createdAt).localeCompare(String(a.event.createdAt)))
      .slice(0, Math.min(Math.max(Number(limit || DEFAULT_SEARCH_LIMIT), 1), 50))
      .map((item) => ({ ...item.event, source: "archive" }));
  } catch (error) {
    console.error(
      "searchMemoryArchive failed:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

async function readTail(filePath, maxBytes) {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const stat = await handle.stat();
    const size = stat.size;
    if (size === 0) {
      return "";
    }
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      // Drop a possibly partial first line.
      const newlineIndex = text.indexOf("\n");
      text = newlineIndex === -1 ? "" : text.slice(newlineIndex + 1);
    }
    return text;
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

function sanitizeUserId(userId) {
  const normalized = String(userId || "unknown").replace(/[^a-zA-Z0-9._-]/gu, "_");
  return normalized || "unknown";
}

function normalizeTerms(terms) {
  const list = Array.isArray(terms) ? terms : [terms];
  return [...new Set(list.map(normalizeText).filter((term) => term.length > 0))];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
}
