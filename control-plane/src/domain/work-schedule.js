import { listOpenAssistantLoops } from "./assistant-open-loops.js";
import { findTodayPlanForUser } from "./daily-assistant.js";

const DEFAULT_TIME_ZONE = "Asia/Bishkek";
const DEFAULT_UTC_OFFSET = "+06:00";
const MORNING_OFFSET_MINUTES = 10;
const EVENING_OFFSET_MINUTES = -20;
const DELIVERY_WINDOW_MINUTES = 60;
const MISSING_ALERT_AFTER_MINUTE = 7 * 60;

const DAY_OFF_RE = /(выходн|отпуск|больнич|нерабоч|day\s*off|vacation|holiday|sick)/iu;
const PERSONAL_RE = /(сон|личн|обед|дорога|sleep|personal|lunch|commute)/iu;
const EXPLICIT_SCHEDULE_RE = /(рабоч(ий|ая)\s*(день|смена|график)|график\s*работ|смена|work\s*(day|shift|schedule)|office\s*hours)/iu;
const WORK_EVENT_RE = /(работ|задач|проект|отч[её]т|созвон|встреч|митинг|клиент|разработ|work|task|project|report|meeting|client)/iu;

export async function collectDueScheduledAssistantMessages(
  state,
  {
    now = new Date(),
    timeZone = DEFAULT_TIME_ZONE,
    utcOffset = DEFAULT_UTC_OFFSET,
    platrumClient,
    googleOAuthService,
    developerTelegramId = process.env.DEVELOPER_TELEGRAM_IDS || "984834133",
  } = {},
) {
  ensureScheduleState(state);
  const date = localDateKey(now, timeZone);
  const nowMinute = localMinuteOfDay(now, timeZone);
  const weekday = weekdayForDate(date);
  const registeredUsers = state.users.filter((user) => user.telegram?.telegramUserId);
  const messages = [];

  if (weekday === 0) {
    return messages;
  }

  const platrumResult = await readPlatrumSchedules({ platrumClient, date });
  for (const user of registeredUsers) {
    let schedule = findPlatrumSchedule(platrumResult.plans, user, date);
    const sourceErrors = [...platrumResult.errors];

    if (!schedule) {
      const googleResult = await readGoogleSchedule({
        state,
        user,
        date,
        utcOffset,
        googleOAuthService,
      });
      schedule = googleResult.schedule;
      sourceErrors.push(...googleResult.errors);
    }

    if (schedule?.dayOff) {
      recordScheduleSnapshot(state, { user, date, schedule, now });
      continue;
    }

    if (!schedule?.startTime || !schedule?.endTime) {
      if (
        nowMinute >= MISSING_ALERT_AFTER_MINUTE &&
        !hasCheckin(state, user.id, date, "schedule_missing_alert")
      ) {
        const text = formatMissingScheduleAlert({ user, date, sourceErrors });
        recordCheckin(state, {
          userId: user.id,
          date,
          type: "schedule_missing_alert",
          message: text,
          now,
        });
        messages.push({
          chatId: firstTelegramId(developerTelegramId),
          text,
          kind: "schedule_missing_alert",
          userId: user.id,
        });
      }
      continue;
    }

    recordScheduleSnapshot(state, { user, date, schedule, now });
    const startMinute = clockToMinute(schedule.startTime);
    const endMinute = clockToMinute(schedule.endTime);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      continue;
    }

    const promptDefinitions = [
      {
        type: "morning_prompt",
        dueMinute: startMinute + MORNING_OFFSET_MINUTES,
        text: formatMorningPrompt(user, schedule, { state, date, now }),
      },
      {
        type: "midday_prompt",
        dueMinute: startMinute + Math.floor((endMinute - startMinute) / 2),
        text: formatMiddayPrompt(user),
      },
      {
        type: "evening_prompt",
        dueMinute: endMinute + EVENING_OFFSET_MINUTES,
        text: formatEveningPrompt(user, schedule),
      },
    ];

    for (const prompt of promptDefinitions) {
      if (
        isWithinDeliveryWindow(nowMinute, prompt.dueMinute) &&
        !hasCheckin(state, user.id, date, prompt.type)
      ) {
        recordCheckin(state, {
          userId: user.id,
          date,
          type: prompt.type,
          message: prompt.text,
          now,
        });
        messages.push({
          chatId: user.telegram.telegramUserId,
          text: prompt.text,
          kind: prompt.type,
          userId: user.id,
        });
      }
    }
  }

  return messages.filter((message) => message.chatId);
}

export function findPlatrumSchedule(plans, user, date) {
  const candidates = (Array.isArray(plans) ? plans : [])
    .filter((plan) => matchesPlatrumUser(plan, user))
    .sort(comparePlatrumPlans);
  const plan = candidates.find((candidate) => candidate.days?.some((day) => day.date === date));
  const day = plan?.days?.find((item) => item.date === date);
  if (!day) {
    return null;
  }

  if (isDayOff(day.mode)) {
    return {
      date,
      dayOff: true,
      startTime: null,
      endTime: null,
      source: "platrum",
      confidence: plan.status === "approved" ? "high" : "medium",
      status: plan.status,
    };
  }

  const segmentStarts = day.segments?.map((segment) => segment.startTime).filter(Boolean) || [];
  const segmentEnds = day.segments?.map((segment) => segment.endTime).filter(Boolean) || [];
  const startTime = day.startTime || minClock(segmentStarts);
  const endTime = day.endTime || maxClock(segmentEnds);
  if (!startTime || !endTime) {
    return null;
  }

  return {
    date,
    dayOff: false,
    startTime,
    endTime,
    source: "platrum",
    confidence: plan.status === "approved" ? "high" : "medium",
    status: plan.status,
  };
}

export function deriveGoogleSchedule(snapshot, { includePrimary = true, date } = {}) {
  if (!snapshot?.connected) {
    return null;
  }

  const events = [];
  if (includePrimary && snapshot.calendar?.ok) {
    events.push(...(snapshot.calendar.data?.events || []));
  }
  if (snapshot.sharedCalendars?.ok) {
    for (const calendar of snapshot.sharedCalendars.data?.calendars || []) {
      events.push(...(calendar.events?.events || []));
    }
  }

  const sameDayEvents = events.filter((event) => {
    if (!event?.start || event.status === "cancelled") {
      return false;
    }
    return String(event.start).slice(0, 10) === date;
  });
  if (sameDayEvents.some((event) => DAY_OFF_RE.test(event.title || ""))) {
    return {
      date,
      dayOff: true,
      startTime: null,
      endTime: null,
      source: "google_calendar",
      confidence: "high",
    };
  }

  const timed = sameDayEvents
    .map(normalizeGoogleEvent)
    .filter(Boolean)
    .filter((event) => !PERSONAL_RE.test(event.title));
  if (!timed.length) {
    return null;
  }

  const explicit = timed.filter(
    (event) =>
      EXPLICIT_SCHEDULE_RE.test(event.title) ||
      (WORK_EVENT_RE.test(event.title) && event.endMinute - event.startMinute >= 180),
  );
  if (explicit.length) {
    return scheduleFromEvents(explicit, date, "high");
  }

  const workEvents = timed.filter((event) => WORK_EVENT_RE.test(event.title));
  if (workEvents.length >= 2) {
    const candidate = scheduleFromEvents(workEvents, date, "medium");
    if (clockToMinute(candidate.endTime) - clockToMinute(candidate.startTime) >= 240) {
      return candidate;
    }
  }
  return null;
}

async function readPlatrumSchedules({ platrumClient, date }) {
  if (!platrumClient?.getAdminWeeklyPlans) {
    return { plans: [], errors: ["Platrum schedule API is not configured"] };
  }
  try {
    const result = await platrumClient.getAdminWeeklyPlans({ weekStart: weekStartForDate(date) });
    return {
      plans: Array.isArray(result?.plans) ? result.plans : [],
      errors: result?.configured === false ? [result.note || "Platrum is not configured"] : [],
    };
  } catch (error) {
    return { plans: [], errors: [`Platrum: ${errorMessage(error)}`] };
  }
}

async function readGoogleSchedule({ state, user, date, utcOffset, googleOAuthService }) {
  if (!googleOAuthService?.readWorkspaceSnapshot) {
    return { schedule: null, errors: ["Google Calendar is not configured"] };
  }

  const holders = googleScheduleHolders(state, user);
  const errors = [];
  const period = dayPeriod(date, utcOffset);
  const searchTerms = userSearchTerms(user);
  for (const holder of holders) {
    try {
      const snapshot = await googleOAuthService.readWorkspaceSnapshot({
        userId: holder.id,
        period,
        limits: {
          calendarEvents: 50,
          calendarList: 100,
          calendarSearchTerms: searchTerms,
          sharedCalendarMatches: 8,
          sharedCalendarEvents: 50,
          gmailMessages: 1,
          driveFiles: 1,
          documentFiles: 1,
        },
      });
      if (!snapshot?.connected) {
        continue;
      }
      const schedule = deriveGoogleSchedule(snapshot, {
        includePrimary: holder.id === user.id,
        date,
      });
      if (schedule) {
        return {
          schedule: {
            ...schedule,
            calendarOwnerUserId: holder.id,
          },
          errors,
        };
      }
    } catch (error) {
      errors.push(`Google ${holder.id}: ${errorMessage(error)}`);
    }
  }

  return { schedule: null, errors };
}

function googleScheduleHolders(state, user) {
  const byId = new Map(state.users.map((item) => [item.id, item]));
  const ordered = [user];
  let manager = user.managerId ? byId.get(user.managerId) : null;
  while (manager) {
    ordered.push(manager);
    manager = manager.managerId ? byId.get(manager.managerId) : null;
  }
  ordered.push(...state.users.filter((item) => item.telegram?.telegramUserId));
  return [...new Map(ordered.filter(Boolean).map((item) => [item.id, item])).values()];
}

function userSearchTerms(user) {
  return [
    user.displayName,
    user.employeeId,
    user.platrumUsername,
    user.telegram?.username,
  ].filter(Boolean);
}

function scheduleFromEvents(events, date, confidence) {
  const startMinute = Math.min(...events.map((event) => event.startMinute));
  const endMinute = Math.max(...events.map((event) => event.endMinute));
  return {
    date,
    dayOff: false,
    startTime: minuteToClock(startMinute),
    endTime: minuteToClock(endMinute),
    source: "google_calendar",
    confidence,
  };
}

function normalizeGoogleEvent(event) {
  if (!event?.start || !event?.end || !String(event.start).includes("T") || !String(event.end).includes("T")) {
    return null;
  }
  const startMinute = isoToClockMinute(event.start);
  const endMinute = isoToClockMinute(event.end);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) {
    return null;
  }
  return {
    title: String(event.title || ""),
    startMinute,
    endMinute,
  };
}

function recordScheduleSnapshot(state, { user, date, schedule, now }) {
  const id = `work-schedule-${user.id}-${date}`;
  const snapshot = {
    id,
    userId: user.id,
    date,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    dayOff: Boolean(schedule.dayOff),
    source: schedule.source,
    confidence: schedule.confidence,
    status: schedule.status || null,
    calendarOwnerUserId: schedule.calendarOwnerUserId || null,
    resolvedAt: now.toISOString(),
  };
  const index = state.workScheduleDaily.findIndex((item) => item.id === id);
  if (index === -1) {
    state.workScheduleDaily.push(snapshot);
  } else {
    state.workScheduleDaily[index] = snapshot;
  }
}

function recordCheckin(state, { userId, date, type, message, now }) {
  state.assistantCheckins.push({
    id: `checkin-${date}-${userId}-${type}`,
    userId,
    date,
    type,
    direction: "outbound",
    message,
    answer: null,
    createdAt: now.toISOString(),
    createdByUserId: "system",
  });
}

function hasCheckin(state, userId, date, type) {
  return state.assistantCheckins.some(
    (checkin) => checkin.userId === userId && checkin.date === date && checkin.type === type,
  );
}

function formatMorningPrompt(user, schedule, { state, date, now } = {}) {
  const lines = [
    `Доброе утро, ${user.displayName}.`,
    `Рабочий день по ${sourceLabel(schedule.source)}: ${schedule.startTime}-${schedule.endTime}.`,
  ];

  const extras = state ? buildMorningBriefExtras(state, user, date) : { carryOver: [], openLoops: [] };
  if (extras.carryOver.length) {
    lines.push("", "🔻 С вчера осталось незакрытым:");
    for (const item of extras.carryOver.slice(0, 6)) {
      lines.push(`• ${item}`);
    }
  }
  if (extras.openLoops.length) {
    lines.push("", "📌 На контроле (твои обещания/вопросы):");
    for (const item of extras.openLoops.slice(0, 4)) {
      lines.push(`• ${item}`);
    }
  }

  lines.push(
    "",
    "Напиши план на день (я подготовлю черновик, решение за тобой):",
    "/plan задача 1; задача 2; задача 3",
  );
  return lines.join("\n");
}

// Reliable, state-only brief data (no live integration calls in the cron):
// yesterday's unfinished plan items + open loops (promises/questions).
export function buildMorningBriefExtras(state, user, date) {
  const carryOver = [];
  const yesterday = previousDateKey(date);
  const plans = state.dailyWorkPlans || [];
  const yPlan = plans.find((p) => p.userId === user.id && p.date === yesterday);
  if (yPlan) {
    for (const item of yPlan.items || []) {
      if (item.status !== "done") {
        carryOver.push(String(item.title || "").trim());
      }
    }
  }
  let openLoops = [];
  try {
    openLoops = listOpenAssistantLoops(state, { userIds: [user.id], limit: 4 }).map((l) => String(l.text || "").trim());
  } catch {
    openLoops = [];
  }
  return { carryOver: carryOver.filter(Boolean), openLoops: openLoops.filter(Boolean) };
}

function previousDateKey(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function formatMiddayPrompt(user) {
  return [
    `${user.displayName}, короткая сверка по дню.`,
    "Что уже сдвинулось, а где нужна помощь?",
    "",
    "/progress",
    "/blocker описание проблемы",
  ].join("\n");
}

function formatEveningPrompt(user, schedule) {
  return [
    `${user.displayName}, до конца рабочего дня около 20 минут.`,
    `График сегодня: ${schedule.startTime}-${schedule.endTime}.`,
    "",
    "Проверь итог:",
    "/today",
    "",
    "Отметь готовое командой /done НОМЕР.",
    "Что осталось незавершённым и почему? Я сохраню ответ для корректного отчёта руководителю.",
  ].join("\n");
}

function formatMissingScheduleAlert({ user, date, sourceErrors }) {
  const details = sourceErrors.length ? `\nПричины: ${sourceErrors.slice(0, 3).join("; ")}` : "";
  return [
    "Не удалось определить рабочий график.",
    `Сотрудник: ${user.displayName} (${user.id})`,
    `Дата: ${date}`,
    "В Platrum нет графика/выходного, а Google Calendar не дал подходящего рабочего интервала.",
    "Автоматические утреннее и вечернее сообщения этому сотруднику сегодня не отправлены.",
    details,
  ].filter(Boolean).join("\n");
}

function ensureScheduleState(state) {
  state.assistantCheckins ??= [];
  state.workScheduleDaily ??= [];
}

function comparePlatrumPlans(left, right) {
  const statusWeight = (value) => (value === "approved" ? 2 : value === "pending" ? 1 : 0);
  const byStatus = statusWeight(right.status) - statusWeight(left.status);
  if (byStatus !== 0) {
    return byStatus;
  }
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function matchesPlatrumUser(plan, user) {
  if (user.platrumUserId && Number(plan.userId) === Number(user.platrumUserId)) {
    return true;
  }
  return Boolean(user.platrumUsername) &&
    String(plan.username || "").toLowerCase() === String(user.platrumUsername).toLowerCase();
}

function isDayOff(mode) {
  return ["day_off", "weekend", "holiday", "vacation", "sick"].includes(String(mode || "").toLowerCase());
}

function isWithinDeliveryWindow(nowMinute, dueMinute) {
  return nowMinute >= dueMinute && nowMinute < dueMinute + DELIVERY_WINDOW_MINUTES;
}

function localDateKey(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function localMinuteOfDay(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function weekdayForDate(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function weekStartForDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  const weekday = value.getUTCDay();
  const delta = weekday === 0 ? -6 : 1 - weekday;
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}

function dayPeriod(date, utcOffset) {
  return {
    from: new Date(`${date}T00:00:00${utcOffset}`).toISOString(),
    to: new Date(`${date}T23:59:59.999${utcOffset}`).toISOString(),
    label: date,
  };
}

function isoToClockMinute(value) {
  const match = String(value).match(/T(\d{2}):(\d{2})/u);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockToMinute(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/u);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function minuteToClock(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function minClock(values) {
  const minutes = values.map(clockToMinute).filter((value) => value !== null);
  return minutes.length ? minuteToClock(Math.min(...minutes)) : null;
}

function maxClock(values) {
  const minutes = values.map(clockToMinute).filter((value) => value !== null);
  return minutes.length ? minuteToClock(Math.max(...minutes)) : null;
}

function sourceLabel(source) {
  return source === "platrum" ? "Platrum" : "Google Calendar";
}

function firstTelegramId(value) {
  return String(value || "")
    .split(/[,\s]+/u)
    .map((item) => item.trim())
    .find(Boolean);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
