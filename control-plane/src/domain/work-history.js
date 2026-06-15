import { readTimeline, summarizeTimeline } from "./work-timeline.js";

/**
 * Build a work-history report for a user over a period by reading their full
 * timeline and producing a compact, human-readable digest the assistant can
 * turn into a report ("what did X do over the last month").
 *
 * Returns structured data; the caller (assistant) can feed it to Claude or
 * render it directly.
 */
export async function buildWorkHistoryReport({ dataFilePath, user, from, to, now = new Date() }) {
  const events = await readTimeline({
    dataFilePath,
    userId: user.id,
    from,
    to,
    limit: 20000,
  });
  const summary = summarizeTimeline(events);

  const byDay = new Map();
  for (const event of events) {
    const day = String(event.ts).slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day).push(event);
  }

  return {
    user: { id: user.id, displayName: user.displayName, role: user.role },
    period: { from, to },
    generatedAt: now.toISOString(),
    totals: {
      events: summary.total,
      tasksCreated: summary.tasksCreated.length,
      tasksAssigned: summary.tasksAssigned.length,
      tasksCompleted: summary.tasksCompleted.length,
      commitments: summary.commitments.length,
      activeDays: byDay.size,
      byKind: summary.byKind,
    },
    projectIds: summary.projectIds,
    collaboratorIds: summary.collaborators,
    tasksCompleted: summary.tasksCompleted.map(shortTask),
    tasksAssigned: summary.tasksAssigned.map(shortTask),
    tasksCreated: summary.tasksCreated.map(shortTask),
    commitments: summary.commitments.map((e) => ({ ts: e.ts, title: e.title })),
    days: [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, dayEvents]) => ({
        date: day,
        count: dayEvents.length,
        items: dayEvents.map((e) => ({ ts: e.ts, kind: e.kind, title: e.title })),
      })),
  };
}

/**
 * Parse a Russian/EN period phrase from free text into an ISO [from, to]
 * window. Supports "за месяц/неделю/сегодня/вчера/N дней" and explicit
 * "за июнь" month names. Defaults to last 30 days.
 */
function shortTask(event) {
  return {
    ts: event.ts,
    title: event.title,
    taskId: event.links?.taskIds?.[0] || event.metadata?.taskId || null,
    projectId: event.links?.projectIds?.[0] || event.metadata?.projectId || null,
  };
}

export function parseHistoryPeriod(text, now = new Date()) {
  const t = String(text || "").toLowerCase();
  const end = new Date(now);

  const monthIdx = matchRussianMonth(t);
  if (monthIdx !== null) {
    const year = now.getFullYear();
    const from = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0));
    const to = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59));
    return { from: from.toISOString(), to: to.toISOString(), label: russianMonthLabel(monthIdx) };
  }

  if (/сегодня|today/u.test(t)) {
    return dayWindow(now, 0);
  }
  if (/вчера|yesterday/u.test(t)) {
    return dayWindow(now, 1);
  }
  if (/недел|week/u.test(t)) {
    return rollingWindow(end, 7, "за неделю");
  }
  if (/месяц|month/u.test(t)) {
    return rollingWindow(end, 30, "за месяц");
  }
  const days = t.match(/(\d+)\s*(дн|day)/u);
  if (days) {
    const n = Math.min(Math.max(Number(days[1]), 1), 365);
    return rollingWindow(end, n, `за ${n} дн.`);
  }
  return rollingWindow(end, 30, "за месяц");
}

function rollingWindow(end, days, label) {
  const from = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: end.toISOString(), label };
}

function dayWindow(now, daysAgo) {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));
  return { from: from.toISOString(), to: to.toISOString(), label: daysAgo === 0 ? "сегодня" : "вчера" };
}

// Cyrillic word boundaries: \b is ASCII-only in JS regex, so use explicit
// (start|non-letter) lookaround instead.
const RU_MONTH_PATTERNS = [
  /январ/u, /феврал/u, /(^|[^а-яё])март/u, /апрел/u, /(^|[^а-яё])ма[йяе]([^а-яё]|$)/u, /(^|[^а-яё])июн/u,
  /(^|[^а-яё])июл/u, /август/u, /сентябр/u, /октябр/u, /ноябр/u, /декабр/u,
];

function matchRussianMonth(text) {
  for (let i = 0; i < RU_MONTH_PATTERNS.length; i += 1) {
    if (RU_MONTH_PATTERNS[i].test(text)) {
      return i;
    }
  }
  return null;
}

function russianMonthLabel(idx) {
  return ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"][idx];
}

export function isWorkHistoryRequest(text) {
  const t = String(text || "").toLowerCase();
  const wantsHistory = /(что\s+(я|он|она|делал|сделал)|чем\s+занимал|истори|хронолог|за\s+(месяц|недел|июн|июл|апрел|март)|отчет\s+за|сводк\w*\s+за|what\s+did|history)/u.test(t);
  return wantsHistory;
}
