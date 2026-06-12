import { ensureAssistantMemoryState } from "./assistant-memory.js";

const BISHKEK_TZ = "Asia/Bishkek";
const MAX_SUMMARIES_PER_USER = 30;
const DEFAULT_MEMORY_MODEL = "claude-haiku-4-5-20251001";
const MAX_SUMMARY_LENGTH = 700;
const MAX_EVENTS_PER_SUMMARY = 60;

export function ensureAssistantDailySummariesState(state) {
  state.assistantDailySummaries ??= [];
  return state.assistantDailySummaries;
}

export function listAssistantDailySummaries(state, { userIds = [], limit = 3 } = {}) {
  ensureAssistantDailySummariesState(state);
  const filterIds = new Set(userIds.filter(Boolean));
  return state.assistantDailySummaries
    .filter((summary) => filterIds.size === 0 || filterIds.has(summary.userId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, Math.min(Math.max(Number(limit || 3), 1), 30))
    .map((summary) => ({
      id: summary.id,
      userId: summary.userId,
      date: summary.date,
      text: summary.text,
      eventCount: summary.eventCount,
      createdAt: summary.createdAt,
    }));
}

export function getLocalDateKey(date, timeZone = BISHKEK_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hasDailySummary(state, { userId, date }) {
  ensureAssistantDailySummariesState(state);
  return state.assistantDailySummaries.some(
    (summary) => summary.userId === userId && summary.date === date,
  );
}

export async function runDueMemorySummaries({ store, claudeClient, now = new Date(), env = process.env }) {
  if (!claudeClient || claudeClient.configured === false) {
    return { generated: 0, reason: "claude-not-configured" };
  }

  const state = await store.load();
  const memory = ensureAssistantMemoryState(state);
  ensureAssistantDailySummariesState(state);

  const yesterday = getLocalDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const model = env.CLAUDE_MEMORY_MODEL || DEFAULT_MEMORY_MODEL;

  const eventsByUser = new Map();
  for (const event of memory) {
    if (!event.userId) {
      continue;
    }
    if (getLocalDateKey(new Date(event.createdAt)) !== yesterday) {
      continue;
    }
    if (hasDailySummary(state, { userId: event.userId, date: yesterday })) {
      continue;
    }
    if (!eventsByUser.has(event.userId)) {
      eventsByUser.set(event.userId, []);
    }
    eventsByUser.get(event.userId).push(event);
  }

  let generated = 0;
  for (const [userId, events] of eventsByUser.entries()) {
    try {
      const completion = await claudeClient.complete({
        system: buildSummarySystemPrompt(),
        user: buildSummaryUserPrompt({ date: yesterday, events }),
        maxTokens: 500,
        model,
      });
      const text = String(completion.text || "").trim().slice(0, MAX_SUMMARY_LENGTH);
      if (!text) {
        continue;
      }
      await store.update((currentState) => {
        if (hasDailySummary(currentState, { userId, date: yesterday })) {
          return;
        }
        ensureAssistantDailySummariesState(currentState);
        currentState.assistantDailySummaries.push({
          id: `summary-${userId}-${yesterday}`,
          userId,
          date: yesterday,
          text,
          eventCount: events.length,
          createdAt: now.toISOString(),
        });
        pruneSummaries(currentState, userId);
      });
      generated += 1;
    } catch (error) {
      console.error(
        `runDueMemorySummaries failed for ${userId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { generated, date: yesterday };
}

function pruneSummaries(state, userId) {
  const userSummaries = state.assistantDailySummaries.filter(
    (summary) => summary.userId === userId,
  );
  if (userSummaries.length <= MAX_SUMMARIES_PER_USER) {
    return;
  }
  const keepDates = new Set(
    userSummaries
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, MAX_SUMMARIES_PER_USER)
      .map((summary) => summary.date),
  );
  state.assistantDailySummaries = state.assistantDailySummaries.filter(
    (summary) => summary.userId !== userId || keepDates.has(summary.date),
  );
}

function buildSummarySystemPrompt() {
  return [
    "Ты — модуль памяти AI-ассистента Starlab.",
    "Составь сжатую сводку рабочего дня сотрудника по журналу его сообщений с ассистентом.",
    "Опиши: что делал, что обещал, что блокирует/осталось незакрытым.",
    "Только русский язык, не более 700 символов, без markdown и без выдумок.",
    "Если данных мало — коротко отметь это, не растягивай.",
  ].join(" ");
}

function buildSummaryUserPrompt({ date, events }) {
  const lines = events
    .slice(0, MAX_EVENTS_PER_SUMMARY)
    .map((event) => `[${event.role}/${event.kind}] ${event.text}`);
  return [
    `Дата (Asia/Bishkek): ${date}`,
    "",
    "Журнал событий за день:",
    lines.join("\n") || "(пусто)",
    "",
    "Дай короткую сводку дня.",
  ].join("\n");
}
