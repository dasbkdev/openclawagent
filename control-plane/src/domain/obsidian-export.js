import fs from "node:fs/promises";
import path from "node:path";
import {
  readTimeline,
  summarizeTimeline,
  listTimelineUserIds,
} from "./work-timeline.js";

/**
 * Obsidian vault exporter.
 *
 * Mirrors the append-only work timeline (src/domain/work-timeline.js) plus the
 * company state (users/projects from control-plane.json) into a folder of
 * Obsidian-compatible markdown notes with `[[wiki-links]]`. The resulting vault
 * is meant to be published as a web showcase (Quartz) and gives a navigable
 * knowledge graph: People ↔ Projects ↔ Daily notes.
 *
 * The exporter is read-only against the timeline and state; it only writes
 * inside `vaultDir`, which it rebuilds from scratch on every run (idempotent).
 */

// Obsidian / filesystem reserved characters that cannot appear in a note name.
// Replacing them consistently in BOTH the file name and the `[[link]]` keeps the
// graph connected (a link resolves to a file only if the names match exactly).
const RESERVED_CHARS_RE = /[/\\:*?"<>|#^[\]]/gu;

// Per-section caps so the vault stays bounded even with huge timelines.
const PERSON_FEED_LIMIT = 100;
const PROJECT_FEED_LIMIT = 200;
const TIMELINE_READ_LIMIT = 5000;

const KIND_LABELS = Object.freeze({
  dialog_question: "❓ Вопрос",
  dialog_answer: "💬 Ответ",
  device_action: "🖥️ Действие",
  agent_task: "🤖 Задача агента",
  agent_task_step: "⚙️ Шаг агента",
  task_created: "📌 Задача создана",
  task_assigned: "📥 Задача назначена",
  task_completed: "✅ Задача завершена",
  task_status_change: "🔄 Статус задачи",
  report_submitted: "📝 Отчёт",
  activity_summary: "📊 Сводка активности",
  commitment: "🤝 Обязательство",
  schedule: "📅 График",
  note: "🗒️ Заметка",
});

function kindLabel(kind) {
  return KIND_LABELS[kind] || `• ${kind}`;
}

/**
 * Make a name safe to use both as an Obsidian file stem and as the target of a
 * `[[wiki-link]]`. Reserved characters are collapsed to spaces, whitespace is
 * normalised and the result is trimmed. Always returns a non-empty string.
 */
export function safeNoteName(name) {
  const raw = name === null || name === undefined ? "" : String(name);
  const cleaned = raw
    .replace(RESERVED_CHARS_RE, " ")
    // Obsidian also dislikes leading dots and trailing dots/spaces in names.
    .replace(/\s+/gu, " ")
    .replace(/^\.+/u, " ")
    .trim()
    .replace(/\.+$/u, "")
    .trim();
  return cleaned || "Untitled";
}

/** A `[[wiki-link]]` whose target matches the note file produced for `name`. */
function wikiLink(name) {
  return `[[${safeNoteName(name)}]]`;
}

/** Collapse newlines and trim a free-text field to keep markdown lines intact. */
function inlineText(value, max = 160) {
  const str = value === null || value === undefined ? "" : String(value);
  const oneLine = str.replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Quote a value for a YAML frontmatter scalar (always double-quoted). */
function yamlString(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/[\r\n]+/gu, " ")}"`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Parse an event ts into stable date / time / minute-key parts (UTC). */
function eventTimeParts(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) {
    return { day: "unknown", time: "00:00", stamp: "0000-00-00 00:00" };
  }
  const day = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return { day, time, stamp: `${day} ${time}` };
}

function buildLookups(state) {
  const usersById = new Map();
  const projectsById = new Map();
  for (const user of state?.users || []) {
    if (user && user.id) {
      usersById.set(String(user.id), user);
    }
  }
  for (const project of state?.projects || []) {
    if (project && project.id) {
      projectsById.set(String(project.id), project);
    }
  }
  return { usersById, projectsById };
}

function userDisplayName(usersById, userId) {
  const user = usersById.get(String(userId));
  return user ? user.displayName || user.id : String(userId);
}

function projectName(projectsById, projectId) {
  const project = projectsById.get(String(projectId));
  return project ? project.name || project.id : String(projectId);
}

/** Render the `[[links]]` for an event's project + user references. */
function eventRefLinks(event, usersById, projectsById, { includeUsers = true } = {}) {
  const links = [];
  for (const pid of event.links?.projectIds || []) {
    links.push(wikiLink(projectName(projectsById, pid)));
  }
  if (includeUsers) {
    for (const uid of event.links?.userIds || []) {
      links.push(wikiLink(userDisplayName(usersById, uid)));
    }
  }
  return links;
}

/**
 * Read every user's timeline once, fail-safe per user. Returns:
 *  - perUser: Map<userId, events[]> (oldest-first, as read)
 *  - allEvents: flat array of { ...event, ownerUserId } across everyone
 */
async function loadAllTimelines(dataFilePath, knownUserIds) {
  const timelineUserIds = await listTimelineUserIds({ dataFilePath });
  const userIds = [...new Set([...(knownUserIds || []), ...timelineUserIds])];
  const perUser = new Map();
  const allEvents = [];
  for (const userId of userIds) {
    let events = [];
    try {
      events = await readTimeline({ dataFilePath, userId, limit: TIMELINE_READ_LIMIT });
    } catch (error) {
      // Fail-safe: a single unreadable timeline must not abort the export.
      console.error(
        `obsidian-export: failed to read timeline for ${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
      events = [];
    }
    perUser.set(userId, events);
    for (const event of events) {
      allEvents.push({ event, ownerUserId: userId });
    }
  }
  return { perUser, allEvents };
}

function personMarkdown(user, events, { usersById, projectsById }) {
  const name = safeNoteName(user.displayName || user.id);
  const summary = summarizeTimeline(events);
  const lines = [];

  lines.push("---");
  lines.push(`title: ${yamlString(user.displayName || user.id)}`);
  lines.push(`role: ${yamlString(user.role || "")}`);
  lines.push(`userId: ${yamlString(user.id)}`);
  lines.push("tags: [person]");
  lines.push("---");
  lines.push("");
  lines.push(`# ${name}`);
  lines.push("");

  // Профиль
  lines.push("## Профиль");
  lines.push("");
  lines.push(`- Роль: ${inlineText(user.role || "—")}`);
  if (user.managerId && usersById.has(String(user.managerId))) {
    lines.push(`- Менеджер: ${wikiLink(userDisplayName(usersById, user.managerId))}`);
  }
  const reports = [...usersById.values()].filter(
    (u) => String(u.managerId || "") === String(user.id),
  );
  if (reports.length > 0) {
    lines.push(
      `- Подчинённые: ${reports.map((u) => wikiLink(u.displayName || u.id)).join(", ")}`,
    );
  }
  lines.push("");

  // Сводка хронологии
  lines.push("## Сводка хронологии");
  lines.push("");
  lines.push(`- Всего событий: ${summary.total}`);
  const byKindEntries = Object.entries(summary.byKind).sort((a, b) => b[1] - a[1]);
  if (byKindEntries.length > 0) {
    lines.push(
      `- По типам: ${byKindEntries.map(([k, n]) => `${kindLabel(k)} — ${n}`).join("; ")}`,
    );
  }
  if (summary.projectIds.length > 0) {
    lines.push(
      `- Проекты: ${summary.projectIds.map((pid) => wikiLink(projectName(projectsById, pid))).join(", ")}`,
    );
  }
  const collaborators = summary.collaborators.filter((uid) => String(uid) !== String(user.id));
  if (collaborators.length > 0) {
    lines.push(
      `- Коллабораторы: ${collaborators.map((uid) => wikiLink(userDisplayName(usersById, uid))).join(", ")}`,
    );
  }
  lines.push(`- Задач создано: ${summary.tasksCreated.length}`);
  lines.push(`- Задач назначено: ${summary.tasksAssigned.length}`);
  lines.push(`- Задач завершено: ${summary.tasksCompleted.length}`);
  if (summary.firstAt && summary.lastAt) {
    lines.push(`- Период: ${eventTimeParts(summary.firstAt).day} → ${eventTimeParts(summary.lastAt).day}`);
  }
  lines.push("");

  // Лента (newest-first, capped)
  lines.push("## Лента");
  lines.push("");
  const feed = [...events].reverse().slice(0, PERSON_FEED_LIMIT);
  if (feed.length === 0) {
    lines.push("_Нет событий._");
  } else {
    for (const event of feed) {
      const { stamp } = eventTimeParts(event.ts);
      const refs = eventRefLinks(event, usersById, projectsById);
      let title = inlineText(event.title);
      if (!title && (event.kind === "dialog_question" || event.kind === "dialog_answer")) {
        title = inlineText(event.detail, 120);
      }
      const refSuffix = refs.length > 0 ? ` ${refs.join(" ")}` : "";
      lines.push(`- ${stamp} — ${kindLabel(event.kind)}: ${title || "—"}${refSuffix}`);
    }
  }
  lines.push("");

  // Дни
  const days = [...new Set(events.map((e) => eventTimeParts(e.ts).day).filter((d) => d !== "unknown"))].sort();
  if (days.length > 0) {
    lines.push("## Дни");
    lines.push("");
    lines.push(days.map((d) => wikiLink(d)).join(" "));
    lines.push("");
  }

  return { fileName: `${name}.md`, content: lines.join("\n") };
}

function projectMarkdown(project, projectEvents, { usersById, projectsById }) {
  const name = safeNoteName(project.name || project.id);
  const lines = [];

  lines.push("---");
  lines.push(`title: ${yamlString(project.name || project.id)}`);
  lines.push(`projectId: ${yamlString(project.id)}`);
  lines.push("tags: [project]");
  lines.push("---");
  lines.push("");
  lines.push(`# ${name}`);
  lines.push("");

  // Участники
  const memberIds = new Set();
  for (const uid of project.memberUserIds || []) {
    memberIds.add(String(uid));
  }
  if (project.ownerUserId) {
    memberIds.add(String(project.ownerUserId));
  }
  if (project.managerUserId) {
    memberIds.add(String(project.managerUserId));
  }
  lines.push("## Участники");
  lines.push("");
  if (project.ownerUserId) {
    lines.push(`- Владелец: ${wikiLink(userDisplayName(usersById, project.ownerUserId))}`);
  }
  if (project.managerUserId) {
    lines.push(`- Менеджер: ${wikiLink(userDisplayName(usersById, project.managerUserId))}`);
  }
  const otherMembers = [...memberIds].filter(
    (uid) => uid !== String(project.ownerUserId) && uid !== String(project.managerUserId),
  );
  if (otherMembers.length > 0) {
    lines.push(`- Команда: ${otherMembers.map((uid) => wikiLink(userDisplayName(usersById, uid))).join(", ")}`);
  }
  lines.push("");

  // События проекта (newest-first, capped)
  lines.push("## События");
  lines.push("");
  const feed = [...projectEvents]
    .sort((a, b) => String(b.event.ts).localeCompare(String(a.event.ts)))
    .slice(0, PROJECT_FEED_LIMIT);
  if (feed.length === 0) {
    lines.push("_Нет событий._");
  } else {
    for (const { event, ownerUserId } of feed) {
      const { stamp } = eventTimeParts(event.ts);
      const who = wikiLink(userDisplayName(usersById, ownerUserId));
      // Other-people refs only (the project itself is implicit here).
      const userRefs = eventRefLinks(event, usersById, projectsById, { includeUsers: true })
        .filter((l) => l !== wikiLink(projectName(projectsById, project.id)));
      const refSuffix = userRefs.length > 0 ? ` ${userRefs.join(" ")}` : "";
      lines.push(`- ${stamp} ${who} — ${kindLabel(event.kind)}: ${inlineText(event.title) || "—"}${refSuffix}`);
    }
  }
  lines.push("");

  return { fileName: `${name}.md`, content: lines.join("\n") };
}

function dailyMarkdown(day, dayEvents, { usersById, projectsById }) {
  const lines = [];
  lines.push("---");
  lines.push(`title: ${yamlString(day)}`);
  lines.push("tags: [daily]");
  lines.push("---");
  lines.push("");
  lines.push(`# ${day}`);
  lines.push("");

  const sorted = [...dayEvents].sort((a, b) => String(a.event.ts).localeCompare(String(b.event.ts)));
  for (const { event, ownerUserId } of sorted) {
    const { time } = eventTimeParts(event.ts);
    const who = wikiLink(userDisplayName(usersById, ownerUserId));
    const projectRefs = (event.links?.projectIds || []).map((pid) =>
      wikiLink(projectName(projectsById, pid)),
    );
    const refSuffix = projectRefs.length > 0 ? ` (${projectRefs.join(" ")})` : "";
    lines.push(`- ${time} ${who} — ${kindLabel(event.kind)}: ${inlineText(event.title) || "—"}${refSuffix}`);
  }
  lines.push("");

  return { fileName: `${day}.md`, content: lines.join("\n") };
}

function homeMarkdown(state, { peopleNames, projectNames, totalEvents, firstAt, lastAt }) {
  const lines = [];
  lines.push("---");
  lines.push("title: Home");
  lines.push("tags: [index]");
  lines.push("---");
  lines.push("");
  lines.push("# Starlab Agent — Vault");
  lines.push("");
  lines.push("## Статистика");
  lines.push("");
  lines.push(`- Людей: ${peopleNames.length}`);
  lines.push(`- Проектов: ${projectNames.length}`);
  lines.push(`- Событий всего: ${totalEvents}`);
  if (firstAt && lastAt) {
    lines.push(`- Период: ${eventTimeParts(firstAt).day} → ${eventTimeParts(lastAt).day}`);
  }
  lines.push("");
  lines.push("## Люди");
  lines.push("");
  if (peopleNames.length === 0) {
    lines.push("_Нет._");
  } else {
    for (const n of peopleNames) {
      lines.push(`- ${wikiLink(n)}`);
    }
  }
  lines.push("");
  lines.push("## Проекты");
  lines.push("");
  if (projectNames.length === 0) {
    lines.push("_Нет._");
  } else {
    for (const n of projectNames) {
      lines.push(`- ${wikiLink(n)}`);
    }
  }
  lines.push("");
  return { fileName: "Home.md", content: lines.join("\n") };
}

/**
 * Remove all contents of `vaultDir` without deleting the directory itself.
 * Only touches paths inside vaultDir.
 */
async function cleanVaultDir(vaultDir) {
  let entries;
  try {
    entries = await fs.readdir(vaultDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    await fs.rm(path.join(vaultDir, entry.name), { recursive: true, force: true });
  }
}

async function writeNote(dir, note) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, note.fileName);
  await fs.writeFile(filePath, note.content, "utf8");
  return filePath;
}

/**
 * Export an Obsidian-compatible vault mirroring company state + work timeline.
 *
 * @param {object} args
 * @param {object} args.state         control-plane state ({ users, projects }).
 * @param {string} args.dataFilePath  path to control-plane.json (timeline lives alongside).
 * @param {string} args.vaultDir      absolute, non-empty target directory (rebuilt each run).
 * @param {Date}   [args.now]         reserved for future use (current time).
 * @returns {Promise<{ filesWritten: number, vaultDir: string }>}
 */
export async function exportObsidianVault({ state, dataFilePath, vaultDir, now = new Date() }) {
  void now;
  if (typeof vaultDir !== "string" || vaultDir.trim() === "") {
    throw new Error("exportObsidianVault: vaultDir must be a non-empty string");
  }
  if (!path.isAbsolute(vaultDir)) {
    throw new Error(`exportObsidianVault: vaultDir must be an absolute path (got "${vaultDir}")`);
  }
  if (!dataFilePath) {
    throw new Error("exportObsidianVault: dataFilePath is required");
  }
  const safeState = state && typeof state === "object" ? state : {};
  const { usersById, projectsById } = buildLookups(safeState);
  const lookups = { usersById, projectsById };

  // Rebuild the vault from scratch for idempotency.
  await fs.mkdir(vaultDir, { recursive: true });
  await cleanVaultDir(vaultDir);

  const knownUserIds = [...usersById.keys()];
  const { perUser, allEvents } = await loadAllTimelines(dataFilePath, knownUserIds);

  let filesWritten = 0;

  // 1. People
  const peopleDir = path.join(vaultDir, "People");
  const peopleNames = [];
  for (const user of safeState.users || []) {
    if (!user || !user.id) {
      continue;
    }
    const events = perUser.get(String(user.id)) || [];
    const note = personMarkdown(user, events, lookups);
    await writeNote(peopleDir, note);
    peopleNames.push(safeNoteName(user.displayName || user.id));
    filesWritten += 1;
  }

  // 2. Projects — gather events whose links.projectIds reference the project.
  const eventsByProject = new Map();
  for (const item of allEvents) {
    for (const pid of item.event.links?.projectIds || []) {
      const key = String(pid);
      if (!eventsByProject.has(key)) {
        eventsByProject.set(key, []);
      }
      eventsByProject.get(key).push(item);
    }
  }
  const projectsDir = path.join(vaultDir, "Projects");
  const projectNames = [];
  for (const project of safeState.projects || []) {
    if (!project || !project.id) {
      continue;
    }
    const projectEvents = eventsByProject.get(String(project.id)) || [];
    const note = projectMarkdown(project, projectEvents, lookups);
    await writeNote(projectsDir, note);
    projectNames.push(safeNoteName(project.name || project.id));
    filesWritten += 1;
  }

  // 3. Daily — group all events by UTC day.
  const eventsByDay = new Map();
  for (const item of allEvents) {
    const { day } = eventTimeParts(item.event.ts);
    if (day === "unknown") {
      continue;
    }
    if (!eventsByDay.has(day)) {
      eventsByDay.set(day, []);
    }
    eventsByDay.get(day).push(item);
  }
  const dailyDir = path.join(vaultDir, "Daily");
  for (const [day, dayEvents] of [...eventsByDay.entries()].sort()) {
    const note = dailyMarkdown(day, dayEvents, lookups);
    await writeNote(dailyDir, note);
    filesWritten += 1;
  }

  // 4. Home index
  const stamps = allEvents.map((i) => i.event.ts).filter(Boolean).sort();
  const home = homeMarkdown(safeState, {
    peopleNames,
    projectNames,
    totalEvents: allEvents.length,
    firstAt: stamps[0] || null,
    lastAt: stamps[stamps.length - 1] || null,
  });
  await writeNote(vaultDir, home);
  filesWritten += 1;

  return { filesWritten, vaultDir };
}
