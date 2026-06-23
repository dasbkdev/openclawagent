/**
 * Voice activity timeline ("голосовой табель"). Every voice message from a
 * linked employee is recorded as a structured entry: who, when it actually
 * arrived, the time stated in the voice, the kind (начало/конец/задание/заметка),
 * the activity, the full transcript. Start/end entries are paired into intervals
 * with a duration. Feeds a per-employee Excel report for the QC department (ОКК).
 *
 * Times are presented in Asia/Bishkek.
 */
import crypto from "node:crypto";
import { buildXlsxBuffer } from "./xlsx-write.js";
import { getUserById } from "./policy.js";

const TZ = "Asia/Bishkek";

export const VOICE_KINDS = Object.freeze(["начало", "конец", "задание", "заметка"]);
export const VOICE_KIND_LABEL = Object.freeze({
  начало: "начало",
  конец: "конец",
  задание: "задание",
  заметка: "заметка",
});

export function ensureVoiceTimelineState(state) {
  if (!Array.isArray(state.voiceTimeline)) {
    state.voiceTimeline = [];
  }
  return state.voiceTimeline;
}

/**
 * Record one voice entry. `extracted` = { statedTime, kind, activity,
 * relatedPerson, cleanedText }. Pairs a "конец" with the most recent open
 * matching "начало" (same activity/person, same user, same day).
 */
export function recordVoiceActivity(state, { userId, arrivalAt = new Date(), extracted = {}, transcript = "", rawTranscript = "" }) {
  ensureVoiceTimelineState(state);
  const arrival = arrivalAt instanceof Date ? arrivalAt : new Date(arrivalAt);
  const kind = VOICE_KINDS.includes(extracted.kind) ? extracted.kind : "заметка";
  const entry = {
    id: `voice-${crypto.randomUUID()}`,
    userId,
    arrivalAt: arrival.toISOString(),
    date: localDateKey(arrival),
    statedTime: normalizeStated(extracted.statedTime),
    kind,
    activity: String(extracted.activity || "").trim(),
    relatedPerson: String(extracted.relatedPerson || "").trim() || null,
    transcript: String(transcript || "").trim(),
    rawTranscript: String(rawTranscript || transcript || "").trim(),
    linkedStartId: null,
    durationMinutes: null,
  };

  if (kind === "конец") {
    const open = findOpenStart(state, entry);
    if (open) {
      entry.linkedStartId = open.id;
      const dur = minutesBetween(open.arrivalAt, entry.arrivalAt);
      entry.durationMinutes = dur;
      open.durationMinutes = dur; // annotate the start too
    }
  }

  state.voiceTimeline.push(entry);
  return entry;
}

function findOpenStart(state, endEntry) {
  // Most recent "начало" today by the same user, same activity/person, not yet closed.
  const closed = new Set(state.voiceTimeline.filter((e) => e.linkedStartId).map((e) => e.linkedStartId));
  const key = matchKey(endEntry.activity, endEntry.relatedPerson);
  const candidates = state.voiceTimeline
    .filter((e) =>
      e.userId === endEntry.userId &&
      e.kind === "начало" &&
      e.date === endEntry.date &&
      !closed.has(e.id) &&
      matchKey(e.activity, e.relatedPerson) === key,
    )
    .sort((a, b) => String(b.arrivalAt).localeCompare(String(a.arrivalAt)));
  if (candidates[0]) {
    return candidates[0];
  }
  // Looser fallback: any open "начало" today for this user (chronological last).
  return state.voiceTimeline
    .filter((e) => e.userId === endEntry.userId && e.kind === "начало" && e.date === endEntry.date && !closed.has(e.id))
    .sort((a, b) => String(b.arrivalAt).localeCompare(String(a.arrivalAt)))[0] || null;
}

function matchKey(activity, person) {
  return `${normalizeWords(activity)}|${normalizeWords(person)}`;
}

export function listVoiceActivity(state, { userIds = null, from = null, to = null } = {}) {
  ensureVoiceTimelineState(state);
  const ids = userIds ? new Set(userIds) : null;
  const fromT = from ? new Date(from).getTime() : null;
  const toT = to ? new Date(to).getTime() : null;
  return state.voiceTimeline
    .filter((e) => {
      if (ids && !ids.has(e.userId)) {
        return false;
      }
      const t = new Date(e.arrivalAt).getTime();
      if (fromT !== null && t < fromT) {
        return false;
      }
      if (toT !== null && t > toT) {
        return false;
      }
      return true;
    })
    .sort((a, b) => String(a.userId).localeCompare(String(b.userId)) || String(a.arrivalAt).localeCompare(String(b.arrivalAt)));
}

/** Build report rows (header + data) for the given entries. */
export function buildVoiceTimelineRows(state, entries) {
  const header = [
    "Сотрудник",
    "Дата",
    "Названное время",
    "Факт. время записи",
    "Тип",
    "Активность",
    "Длительность (мин)",
    "Связано с",
    "Полный текст",
  ];
  const rows = [header];
  for (const e of entries) {
    const user = getUserById(state, e.userId);
    rows.push([
      user?.displayName || e.userId,
      formatDate(e.arrivalAt),
      e.statedTime || "",
      formatTime(e.arrivalAt),
      VOICE_KIND_LABEL[e.kind] || e.kind,
      e.activity || "",
      typeof e.durationMinutes === "number" ? e.durationMinutes : "",
      e.relatedPerson || "",
      e.transcript || "",
    ]);
  }
  return rows;
}

/** Build the .xlsx report (one sheet with everyone). Returns a Buffer. */
export function buildVoiceTimelineXlsx(state, { userIds = null, from = null, to = null, sheetName = "Голосовой табель" } = {}) {
  const entries = listVoiceActivity(state, { userIds, from, to });
  const rows = buildVoiceTimelineRows(state, entries);
  return buildXlsxBuffer({ sheets: [{ name: sheetName, rows }] });
}

// --- time helpers (Asia/Bishkek) ---------------------------------------------

export function localDateKey(date, tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatDate(iso, tz = TZ) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

function formatTime(iso, tz = TZ) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function minutesBetween(aIso, bIso) {
  return Math.max(0, Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000));
}

function normalizeStated(value) {
  const m = /(\d{1,2})[:.\s]?(\d{2})/u.exec(String(value || ""));
  if (!m) {
    return null;
  }
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function normalizeWords(s) {
  return String(s || "").toLowerCase().replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
