import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Work timeline: a complete, append-only chronology of everything that
 * happens around a user — dialogue, assistant answers, executed device
 * actions, agent task steps, task lifecycle changes (created/assigned/
 * completed) synced from Platrum/Bitrix, daily reports, activity summaries
 * and commitments.
 *
 * Stored as one JSONL file per user under `<data dir>/work-timeline/`.
 * This is the source of truth the assistant reads to build "what did X do
 * over the last month" reports, and the source the Obsidian vault exporter
 * mirrors into markdown.
 *
 * Append-only + per-user files keep writes cheap and reads scoped, and keep
 * the high-volume history OUT of control-plane.json (which is lock-guarded
 * and must stay small).
 */

export const TIMELINE_EVENT_KINDS = Object.freeze([
  "dialog_question",
  "dialog_answer",
  "device_action",
  "agent_task",
  "agent_task_step",
  "task_created",
  "task_assigned",
  "task_completed",
  "task_status_change",
  "report_submitted",
  "activity_summary",
  "commitment",
  "schedule",
  "note",
]);

export function workTimelineDir(dataFilePath) {
  return path.join(path.dirname(dataFilePath), "work-timeline");
}

function timelineFileForUser(dataFilePath, userId) {
  return path.join(workTimelineDir(dataFilePath), `${sanitizeUserId(userId)}.jsonl`);
}

/**
 * Append one timeline event for a user. Fail-safe: never throws, returns
 * the stored event (or null on failure) so callers can fire-and-forget.
 */
export async function appendTimelineEvent({ dataFilePath, userId, event }) {
  if (!dataFilePath || !userId || !event) {
    return null;
  }
  const stored = normalizeEvent(userId, event);
  try {
    await fs.mkdir(workTimelineDir(dataFilePath), { recursive: true });
    await fs.appendFile(
      timelineFileForUser(dataFilePath, userId),
      `${JSON.stringify(stored)}\n`,
      "utf8",
    );
    return stored;
  } catch (error) {
    console.error("appendTimelineEvent failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Append the same event to several users' timelines (e.g. a task assigned
 * by A to B appears in both chronologies). De-duplicates user ids.
 */
export async function appendTimelineEventForUsers({ dataFilePath, userIds, event }) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  const results = [];
  for (const userId of unique) {
    results.push(await appendTimelineEvent({ dataFilePath, userId, event }));
  }
  return results.filter(Boolean);
}

/**
 * Read a user's timeline, optionally filtered by [from, to] ISO range and
 * event kinds. Returns events oldest-first. Reads the whole per-user file
 * (history is append-only and scoped per person, so this stays bounded for
 * report windows; callers pass a period to limit the result).
 */
export async function readTimeline({ dataFilePath, userId, from = null, to = null, kinds = null, limit = 5000 }) {
  if (!dataFilePath || !userId) {
    return [];
  }
  const fromTs = from ? new Date(from).getTime() : null;
  const toTs = to ? new Date(to).getTime() : null;
  const kindSet = Array.isArray(kinds) && kinds.length > 0 ? new Set(kinds) : null;
  let content;
  try {
    content = await fs.readFile(timelineFileForUser(dataFilePath, userId), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    console.error("readTimeline failed:", error instanceof Error ? error.message : String(error));
    return [];
  }

  const events = [];
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
    const ts = new Date(event.ts).getTime();
    if (Number.isFinite(fromTs) && fromTs !== null && ts < fromTs) {
      continue;
    }
    if (Number.isFinite(toTs) && toTs !== null && ts > toTs) {
      continue;
    }
    if (kindSet && !kindSet.has(event.kind)) {
      continue;
    }
    events.push(event);
  }
  events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  if (events.length > limit) {
    return events.slice(events.length - limit);
  }
  return events;
}

/**
 * Compact aggregate of a timeline window for report building: counts by
 * kind, tasks created/assigned/completed, projects touched, collaborators.
 */
export function summarizeTimeline(events) {
  const byKind = {};
  const projectIds = new Set();
  const collaborators = new Set();
  const tasksCreated = [];
  const tasksCompleted = [];
  const tasksAssigned = [];
  const commitments = [];

  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1;
    for (const pid of event.links?.projectIds || []) {
      projectIds.add(pid);
    }
    for (const uid of event.links?.userIds || []) {
      collaborators.add(uid);
    }
    if (event.kind === "task_created") tasksCreated.push(event);
    if (event.kind === "task_completed") tasksCompleted.push(event);
    if (event.kind === "task_assigned") tasksAssigned.push(event);
    if (event.kind === "commitment") commitments.push(event);
  }

  return {
    total: events.length,
    byKind,
    projectIds: [...projectIds],
    collaborators: [...collaborators],
    tasksCreated,
    tasksAssigned,
    tasksCompleted,
    commitments,
    firstAt: events[0]?.ts || null,
    lastAt: events[events.length - 1]?.ts || null,
  };
}

export async function listTimelineUserIds({ dataFilePath }) {
  if (!dataFilePath) {
    return [];
  }
  try {
    const files = await fs.readdir(workTimelineDir(dataFilePath));
    return files.filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -".jsonl".length));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    return [];
  }
}

function normalizeEvent(userId, event) {
  const now = event.ts ? new Date(event.ts) : new Date();
  const ts = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  return {
    id: event.id || `tl-${ts}-${crypto.randomBytes(4).toString("hex")}`,
    ts,
    userId: String(userId),
    actorUserId: event.actorUserId ? String(event.actorUserId) : String(userId),
    kind: TIMELINE_EVENT_KINDS.includes(event.kind) ? event.kind : "note",
    title: truncate(event.title, 300),
    detail: truncate(event.detail, 4000),
    links: {
      projectIds: toIdArray(event.links?.projectIds),
      taskIds: toIdArray(event.links?.taskIds),
      userIds: toIdArray(event.links?.userIds),
    },
    source: event.source ? String(event.source).slice(0, 60) : "system",
    metadata: isPlainObject(event.metadata) ? event.metadata : {},
  };
}

function toIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((v) => String(v)).filter(Boolean))].slice(0, 50);
}

function truncate(value, max) {
  const str = value === null || value === undefined ? "" : String(value);
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeUserId(userId) {
  const normalized = String(userId || "unknown").replace(/[^a-zA-Z0-9._-]/gu, "_");
  return normalized || "unknown";
}
