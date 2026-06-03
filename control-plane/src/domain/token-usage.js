import crypto from "node:crypto";
import { validation } from "./errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function ensureTokenUsageState(state, env = process.env, now = new Date()) {
  if (!Array.isArray(state.tokenUsageEvents)) {
    state.tokenUsageEvents = [];
  }
  if (!state.tokenReportSchedule || typeof state.tokenReportSchedule !== "object") {
    state.tokenReportSchedule = {};
  }
  state.tokenReportSchedule.recipientTelegramId =
    env.TOKEN_USAGE_REPORT_TELEGRAM_ID ||
    state.tokenReportSchedule.recipientTelegramId ||
    "984834133";
  state.tokenReportSchedule.startedAt =
    state.tokenReportSchedule.startedAt || now.toISOString();
  for (const key of ["daily", "weekly", "monthly"]) {
    if (!state.tokenReportSchedule[key] || typeof state.tokenReportSchedule[key] !== "object") {
      state.tokenReportSchedule[key] = { lastSentAt: null };
    }
  }
}

export function recordTokenUsageEvent(state, payload, { now = new Date() } = {}) {
  ensureTokenUsageState(state, process.env, now);
  const event = normalizeTokenUsageEvent(state, payload, now);
  state.tokenUsageEvents.push(event);
  return event;
}

export function recordTokenUsageEvents(state, payload, options = {}) {
  const events = Array.isArray(payload?.events) ? payload.events : Array.isArray(payload) ? payload : [payload];
  if (!events.length) {
    throw validation("At least one token usage event is required");
  }
  return events.map((event) => recordTokenUsageEvent(state, event, options));
}

export function buildTokenUsageSummary(state, { from, to }) {
  ensureTokenUsageState(state);
  const fromTime = parseTime(from, "from");
  const toTime = parseTime(to, "to");
  if (fromTime > toTime) {
    throw validation("from must be before to");
  }

  const events = state.tokenUsageEvents.filter((event) => {
    const occurredAt = new Date(event.occurredAt).getTime();
    return occurredAt >= fromTime && occurredAt <= toTime;
  });

  const totals = createTotals();
  const byUser = new Map();
  const byAction = new Map();
  const byModel = new Map();
  const byProject = new Map();

  for (const event of events) {
    addEvent(totals, event);
    addEvent(readBucket(byUser, event.userId || "unknown"), event);
    addEvent(readBucket(byAction, event.action || "unknown"), event);
    addEvent(readBucket(byModel, event.model || "unknown"), event);
    addEvent(readBucket(byProject, event.projectId || "none"), event);
  }

  return {
    from: new Date(fromTime).toISOString(),
    to: new Date(toTime).toISOString(),
    eventCount: events.length,
    totals,
    byUser: mapToRows(byUser, (userId) => ({
      userId,
      displayName: findUser(state, userId)?.displayName || userId,
    })),
    byAction: mapToRows(byAction, (action) => ({ action })),
    byModel: mapToRows(byModel, (model) => ({ model })),
    byProject: mapToRows(byProject, (projectId) => ({
      projectId,
      projectName: findProject(state, projectId)?.name || projectId,
    })),
  };
}

export function resolveTokenUsagePeriod(period = "day", now = new Date()) {
  const normalized = String(period || "day").toLowerCase();
  const to = now;
  if (["day", "daily", "24h", "last24h"].includes(normalized)) {
    return {
      key: "daily",
      label: "last 24 hours",
      from: new Date(to.getTime() - DAY_MS).toISOString(),
      to: to.toISOString(),
      intervalMs: DAY_MS,
    };
  }
  if (["week", "weekly", "7d"].includes(normalized)) {
    return {
      key: "weekly",
      label: "last 7 days",
      from: new Date(to.getTime() - 7 * DAY_MS).toISOString(),
      to: to.toISOString(),
      intervalMs: 7 * DAY_MS,
    };
  }
  if (["month", "monthly", "30d"].includes(normalized)) {
    return {
      key: "monthly",
      label: "last 30 days",
      from: new Date(to.getTime() - 30 * DAY_MS).toISOString(),
      to: to.toISOString(),
      intervalMs: 30 * DAY_MS,
    };
  }
  throw validation("period must be day, week, or month");
}

export function isTokenUsageReportDue(scheduleEntry, period, now = new Date(), startedAt) {
  const nowTime = now.getTime();
  const lastSentAt = scheduleEntry?.lastSentAt;
  if (lastSentAt) {
    return nowTime - new Date(lastSentAt).getTime() >= period.intervalMs;
  }
  const startTime = startedAt ? new Date(startedAt).getTime() : nowTime;
  return nowTime - startTime >= period.intervalMs;
}

export function formatTokenUsageSummary(summary, { label = "period" } = {}) {
  const lines = [
    `Token usage report (${label})`,
    `Events: ${summary.eventCount}`,
    `Total tokens: ${formatNumber(summary.totals.totalTokens)}`,
    `Input: ${formatNumber(summary.totals.inputTokens)}, output: ${formatNumber(summary.totals.outputTokens)}`,
    `Cache read: ${formatNumber(summary.totals.cacheReadTokens)}, cache write: ${formatNumber(summary.totals.cacheWriteTokens)}`,
  ];

  if (summary.totals.costUsd > 0) {
    lines.push(`Estimated cost: $${summary.totals.costUsd.toFixed(4)}`);
  }

  lines.push("", "Top users:");
  for (const row of summary.byUser.slice(0, 8)) {
    lines.push(`- ${row.displayName}: ${formatNumber(row.totalTokens)} tokens (${row.eventCount} events)`);
  }
  if (!summary.byUser.length) {
    lines.push("- no usage");
  }

  lines.push("", "Top actions:");
  for (const row of summary.byAction.slice(0, 8)) {
    lines.push(`- ${row.action}: ${formatNumber(row.totalTokens)} tokens (${row.eventCount} events)`);
  }
  if (!summary.byAction.length) {
    lines.push("- no usage");
  }

  lines.push("", "Top models:");
  for (const row of summary.byModel.slice(0, 6)) {
    lines.push(`- ${row.model}: ${formatNumber(row.totalTokens)} tokens`);
  }
  if (!summary.byModel.length) {
    lines.push("- no usage");
  }

  return lines.join("\n");
}

function normalizeTokenUsageEvent(state, payload, now) {
  if (!payload || typeof payload !== "object") {
    throw validation("Token usage event must be a JSON object");
  }

  const userId = resolveUserId(state, payload);
  const action = normalizeRequiredString(payload.action, "action");
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : now;
  if (!Number.isFinite(occurredAt.getTime())) {
    throw validation("occurredAt must be a valid date-time");
  }

  const inputTokens = readNonNegativeInteger(payload.inputTokens ?? payload.promptTokens, "inputTokens");
  const outputTokens = readNonNegativeInteger(payload.outputTokens ?? payload.completionTokens, "outputTokens");
  const cacheReadTokens = readNonNegativeInteger(payload.cacheReadTokens, "cacheReadTokens");
  const cacheWriteTokens = readNonNegativeInteger(payload.cacheWriteTokens, "cacheWriteTokens");
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens =
    payload.totalTokens === undefined
      ? computedTotal
      : readNonNegativeInteger(payload.totalTokens, "totalTokens");

  if (computedTotal === 0 && totalTokens === 0) {
    throw validation("Token usage event must include token counts");
  }

  const projectId = normalizeOptionalString(payload.projectId);
  if (projectId && !findProject(state, projectId)) {
    throw validation("Unknown projectId", { projectId });
  }

  return {
    id: normalizeOptionalString(payload.id) || crypto.randomUUID(),
    occurredAt: occurredAt.toISOString(),
    userId,
    projectId: projectId || null,
    action,
    source: normalizeOptionalString(payload.source) || "agent",
    provider: normalizeOptionalString(payload.provider) || null,
    model: normalizeOptionalString(payload.model) || null,
    sessionId: normalizeOptionalString(payload.sessionId) || null,
    requestId: normalizeOptionalString(payload.requestId) || null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costUsd: readNonNegativeNumber(payload.costUsd, "costUsd"),
    metadata: normalizeMetadata(payload.metadata),
  };
}

function resolveUserId(state, payload) {
  const explicitUserId = normalizeOptionalString(payload.userId);
  if (explicitUserId) {
    if (!findUser(state, explicitUserId)) {
      throw validation("Unknown userId", { userId: explicitUserId });
    }
    return explicitUserId;
  }

  const telegramUserId = normalizeOptionalString(payload.telegramUserId);
  if (telegramUserId) {
    const user = state.users.find((item) => item.telegram?.telegramUserId === telegramUserId);
    if (!user) {
      throw validation("Unknown telegramUserId", { telegramUserId });
    }
    return user.id;
  }

  throw validation("Token usage event must include userId or telegramUserId");
}

function createTotals() {
  return {
    eventCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

function addEvent(bucket, event) {
  bucket.eventCount += 1;
  bucket.inputTokens += event.inputTokens;
  bucket.outputTokens += event.outputTokens;
  bucket.cacheReadTokens += event.cacheReadTokens;
  bucket.cacheWriteTokens += event.cacheWriteTokens;
  bucket.totalTokens += event.totalTokens;
  bucket.costUsd += event.costUsd;
}

function readBucket(map, key) {
  if (!map.has(key)) {
    map.set(key, createTotals());
  }
  return map.get(key);
}

function mapToRows(map, identityFactory) {
  return [...map.entries()]
    .map(([key, totals]) => ({
      ...identityFactory(key),
      ...totals,
      costUsd: Number(totals.costUsd.toFixed(8)),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || right.eventCount - left.eventCount);
}

function parseTime(value, name) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw validation(`${name} must be a valid date-time`);
  }
  return parsed;
}

function readNonNegativeInteger(value, name) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw validation(`${name} must be a non-negative integer`);
  }
  return number;
}

function readNonNegativeNumber(value, name) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw validation(`${name} must be a non-negative number`);
  }
  return number;
}

function normalizeRequiredString(value, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw validation(`${name} is required`);
  }
  return normalized;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function findUser(state, userId) {
  return state.users.find((user) => user.id === userId);
}

function findProject(state, projectId) {
  return state.projects.find((project) => project.id === projectId);
}

function formatNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-US");
}
