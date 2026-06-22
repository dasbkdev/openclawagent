import { summarizeTasks } from "../domain/bitrix-reports.js";
import { buildEmployeeKpi, ensurePlatrumAnalyticsState, summarizePlatrumTasks } from "../domain/platrum-reports.js";
import { buildDailyAssistantContext } from "../domain/daily-assistant.js";
import {
  buildAssistantMemoryContextV2,
  buildRecentDeviceCommandMemory,
  drainEvictedMemoryEvents,
  recordAssistantMemoryEvent,
} from "../domain/assistant-memory.js";
import { listAssistantFacts } from "../domain/assistant-facts.js";
import { buildEmployeeProfiles } from "../domain/employee-profile.js";
import { retrieveRelevantFacts } from "../domain/semantic-memory.js";
import { distillAssistantMemory } from "./memory-distiller.js";
import { appendMemoryArchive } from "../infra/memory-archive.js";
import { appendTimelineEvent } from "../domain/work-timeline.js";
import { syncTasksToTimeline } from "../domain/task-sync.js";
import { buildWorkHistoryReport, parseHistoryPeriod, isWorkHistoryRequest } from "../domain/work-history.js";
import { listVisibleDeviceAgents } from "../domain/device-agents.js";
import { unauthorized } from "../domain/errors.js";
import { appendAuditEvent } from "../infra/audit.js";
import { enforceUserTokenBudget, recordTokenUsageEvent } from "../domain/token-usage.js";
import {
  canAccessProject,
  listAccessibleUserIds,
  publicProject,
  publicUser,
} from "../domain/policy.js";
import { markdownToTelegramHtml, renderBlocks } from "../telegram/render.js";

const MAX_CONTEXT_USERS = 8;
const MAX_CONTEXT_PROJECTS = 6;
const MAX_TASKS_PER_PROJECT = 12;
const MAX_GOOGLE_CONTEXT_USERS = 5;
const USER_ALIASES = Object.freeze({
  "u-nikolay": ["николай", "николая", "николаю", "nikolay", "nikolai"],
  "u-maksat": ["максат", "максата", "максату", "maksat"],
  "u-pm-1": ["бегайым", "бегайым пм", "begayym", "begoim", "project manager 1", "pm1", "пм1"],
  "u-pm-2": ["project manager 2", "pm2", "пм2"],
  "u-pm-3": ["project manager 3", "pm3", "пм3", "перизат", "perizat", "усенкулова"],
});

export async function answerCompanyAssistant({
  store,
  telegramUserId,
  actorUserId,
  question,
  claudeClient,
  kickidlerClient,
  bitrixClient,
  platrumClient,
  googleOAuthService,
  voyageClient = null,
  embeddingStore = null,
  detailed = false,
  now = new Date(),
}) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    const plainText = "Напиши вопрос текстом. Например: «Как сегодня работала Бегайым?»";
    return { html: markdownToTelegramHtml(plainText), plainText };
  }

  const state = await store.load();
  const actor = actorUserId
    ? resolveActorByUserId(state, actorUserId)
    : resolveActorByTelegramId(state, telegramUserId);

  // Per-user 24h token budget. Block before spending on context/Claude.
  const budgetGate = enforceUserTokenBudget(state, actor, { now });
  if (!budgetGate.allowed) {
    return { html: markdownToTelegramHtml(budgetGate.message), plainText: budgetGate.message };
  }

  const context = await buildAssistantContext({
    state,
    actor,
    question: trimmedQuestion,
    kickidlerClient,
    bitrixClient,
    platrumClient,
    googleOAuthService,
    claudeClient,
    voyageClient,
    embeddingStore,
    dataFilePath: store.filePath || null,
    now,
  });

  const completion = await claudeClient.complete({
    system: buildSystemPrompt({ detailed }),
    user: buildUserPrompt({ question: trimmedQuestion, context, detailed }),
    maxTokens: detailed ? 3000 : 1100,
  });

  const rendered = renderAssistantCompletion(completion.text, {
    truncated: completion.stopReason === "max_tokens",
  });

  const taskTimelineEvents = [];
  const evicted = await store.update((currentState) => {
    persistDiscoveredExternalIds(currentState, context);
    for (const entry of context.platrum?.userTasks || []) {
      if (entry?.user?.id && Array.isArray(entry.tasks)) {
        taskTimelineEvents.push(
          ...syncTasksToTimeline(currentState, {
            userId: entry.user.id,
            tasks: entry.tasks,
            source: "platrum",
            now,
          }),
        );
      }
    }
    appendAuditEvent(currentState, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: actorUserId ? "local_agent.assistant.ask" : "telegram.assistant.ask",
      target: {
        targetUserIds: context.targetUsers.map((user) => user.id),
        projectIds: context.projects.map((project) => project.id),
      },
      metadata: {
        claudeConfigured: completion.configured,
        model: completion.model,
      },
    });

    if (completion.usage) {
      const totalTokens =
        completion.usage.inputTokens +
        completion.usage.outputTokens +
        completion.usage.cacheReadTokens +
        completion.usage.cacheWriteTokens;
      recordTokenUsageEvent(currentState, {
        userId: actor.id,
        action: actorUserId ? "local_agent.assistant" : "telegram.assistant",
        source: actorUserId ? "local-openclaw-agent" : "telegram-bot",
        provider: "anthropic",
        model: completion.model,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
        cacheReadTokens: completion.usage.cacheReadTokens,
        cacheWriteTokens: completion.usage.cacheWriteTokens,
        totalTokens,
        metadata: {
          targetUserIds: context.targetUsers.map((user) => user.id),
          projectIds: context.projects.map((project) => project.id),
        },
      }, { now });
    }
    const channel = actorUserId ? "local-agent" : "telegram";
    recordAssistantMemoryEvent(currentState, {
      userId: actor.id,
      channel,
      role: "user",
      kind: "assistant_question",
      text: trimmedQuestion,
      target: {
        userIds: context.targetUsers.map((user) => user.id),
        projectIds: context.projects.map((project) => project.id),
      },
      metadata: {
        model: completion.model,
      },
      now,
    });
    recordAssistantMemoryEvent(currentState, {
      userId: actor.id,
      channel,
      role: "assistant",
      kind: "assistant_answer",
      text: rendered.plainText,
      target: {
        userIds: context.targetUsers.map((user) => user.id),
        projectIds: context.projects.map((project) => project.id),
      },
      metadata: {
        model: completion.model,
      },
      now,
    });
    recordAssistantPlatrumSnapshots(currentState, { context, now });
    return drainEvictedMemoryEvents(currentState);
  });

  await archiveEvictedEvents(store, evicted);

  // Record the dialogue into the work timeline (full chronology source of
  // truth). Fire-and-forget so it never delays the answer.
  const dataFilePath = store.filePath || null;
  for (const item of taskTimelineEvents) {
    void appendTimelineEvent({ dataFilePath, userId: item.userId, event: item.event });
  }
  const dialogLinks = {
    projectIds: context.projects.map((project) => project.id),
    userIds: context.targetUsers.map((user) => user.id),
  };
  void appendTimelineEvent({
    dataFilePath,
    userId: actor.id,
    event: {
      ts: now.toISOString(),
      kind: "dialog_question",
      actorUserId: actor.id,
      title: trimmedQuestion.slice(0, 200),
      detail: trimmedQuestion,
      links: dialogLinks,
      source: actorUserId ? "local-agent" : "telegram",
    },
  });
  void appendTimelineEvent({
    dataFilePath,
    userId: actor.id,
    event: {
      ts: now.toISOString(),
      kind: "dialog_answer",
      actorUserId: actor.id,
      title: rendered.plainText.slice(0, 200),
      detail: rendered.plainText,
      links: dialogLinks,
      source: "assistant",
      metadata: { model: completion.model },
    },
  });

  if (completion.configured !== false) {
    // Memory distillation (a Haiku call) must NOT delay the answer — run it
    // in the background. It writes to the store via its own store.update.
    void distillAssistantMemory({
      store,
      claudeClient,
      actor,
      question: trimmedQuestion,
      answer: rendered.plainText,
      now,
    }).catch((error) => console.error("distill failed:", error instanceof Error ? error.message : error));
  }

  // Concise by default → invite the user to expand. Not on detailed answers.
  if (!detailed) {
    const footer = "💬 Если нужен подробный ответ — напишите «подробнее».";
    return {
      html: `${rendered.html}\n\n${markdownToTelegramHtml(footer)}`,
      plainText: `${rendered.plainText}\n\n${footer}`,
    };
  }
  return { html: rendered.html, plainText: rendered.plainText };
}

/**
 * Parse the model's structured JSON answer
 * ({ title, sections: [{ heading, lines }], next_steps }) into Telegram
 * HTML (via renderBlocks) and a plain-text version (for memory/voice).
 * Falls back to markdown-to-HTML conversion of the raw text if the
 * response is not valid JSON in the expected shape.
 */
export function renderAssistantCompletion(answerText, { truncated = false } = {}) {
  const raw = String(answerText ?? "");
  const truncatedNote = truncated ? "\n\n⚠️ Ответ был сокращён из-за лимита длины." : "";
  const parsed = parseStructuredAnswer(raw);
  if (parsed) {
    const blocks = [];
    const plainLines = [];

    if (parsed.title) {
      blocks.push({ type: "title", text: parsed.title });
      plainLines.push(parsed.title);
    }

    for (const section of parsed.sections || []) {
      if (!section || typeof section !== "object") {
        continue;
      }
      const lines = Array.isArray(section.lines)
        ? section.lines.map((line) => String(line ?? "")).filter((line) => line.length > 0)
        : [];
      blocks.push({ type: "section", heading: section.heading || "", lines });
      if (section.heading) {
        plainLines.push("", String(section.heading));
      }
      for (const line of lines) {
        plainLines.push(line);
      }
    }

    if (Array.isArray(parsed.next_steps) && parsed.next_steps.length > 0) {
      const items = parsed.next_steps.map((item) => String(item ?? "")).filter((item) => item.length > 0);
      if (items.length > 0) {
        blocks.push({ type: "section", heading: "Следующие шаги", lines: [] });
        blocks.push({ type: "list", items });
        plainLines.push("", "Следующие шаги");
        for (const item of items) {
          plainLines.push(`- ${item}`);
        }
      }
    }

    return {
      html: renderBlocks(blocks) + (truncated ? markdownToTelegramHtml(truncatedNote) : ""),
      plainText: (plainLines.join("\n").trim() + truncatedNote).trim(),
    };
  }

  // The answer is not parseable JSON. If it still looks like our JSON
  // format (e.g. truncated mid-string by the token limit), raw JSON must
  // never reach the user: salvage the readable string values instead.
  if (looksLikeStructuredJson(raw)) {
    const salvagedText = salvageStructuredText(raw);
    const fallback = salvagedText || "Не удалось сформировать ответ полностью. Попробуй переспросить или сузить вопрос.";
    return {
      html: markdownToTelegramHtml(fallback + truncatedNote),
      plainText: (fallback + truncatedNote).trim(),
    };
  }

  return {
    html: markdownToTelegramHtml(raw + truncatedNote),
    plainText: (raw + truncatedNote).trim(),
  };
}

/**
 * Try to parse the assistant response as the structured JSON answer
 * format. Defensively extracts the JSON object between the first `{`
 * and the last `}` to tolerate surrounding prose/code fences. Returns
 * null if no valid object with a recognizable shape is found.
 */
function parseStructuredAnswer(text) {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  const candidates = [];
  const end = text.lastIndexOf("}");
  if (end > start) {
    candidates.push(text.slice(start, end + 1));
  }
  // The model reply may be cut off mid-string by the token limit; try to
  // repair the fragment from the first `{` to the end of the text.
  candidates.push(...repairTruncatedJsonCandidates(text.slice(start)));

  for (const candidate of candidates) {
    let value;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    if (typeof value.title !== "string" && !Array.isArray(value.sections)) {
      continue;
    }
    return value;
  }
  return null;
}

/**
 * Build progressively more aggressive repaired variants of a truncated
 * JSON fragment: close an unterminated string, drop dangling separators
 * or a dangling key, then close all open brackets.
 */
function repairTruncatedJsonCandidates(fragment) {
  let inString = false;
  let escaped = false;
  const stack = [];
  for (const ch of fragment) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  let base = fragment;
  if (escaped) {
    base = base.slice(0, -1);
  }
  if (inString) {
    base += '"';
  }
  const closers = stack.slice().reverse().join("");

  const candidates = [base + closers];
  const noSeparator = base.replace(/\s*[,:]\s*$/u, "");
  if (noSeparator !== base) {
    candidates.push(noSeparator + closers);
  }
  const noDanglingKey = noSeparator.replace(/,\s*"(?:[^"\\]|\\.)*"\s*$/u, "");
  if (noDanglingKey !== noSeparator) {
    candidates.push(noDanglingKey + closers);
  }
  return candidates;
}

function looksLikeStructuredJson(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") && /"(title|sections|heading|lines|next_steps)"/u.test(trimmed);
}

/**
 * Last-resort extraction of readable content from broken structured
 * JSON: pull string values in order, skipping format keys, so the user
 * gets plain readable lines instead of raw JSON syntax.
 */
function salvageStructuredText(text) {
  const keys = new Set(["title", "sections", "heading", "lines", "next_steps"]);
  const out = [];
  const stringPattern = /"((?:[^"\\]|\\.)*)"(\s*:)?/gu;
  let match;
  while ((match = stringPattern.exec(text)) !== null) {
    if (match[2]) {
      continue;
    }
    let value;
    try {
      value = JSON.parse(`"${match[1]}"`);
    } catch {
      value = match[1];
    }
    const cleaned = String(value).trim();
    if (cleaned.length > 0 && !keys.has(cleaned)) {
      out.push(cleaned);
    }
  }
  // Include a readable tail cut off before its closing quote.
  const tail = text.match(/"((?:[^"\\]|\\.){8,})$/u);
  if (tail) {
    out.push(`${tail[1].trim()}…`);
  }
  return out.join("\n").trim();
}

async function archiveEvictedEvents(store, evicted) {
  if (!Array.isArray(evicted) || evicted.length === 0) {
    return;
  }
  const byUser = new Map();
  for (const event of evicted) {
    const userId = event.userId || "unknown";
    if (!byUser.has(userId)) {
      byUser.set(userId, []);
    }
    byUser.get(userId).push(event);
  }
  for (const [userId, events] of byUser.entries()) {
    await appendMemoryArchive({ dataFilePath: store.filePath || null, userId, events });
  }
}

export async function buildAssistantContext({
  state,
  actor,
  question,
  kickidlerClient,
  bitrixClient,
  platrumClient,
  googleOAuthService,
  claudeClient = null,
  voyageClient = null,
  embeddingStore = null,
  dataFilePath = null,
  now = new Date(),
}) {
  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  const accessibleUsers = state.users
    .filter((user) => accessibleUserIds.has(user.id))
    .slice(0, MAX_CONTEXT_USERS);
  const visibleDevices = listVisibleDeviceAgents(state, actor);
  const targetUsers = resolveTargetUsers({ state, actor, question, accessibleUsers, visibleDevices });
  const projects = resolveRelevantProjects({ state, actor, targetUsers, question });
  const period = resolveQuestionPeriod(question, now);
  const metricon = await readMetriconContext({ targetUsers, period, kickidlerClient });
  const platrum = await readPlatrumContext({ projects, targetUsers, period, platrumClient });
  const bitrix = await readBitrixContext({ projects, bitrixClient });
  const bitrixUserTasks = await readBitrixUserTasksContext({ targetUsers, bitrixClient });
  const bitrixBoardTasks = await readBitrixBoardTasksContext({ bitrixClient });
  const googleContextUsers = resolveGoogleContextUsers({ targetUsers, accessibleUsers, question });
  const calendarSearchTerms = buildCalendarSearchTerms({ question, targetUsers, visibleDevices });
  const googleWorkspace = await readGoogleWorkspaceContext({
    users: googleContextUsers,
    period,
    googleOAuthService,
    calendarSearchTerms,
  });
  const dailyAssistant = buildDailyAssistantContext(state, { targetUsers, now });
  const memory = await buildAssistantMemoryContextV2(state, {
    actor,
    targetUsers,
    question,
    dataFilePath,
  });
  const recentDeviceCommands = buildRecentDeviceCommandMemory(state, { actor, targetUsers });

  // Semantic memory: pull the facts most relevant to THIS question (by Voyage
  // embedding similarity) across the actor + target users, instead of only the
  // most recent ones. Safe no-op when Voyage is not configured.
  let semanticMemory = [];
  if (voyageClient?.configured && embeddingStore) {
    try {
      const factUserIds = [actor.id, ...targetUsers.map((user) => user.id)];
      const facts = listAssistantFacts(state, { userIds: factUserIds, limit: 200 });
      semanticMemory = await retrieveRelevantFacts({
        embeddingStore,
        voyage: voyageClient,
        facts,
        question,
        k: 8,
        minScore: 0.2,
      });
    } catch {
      semanticMemory = [];
    }
  }

  // Web research: for questions needing current internet information (news,
  // prices, weather, "найди в интернете"…), let Claude search and read the web
  // server-side, and attach the result as grounding for the final answer.
  const webResearch = await readWebResearchContext({ question, claudeClient, now });

  // Work-history: for "what did X do over the period" questions, attach each
  // target user's full chronology digest from the timeline.
  let workHistory = null;
  if (dataFilePath && isWorkHistoryRequest(question)) {
    const hp = parseHistoryPeriod(question, now);
    workHistory = { periodLabel: hp.label, from: hp.from, to: hp.to, users: [] };
    for (const user of targetUsers) {
      try {
        workHistory.users.push(
          await buildWorkHistoryReport({ dataFilePath, user, from: hp.from, to: hp.to, now }),
        );
      } catch {
        // skip on failure, never break the answer
      }
    }
  }

  return {
    now: now.toISOString(),
    today: describeToday(now),
    actor: publicUser(actor),
    accessPolicy: describeAccessPolicy(actor.role),
    period,
    accessibleUsers: accessibleUsers.map((user) => publicUser(user)),
    targetUsers: targetUsers.map((user) => publicUser(user)),
    visibleDevices,
    projects: projects.map((project) => publicProject(project)),
    metricon,
    platrum,
    bitrix,
    bitrixUserTasks,
    bitrixBoardTasks,
    calendarSearchTerms,
    googleWorkspace,
    dailyAssistant,
    memory,
    semanticMemory,
    profiles: buildEmployeeProfiles(state, targetUsers),
    recentDeviceCommands,
    workHistory,
    webResearch,
  };
}

const WEB_RESEARCH_INTENT = /(найди|поищи|загугли|погугли|в\s+интернете|в\s+сети|в\s+гугл|search\s+(the\s+)?web|google\s+it|look\s+up|погод|курс\s+(валют|доллар|евро|рубл|битко)|сколько\s+стоит|новост|последние\s+события|что\s+происходит\s+(в\s+мире|сейчас)|актуальн\w*\s+(цен|курс|новост)|расписани\w*\s+(рейс|поезд)|кто\s+(сейчас|выиграл|победил)|когда\s+(выйдет|выходит|релиз))/iu;

export function isWebResearchQuery(text) {
  return WEB_RESEARCH_INTENT.test(String(text || ""));
}

async function readWebResearchContext({ question, claudeClient, now }) {
  const enabled = process.env.WEB_SEARCH_ENABLED !== "false";
  if (!enabled || !claudeClient?.configured || typeof claudeClient.researchWeb !== "function") {
    return null;
  }
  if (!isWebResearchQuery(question)) {
    return null;
  }
  try {
    const today = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Bishkek",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(now);
    const result = await claudeClient.researchWeb({
      system: [
        `Сегодня ${today} (Asia/Bishkek).`,
        "Найди в интернете актуальную информацию по вопросу пользователя и кратко изложи факты на русском.",
        "Используй web_search и при необходимости web_fetch. Опирайся только на найденное; не выдумывай.",
        "Дай сжатую сводку (5-10 строк) с конкретикой: числа, даты, имена. Не добавляй вступлений.",
      ].join(" "),
      user: String(question),
      maxTokens: 2500,
      timeoutMs: 120000,
      maxSearches: 5,
      includeFetch: false,
    });
    if (!result?.text) {
      return null;
    }
    return {
      query: String(question).slice(0, 300),
      summary: result.text.slice(0, 4000),
      sources: result.sources || [],
      fetchedAt: now.toISOString(),
    };
  } catch (error) {
    console.error("web research failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function resolveActorByTelegramId(state, telegramUserId) {
  const actor = state.users.find((user) => user.telegram?.telegramUserId === String(telegramUserId));
  if (!actor) {
    throw unauthorized("Telegram account is not registered. Use /register CODE.");
  }
  return actor;
}

function resolveActorByUserId(state, userId) {
  const actor = state.users.find((user) => user.id === String(userId));
  if (!actor) {
    throw unauthorized("Local agent is not registered.");
  }
  return actor;
}

function resolveTargetUsers({ state, actor, question, accessibleUsers, visibleDevices }) {
  const normalizedQuestion = normalizeForSearch(question);
  const mentioned = accessibleUsers.filter((user) => {
    const aliases = userAliases(user, visibleDevices);
    return aliases.some((alias) => normalizedQuestion.includes(alias));
  });
  if (mentioned.length) {
    return mentioned;
  }

  if (/\b(все|команд|подчин|пм|pm|менеджер|сотрудник)/iu.test(question)) {
    return accessibleUsers;
  }

  if (actor.role === "PM") {
    return [actor];
  }

  return accessibleUsers.slice(0, Math.min(3, accessibleUsers.length));
}

function userAliases(user, visibleDevices) {
  const aliases = [
    user.id,
    user.displayName,
    user.employeeId,
    String(user.kickidlerEmployeeId || ""),
    ...(USER_ALIASES[user.id] || []),
  ];
  for (const device of visibleDevices) {
    if (device.userId === user.id) {
      aliases.push(device.deviceId, device.displayName, device.hostname);
      if (device.labels?.person) {
        aliases.push(device.labels.person);
      }
    }
  }
  return aliases
    .map(normalizeForSearch)
    .filter((alias) => alias && alias.length >= 2);
}

function resolveRelevantProjects({ state, actor, targetUsers, question }) {
  const normalizedQuestion = normalizeForSearch(question);
  const targetUserIds = new Set(targetUsers.map((user) => user.id));
  return state.projects
    .filter((project) => canAccessProject(state, actor, project))
    .filter((project) => {
      const mentioned =
        normalizedQuestion.includes(normalizeForSearch(project.id)) ||
        normalizedQuestion.includes(normalizeForSearch(project.name));
      const related =
        targetUserIds.has(project.ownerUserId) ||
        targetUserIds.has(project.managerUserId) ||
        project.memberUserIds.some((userId) => targetUserIds.has(userId));
      return mentioned || related || targetUsers.length === 0;
    })
    .slice(0, MAX_CONTEXT_PROJECTS);
}

async function readMetriconContext({ targetUsers, period, kickidlerClient }) {
  const employeeIds = targetUsers
    .map((user) => user.kickidlerEmployeeId)
    .filter((employeeId) => employeeId !== null && employeeId !== undefined);

  if (!employeeIds.length) {
    return { source: "none", configured: false, employees: [], note: "No Metricon employee ids for target users." };
  }

  try {
    const summary = await kickidlerClient.getActivitySummary({
      employeeIds,
      from: period.from,
      to: period.to,
    });
    return {
      source: summary.source,
      configured: summary.configured,
      from: summary.from,
      to: summary.to,
      employees: targetUsers.map((user) => ({
        user: publicUser(user),
        metrics:
          summary.employees.find((item) => String(item.kickidlerEmployeeId) === String(user.kickidlerEmployeeId)) ||
          null,
      })),
    };
  } catch (error) {
    return {
      source: "metricon",
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      employees: [],
    };
  }
}

function stripRawTask(task) {
  const { raw, ...rest } = task;
  void raw;
  return rest;
}

/**
 * Persist external IDs discovered by name search during context reads
 * (Platrum/Bitrix resolve users on the fly when the mapping is missing).
 * Runs inside store.update so the healed mapping is saved for next time.
 */
function persistDiscoveredExternalIds(state, context) {
  for (const entry of context.platrum?.userTasks || []) {
    if (!entry?.user?.id || !entry.platrumUserId) {
      continue;
    }
    const user = state.users.find((item) => item.id === entry.user.id);
    if (user && (user.platrumUserId === null || user.platrumUserId === undefined)) {
      user.platrumUserId = entry.platrumUserId;
      user.platrumUsername = user.platrumUsername ?? entry.platrumUsername ?? null;
    }
  }
  for (const entry of context.bitrixUserTasks || []) {
    if (!entry?.user?.id || !entry.bitrixUserId) {
      continue;
    }
    const user = state.users.find((item) => item.id === entry.user.id);
    if (user && (user.bitrixUserId === null || user.bitrixUserId === undefined)) {
      user.bitrixUserId = entry.bitrixUserId;
    }
  }
}

async function readPlatrumContext({ projects, targetUsers, period, platrumClient }) {
  if (!platrumClient) {
    return {
      source: "none",
      configured: false,
      readOnly: true,
      userTasks: [],
      projectTasks: [],
      note: "Platrum client is not enabled.",
    };
  }

  const userTasks = [];
  for (const user of targetUsers) {
    try {
      const result = await platrumClient.getUserTasks({ user, limit: MAX_TASKS_PER_PROJECT, period });
      const tasks = result.tasks.map((task) => stripRawTask({ ...task, overdue: Boolean(task.overdue) }));
      userTasks.push({
        source: result.source,
        configured: result.configured,
        readOnly: true,
        user: publicUser(user),
        platrumUserId: result.platrumUserId ?? user.platrumUserId ?? null,
        platrumUsername: result.platrumUsername ?? user.platrumUsername ?? null,
        note: result.note ?? null,
        summary: summarizePlatrumTasks(tasks),
        tasks: tasks.slice(0, MAX_TASKS_PER_PROJECT),
      });
    } catch (error) {
      userTasks.push({
        source: "platrum",
        configured: true,
        readOnly: true,
        user: publicUser(user),
        platrumUserId: user.platrumUserId ?? null,
        error: error instanceof Error ? error.message : String(error),
        summary: summarizePlatrumTasks([]),
        tasks: [],
      });
    }
  }

  const projectTasks = [];
  for (const project of projects) {
    try {
      const [tasksResult, reportResult] = await Promise.all([
        platrumClient.getProjectTasks({ project, limit: MAX_TASKS_PER_PROJECT }),
        platrumClient.getProjectReport({ project }),
      ]);
      const tasks = tasksResult.tasks.map((task) => stripRawTask({ ...task, overdue: Boolean(task.overdue) }));
      projectTasks.push({
        source: tasksResult.source,
        configured: tasksResult.configured,
        readOnly: true,
        tasksScope: "all_project_members",
        project: publicProject(project),
        platrumProjectId: tasksResult.platrumProjectId ?? project.platrumProjectId ?? null,
        note: tasksResult.note ?? reportResult.note ?? null,
        summary: summarizePlatrumTasks(tasks),
        projectReport: reportResult.report,
        tasks: tasks.slice(0, MAX_TASKS_PER_PROJECT),
      });
    } catch (error) {
      projectTasks.push({
        source: "platrum",
        configured: true,
        readOnly: true,
        project: publicProject(project),
        platrumProjectId: project.platrumProjectId ?? null,
        error: error instanceof Error ? error.message : String(error),
        summary: summarizePlatrumTasks([]),
        tasks: [],
      });
    }
  }

  // Board-centric view of EVERY task across all kanban boards, including
  // personal boards (board_is_personal=true) that have no project mapping and
  // are therefore invisible to projectTasks. This is the full task picture.
  let boardTasks = [];
  if (platrumClient.getAllTasks) {
    try {
      const all = await platrumClient.getAllTasks({ limit: 300 });
      const tasks = (all.tasks || []).map((task) => stripRawTask({ ...task, overdue: Boolean(task.overdue) }));
      const groups = new Map();
      for (const task of tasks) {
        const key = task.boardId ?? "none";
        if (!groups.has(key)) {
          groups.set(key, {
            boardId: task.boardId ?? null,
            boardName: task.boardName ?? null,
            boardIsPersonal: Boolean(task.boardIsPersonal),
            projectId: task.projectId ?? null,
            tasks: [],
          });
        }
        groups.get(key).tasks.push(task);
      }
      boardTasks = [...groups.values()].map((group) => ({
        ...group,
        summary: summarizePlatrumTasks(group.tasks),
        tasks: group.tasks.slice(0, MAX_TASKS_PER_PROJECT),
      }));
    } catch (error) {
      boardTasks = [{ error: error instanceof Error ? error.message : String(error), tasks: [] }];
    }
  }

  let dailyReports = null;
  let teamMetrics = null;
  try {
    dailyReports = await platrumClient.getDailyReports({ limit: 100 });
  } catch (error) {
    dailyReports = {
      source: "platrum",
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      reports: [],
    };
  }
  try {
    teamMetrics = await platrumClient.getTeamMetrics();
  } catch (error) {
    teamMetrics = {
      source: "platrum",
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      metrics: null,
    };
  }

  // Work schedule from Platrum: the per-employee weekly plan (actual planned
  // week: office/online/hybrid/off + hours) and the recurring named templates
  // ("шаблон графика на неделю"). This complements Google calendar as a schedule
  // source so the assistant can answer "график работы сотрудника" from Platrum.
  let schedule = null;
  if (platrumClient.getAdminWeeklyPlans || platrumClient.getScheduleTemplates) {
    const weekStart = toWeekStartISO(period?.from ? new Date(period.from) : new Date());
    try {
      const [weekly, templates] = await Promise.all([
        platrumClient.getAdminWeeklyPlans
          ? platrumClient.getAdminWeeklyPlans({ weekStart })
          : Promise.resolve({ plans: [] }),
        platrumClient.getScheduleTemplates
          ? platrumClient.getScheduleTemplates()
          : Promise.resolve({ templates: [] }),
      ]);
      schedule = {
        source: "platrum",
        configured: Boolean(platrumClient.configured),
        weekStart,
        weeklyPlans: (weekly.plans || []).slice(0, 40).map(stripRawSchedule),
        templates: (templates.templates || []).slice(0, 20).map(stripRawSchedule),
      };
    } catch (error) {
      schedule = {
        source: "platrum",
        configured: true,
        weekStart,
        error: error instanceof Error ? error.message : String(error),
        weeklyPlans: [],
        templates: [],
      };
    }
  }

  return {
    source: "platrum",
    configured: Boolean(platrumClient.configured),
    readOnly: true,
    period,
    userTasks,
    projectTasks,
    boardTasks,
    dailyReports,
    teamMetrics,
    schedule,
  };
}

// Drop the raw API payload from a normalized schedule/template object before it
// enters the prompt context (the raw doubles the size and adds no signal).
function stripRawSchedule(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  const { raw, ...rest } = entry;
  return rest;
}

const FULL_WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// Explicit, ready-made date facts so the model never computes weekday itself
// (it reliably gets day-of-week off by one). UTC-based to match `now`.
function describeToday(now) {
  const d = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const dow = d.getUTCDay();
  return {
    date: d.toISOString().slice(0, 10),
    weekday: FULL_WEEKDAYS[dow],
    label: `${FULL_WEEKDAYS[dow]}, ${d.getUTCDate()} ${RU_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    weekStartMonday: toWeekStartISO(d),
  };
}

// Monday (ISO YYYY-MM-DD, UTC) of the week containing `date`.
function toWeekStartISO(date) {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  const offset = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

async function readBitrixContext({ projects, bitrixClient }) {
  const reports = [];
  for (const project of projects) {
    try {
      const result = await bitrixClient.getProjectTasks({ project, limit: MAX_TASKS_PER_PROJECT });
      const tasks = result.tasks.map((task) => ({
        ...task,
        overdue: isTaskOverdue(task),
      }));
      reports.push({
        source: result.source,
        configured: result.configured,
        project: publicProject(project),
        summary: summarizeTasks(tasks),
        tasks: tasks.slice(0, MAX_TASKS_PER_PROJECT),
      });
    } catch (error) {
      reports.push({
        source: "bitrix",
        configured: true,
        project: publicProject(project),
        error: error instanceof Error ? error.message : String(error),
        tasks: [],
      });
    }
  }
  return reports;
}

async function readBitrixUserTasksContext({ targetUsers, bitrixClient }) {
  const reports = [];
  if (!bitrixClient?.getUserTasks) {
    return reports;
  }

  for (const user of targetUsers) {
    try {
      const result = await bitrixClient.getUserTasks({ user, limit: MAX_TASKS_PER_PROJECT });
      const tasks = result.tasks.map((task) => ({
        ...task,
        overdue: isTaskOverdue(task),
      }));
      reports.push({
        source: result.source,
        configured: result.configured,
        user: publicUser(user),
        bitrixUserId: result.bitrixUserId ?? user.bitrixUserId ?? null,
        note: result.note ?? null,
        summary: summarizeTasks(tasks),
        tasks: tasks.slice(0, MAX_TASKS_PER_PROJECT),
      });
    } catch (error) {
      reports.push({
        source: "bitrix",
        configured: true,
        user: publicUser(user),
        bitrixUserId: user.bitrixUserId ?? null,
        error: error instanceof Error ? error.message : String(error),
        tasks: [],
      });
    }
  }
  return reports;
}

// Board/kanban-centric view of EVERY Bitrix task across ALL workgroups and
// personal kanban boards (group 0 = "Личные задачи"), newest-first — including
// groups that have no project mapping in our state and are therefore invisible
// to readBitrixContext. Tasks are grouped by workgroup with their kanban column
// (stageName). This is the full, current Bitrix task picture.
async function readBitrixBoardTasksContext({ bitrixClient }) {
  if (!bitrixClient?.getAllTasks) {
    return [];
  }
  try {
    const all = await bitrixClient.getAllTasks({ limit: 200 });
    const tasks = (all.tasks || []).map((task) => ({ ...task, overdue: isTaskOverdue(task) }));
    const groups = new Map();
    for (const task of tasks) {
      const key = task.groupId ? String(task.groupId) : "0";
      if (!groups.has(key)) {
        groups.set(key, {
          groupId: task.groupId ?? null,
          groupName: task.groupName ?? null,
          tasks: [],
        });
      }
      groups.get(key).tasks.push(task);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      summary: summarizeTasks(group.tasks),
      tasks: group.tasks.slice(0, MAX_TASKS_PER_PROJECT),
    }));
  } catch (error) {
    return [{ error: error instanceof Error ? error.message : String(error), tasks: [] }];
  }
}

function resolveGoogleContextUsers({ targetUsers, accessibleUsers, question }) {
  const selected = [];
  const addUser = (user) => {
    if (user && !selected.some((item) => item.id === user.id)) {
      selected.push(user);
    }
  };

  for (const user of targetUsers) {
    addUser(user);
  }

  if (isCalendarQuestion(question)) {
    for (const user of accessibleUsers) {
      addUser(user);
    }
  }

  return selected.slice(0, MAX_GOOGLE_CONTEXT_USERS);
}

function isCalendarQuestion(question) {
  return /\b(calendar|schedule)\b|календар|график|расписани|сводк/u.test(normalizeForSearch(question));
}

function buildCalendarSearchTerms({ question, targetUsers, visibleDevices }) {
  const terms = [];
  const add = (value) => {
    const normalized = String(value || "").trim();
    if (normalized && !terms.some((term) => normalizeForSearch(term) === normalizeForSearch(normalized))) {
      terms.push(normalized);
    }
  };

  add(question);
  for (const phrase of extractCalendarCandidatePhrases(question)) {
    add(phrase);
  }
  for (const user of targetUsers) {
    for (const alias of userAliases(user, visibleDevices)) {
      add(alias);
      add(`${alias} PM`);
      add(`${alias} ПМ`);
    }
  }

  return terms.slice(0, 20);
}

function extractCalendarCandidatePhrases(question) {
  const cleaned = String(question || "")
    .replace(/[?!.,;:]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const phrases = [];
  const patterns = [
    /(?:по|для|про|график|календар[ьяе]?|расписани[ея])\s+([a-zа-яё0-9/ _-]{2,60})/giu,
    /(?:сводк[ауи]\s+по)\s+([a-zа-яё0-9/ _-]{2,60})/giu,
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const phrase = match[1]
        .replace(/\b(?:с|по|за|на|от|до|и|задай|найди|покажи|июня|июль|июля|май|мая)\b.*$/giu, "")
        .trim();
      if (phrase) {
        phrases.push(phrase);
      }
    }
  }
  return phrases;
}

async function readGoogleWorkspaceContext({ users: contextUsers, period, googleOAuthService, calendarSearchTerms }) {
  if (!googleOAuthService) {
    return {
      source: "none",
      configured: false,
      users: [],
      note: "Google OAuth service is not enabled.",
    };
  }

  const users = [];
  for (const user of contextUsers.slice(0, MAX_GOOGLE_CONTEXT_USERS)) {
    try {
      const snapshot = await googleOAuthService.readWorkspaceSnapshot({
        userId: user.id,
        period,
        limits: {
          calendarEvents: 8,
          calendarList: 100,
          calendarSearchTerms,
          sharedCalendarMatches: 8,
          sharedCalendarEvents: 20,
          gmailMessages: 5,
          driveFiles: 8,
        },
      });
      users.push({
        user: publicUser(user),
        ...snapshot,
      });
    } catch (error) {
      users.push({
        user: publicUser(user),
        source: "google",
        configured: true,
        connected: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    source: "google",
    configured: true,
    users,
  };
}

function resolveQuestionPeriod(question, now) {
  const normalized = normalizeForSearch(question);
  const explicitRange = resolveExplicitDateRange(question, now);
  if (explicitRange) {
    return explicitRange;
  }
  const to = now;
  if (normalized.includes("недел") || normalized.includes("week")) {
    return {
      label: "last 7 days",
      from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: to.toISOString(),
    };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { label: "today", from: start.toISOString(), to: end.toISOString() };
}

function resolveExplicitDateRange(question, now) {
  const text = normalizeForSearch(question);
  const monthName = Object.keys(RUSSIAN_MONTHS).join("|");
  const sameMonth = new RegExp(`(?:с\\s*)?(\\d{1,2})\\s*(?:-|по|до)\\s*(\\d{1,2})\\s*(${monthName})`, "iu");
  const sameMonthMatch = text.match(sameMonth);
  if (sameMonthMatch) {
    const month = RUSSIAN_MONTHS[sameMonthMatch[3]];
    return buildDateRange({
      fromDay: sameMonthMatch[1],
      fromMonth: month,
      toDay: sameMonthMatch[2],
      toMonth: month,
      now,
    });
  }

  const explicitMonths = new RegExp(`(?:с\\s*)?(\\d{1,2})\\s*(${monthName})\\s*(?:по|до|-)\\s*(\\d{1,2})\\s*(${monthName})`, "iu");
  const explicitMonthsMatch = text.match(explicitMonths);
  if (explicitMonthsMatch) {
    return buildDateRange({
      fromDay: explicitMonthsMatch[1],
      fromMonth: RUSSIAN_MONTHS[explicitMonthsMatch[2]],
      toDay: explicitMonthsMatch[3],
      toMonth: RUSSIAN_MONTHS[explicitMonthsMatch[4]],
      now,
    });
  }

  const numeric = text.match(/(?:с\s*)?(\d{1,2})[./-](\d{1,2})\s*(?:по|до|-)\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/iu);
  if (numeric) {
    return buildDateRange({
      fromDay: numeric[1],
      fromMonth: numeric[2],
      toDay: numeric[3],
      toMonth: numeric[4],
      year: numeric[5],
      now,
    });
  }

  return null;
}

const RUSSIAN_MONTHS = Object.freeze({
  январь: 1,
  января: 1,
  февраль: 2,
  февраля: 2,
  март: 3,
  марта: 3,
  апрель: 4,
  апреля: 4,
  май: 5,
  мая: 5,
  июнь: 6,
  июня: 6,
  июль: 7,
  июля: 7,
  август: 8,
  августа: 8,
  сентябрь: 9,
  сентября: 9,
  октябрь: 10,
  октября: 10,
  ноябрь: 11,
  ноября: 11,
  декабрь: 12,
  декабря: 12,
});

function buildDateRange({ fromDay, fromMonth, toDay, toMonth, year, now }) {
  const normalizedYear = normalizeYear(year, now);
  const start = buildLocalDate({
    year: normalizedYear,
    month: Number(fromMonth),
    day: Number(fromDay),
    endOfDay: false,
  });
  const end = buildLocalDate({
    year: normalizedYear,
    month: Number(toMonth),
    day: Number(toDay),
    endOfDay: true,
  });
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    return null;
  }
  return {
    label: `${formatLocalDateLabel(normalizedYear, fromMonth, fromDay)}..${formatLocalDateLabel(normalizedYear, toMonth, toDay)}`,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function buildLocalDate({ year, month, day, endOfDay }) {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}+06:00`);
}

function normalizeYear(value, now) {
  if (!value) {
    return now.getFullYear();
  }
  const year = Number(value);
  if (year < 100) {
    return 2000 + year;
  }
  return year;
}

function formatLocalDateLabel(year, month, day) {
  return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function buildSystemPrompt({ detailed = false } = {}) {
  return [
    detailed
      ? "РЕЖИМ ПОДРОБНО: дай развёрнутый, полный ответ — все факты, цифры, разбивку, причины и рекомендации. Сохрани структуру (заголовок + секции), но не сокращай."
      : "ЛАКОНИЧНОСТЬ ПО УМОЛЧАНИЮ: ответ должен быть коротким — главный вывод + 2-4 ключевых факта. Без воды. Подробности пользователь запросит отдельно.",
    "Use context.platrum as the primary source for employees, projects, kanban tasks, daily reports, attendance, metrics and efficiency. Bitrix is legacy/fallback only.",
    "Platrum is read-only. Never claim that you changed, deleted, approved, moved or created a Platrum task.",
    "Ты корпоративный AI-ассистент Starlab Agent.",
    "Отвечай на русском языке, кратко, по делу и как рабочий помощник.",
    "Ты помогаешь владельцу, старшему PM и PM понимать работу команды.",
    "Используй только предоставленный JSON-контекст. Не выдумывай факты.",
    "Если данных нет, прямо скажи, каких данных не хватает.",
    "Всегда учитывай accessPolicy и не раскрывай данные вне доступного scope.",
    "Если Metricon или Bitrix source=mock/configured=false, предупреди, что это тестовые данные.",
    "ПРОДУКТИВНОСТЬ приложений: браузеры (Chrome, Google Chrome, Edge, Firefox, Safari, Opera) и рабочие инструменты (VS Code, Word, Excel, Bitrix24, Telegram, терминалы) считай ПРОДУКТИВНЫМИ. Если Metricon/Kickidler помечает их «некатегоризировано»/непродуктивно — это пробел категоризации трекера, а НЕ низкая продуктивность: не называй время в браузере непродуктивным и не выводи из этого «0% продуктивности». Оценивай по активному времени (activeSeconds) и выполненным задачам, а не по меткам категорий трекера.",
    "ЛАКОНИЧНОСТЬ: отвечай коротко — сначала один понятный вывод, затем только важные факты. Не пересказывай контекст, не перечисляй технические детали (heartbeat, id устройства, имена источников, время по UTC), если об этом не спросили.",
    "Если Google Workspace connected=false, скажи, что сотрудник еще не подключил Google через /google_connect.",
    "Если Google Docs/Sheets text или rows truncated/ограничены, честно скажи, что виден только короткий фрагмент.",
    "Если dailyAssistant содержит план, blockers или metrics, учитывай их как рабочий план дня и текущий прогресс.",
    "Память (context.memory) v2 состоит из секций:",
    "Открытые дела (context.memory.openLoops) — сначала проверь и закрой/обнови их: незавершённые команды, обещания, открытые вопросы. Если вопрос относится к открытому делу, ответь по нему и отметь прогресс.",
    "Известные факты о сотруднике (context.memory.facts) — устойчивые обязательства, предпочтения, привычки и проекты. Учитывай их, но не выдумывай поверх них.",
    "Сводки прошлых дней (context.memory.dailySummaries) — краткий контекст того, что было раньше.",
    "Релевантные старые события (context.memory.relatedEvents) — подобранные по теме вопроса записи журнала (source=journal) и архива (source=archive). Используй их для непрерывности.",
    "Недавние события (context.memory.recentEvents) — последние реплики диалога для краткосрочной непрерывности. If user says 'не открылось', 'то же самое', 'оставшиеся', resolve it from recentEvents, openLoops and recentDeviceCommands.",
    "Use context.recentDeviceCommands to understand whether a local desktop action was queued, claimed, succeeded, failed or expired.",
    "ВАЖНО про атрибуцию задач: platrum.projectTasks содержит задачи ВСЕХ участников проекта, у каждой задачи есть исполнитель (assigneeUsername/assigneeId).",
    "Личные задачи, личная статистика и эффективность сотрудника считаются ТОЛЬКО по задачам, где этот сотрудник является исполнителем: platrum.userTasks либо задачи проекта с совпадающим assignee (сравни с platrumUserId/platrumUsername из userTasks).",
    "НИКОГДА не приписывай сотруднику задачи с другим исполнителем и не считай из них его эффективность. Если у сотрудника ноль личных задач, прямо скажи об этом; задачи проекта с другими исполнителями упоминай отдельно, называя исполнителя.",
    "platrum.boardTasks — это ВСЕ задачи со ВСЕХ канбан-досок, включая личные доски сотрудников (boardIsPersonal=true), у которых нет привязки к проекту и которых НЕТ в projectTasks. Для вопросов «покажи все задачи», «что в работе», «задачи на доске X», «сколько задач всего» опирайся на boardTasks — это полная картина. Каждая группа = одна доска (boardName, boardIsPersonal), внутри tasks с исполнителем, колонкой (columnName) и статусом.",
    "Эффективность по задачам считай как completed / total * 100 только из задач, где сотрудник — исполнитель.",
    "Если в контексте есть context.workHistory — это полная хронология работы сотрудника за период из timeline (диалоги, действия агента, задачи созданы/назначены/завершены, отчёты). Для вопросов вида «что делал(а) за месяц/неделю», «история», «чем занимался» опирайся ПРЕЖДЕ ВСЕГО на workHistory: перечисли реальные события по дням/категориям, сколько задач завершено/поставлено, с кем работал. Не выдумывай — бери факты из workHistory.users[].days и totals.",
    "Если в контексте есть context.webResearch — это свежие данные из интернета по вопросу (summary + sources). Для вопросов про новости, цены/курсы, погоду, актуальные события и любые запросы «найди в интернете» опирайся на context.webResearch.summary и кратко укажи источники (домены) из context.webResearch.sources. Не выдумывай факты поверх найденного.",
    "context.profiles — компактный профиль каждого затронутого сотрудника: роль, руководитель и устойчивые факты по категориям (обязательства, проекты, привычки, предпочтения). Используй профиль как фоновое знание о человеке (кто он, за что отвечает, что обещал, как обычно работает), но НЕ выдумывай сверх перечисленного.",
    "context.semanticMemory — это факты о сотруднике(ах), наиболее РЕЛЕВАНТНЫЕ текущему вопросу (подобраны по смыслу, не по свежести): обещания/коммитменты, предпочтения, привычки, контекст проектов (поле text, category, score). Используй их как долговременную память: если в semanticMemory есть подходящий факт — учитывай его в ответе (например «ты обещал…», «ты предпочитаешь…»). Не выдумывай факты сверх списка.",
    "Не упоминай системные токены, секреты, внутренние webhook-и или пароли.",
    "Never claim that you sent, queued, executed or completed a local device command. Real desktop actions are handled by the server before Claude is called.",
    "НИКОГДА не утверждай, что отправил, передал, поставил в очередь или доставил сообщение сотруднику. НЕ описывай механизм доставки (сервер, OpenClaw, heartbeat, устройство, Telegram сотрудника) и НЕ пиши «доставку выполняет сервер»/«я сам не отправляю».",
    "Отправку сообщений сотрудникам делает ОТДЕЛЬНЫЙ механизм по команде «отправь Имя: текст» (или «отправь всем: текст»). Если ты получил просьбу отправить/передать сообщение сотруднику — значит команда не распозналась. НЕ придумывай доставку: коротко подскажи формат «отправь Имя: текст» и, при необходимости, предложи готовый текст, который пользователь затем отправит этой командой.",
    "Пиши для Telegram: короткий заголовок, затем понятные секции; без Markdown-таблиц, JSON, сырого debug-контекста и непонятных символов.",
    "Каждый ответ должен быть полезным руководителю или сотруднику: сначала вывод, затем факты, затем что проверить дальше.",
    "When Bitrix project tasks are empty, also check bitrixUserTasks. User-assigned tasks can be personal or in a different workgroup.",
    "context.bitrixBoardTasks — это ВСЕ задачи Bitrix со ВСЕХ рабочих групп и канбан-досок (включая личные задачи group 0 = «Личные задачи»), отсортированные по свежести, с именем группы (groupName) и колонкой канбана (stageName). Для вопросов «покажи все задачи по Bitrix», «что в работе», «задачи на канбане», «текущие задачи команды» используй bitrixBoardTasks, а НЕ context.bitrix (там только пара legacy-проектов, отсортированных по старым дедлайнам). bitrix и bitrixUserTasks оставлены как fallback.",
    "For task and project questions, prefer platrum.userTasks and platrum.projectTasks over Bitrix. When the user explicitly asks about Bitrix tasks/kanban, use bitrixBoardTasks for the full current picture.",
    "For employee work schedules and calendar summaries, first check googleWorkspace.users[].sharedCalendars. These are Google 'Other calendars' from connected PM accounts.",
    "context.platrum.schedule — это график работы из Platrum. platrum.schedule.weeklyPlans — недельный план каждого сотрудника на неделю weekStart: days[] с датой, режимом mode (office=офис, online=удалённо, hybrid=гибрид; isOff=true или mode=day_off/off = выходной), временем startTime–endTime, обедом и часами officeHours/onlineHours, status/statusLabel (например утверждён). platrum.schedule.templates — это шаблоны графика («шаблон графика на неделю»): days[] по дням недели (dayName Пн..Вс) с режимом и временем. Для вопросов про график/расписание работы сотрудника (когда работает, во сколько, офис или удалёнка, выходные) используй platrum.schedule.weeklyPlans для конкретной недели, а platrum.schedule.templates — как постоянный график, если недельного плана на эту неделю нет. Используй это ВМЕСТЕ с googleWorkspace.sharedCalendars, а не вместо.",
    "КРИТИЧНО про даты: НИКОГДА не вычисляй день недели сам — ты ошибаешься. Бери день недели ТОЛЬКО из готовых полей: context.today.label/weekday для сегодня, и поле dayName у каждого дня в platrum.schedule.weeklyPlans[].days и .templates[].days. weekStart в platrum.schedule — это всегда ПОНЕДЕЛЬНИК недели (а не воскресенье). Если в weeklyPlans[].days день с этой датой имеет mode!=day_off и isOff=false — это рабочий день, не выходной; не переназначай его в выходной из-за своих расчётов дня недели.",
    "",
    "RESPONSE FORMAT (strict): Reply with ONLY a single JSON object, no markdown, no code fences, no extra prose before or after it.",
    'Shape: {"title": "...", "sections": [{"heading": "...", "lines": ["...", "..."]}], "next_steps": ["..."]}.',
    "title is a short headline for the answer. sections is a list of labeled groups of plain-text lines (no markdown formatting, no JSON, no asterisks). next_steps is a list of short follow-up suggestions and may be an empty array if there is nothing to suggest.",
    "Every line in sections and next_steps must be plain text without any Markdown syntax (no **, ##, -, backticks).",
  ].join(" ");
}

function buildUserPrompt({ question, context, detailed = false }) {
  return [
    detailed
      ? "Пользователь просит ПОДРОБНЫЙ ответ на свой предыдущий вопрос — раскрой максимально полно."
      : "Ответь КРАТКО (главный вывод + ключевые факты).",
    "Primary work system: Platrum. Use Platrum for tasks, projects, daily reports and efficiency before any Bitrix legacy data.",
    "For questions about a specific employee, use platrum.userTasks first, then platrum.projectTasks and platrum.dailyReports.",
    `Вопрос пользователя: ${question}`,
    "",
    "Контекст:",
    JSON.stringify(context, null, 2),
    "",
    "Сформируй ответ. Если вопрос про работу сотрудника, дай:",
    "1. сколько работал/активничал по Metricon, если данные есть;",
    "2. сколько задач всего/открыто/завершено/просрочено по Bitrix, если данные есть;",
    "3. что видно по Calendar/Gmail/Drive/Docs/Sheets, если Google подключен;",
    "4. что видно по dailyAssistant: план дня, blockers, текущие metrics;",
    "5. примерный процент эффективности, если его можно честно посчитать;",
    "6. что нужно проверить дальше.",
    "Оформи ответ как Telegram-сообщение: заголовок, блок 'Коротко', блок 'Детали', блок 'Следующие шаги' при необходимости.",
    "Не используй таблицы Markdown, не вставляй JSON и не показывай технический context целиком.",
    "For questions about a specific employee, use bitrixUserTasks first and project Bitrix data second.",
    "For calendar/schedule questions, combine platrum.schedule (weeklyPlans + templates) with googleWorkspace.sharedCalendars; use sharedCalendars matches before primary calendar events.",
  ].join("\n");
}

function describeAccessPolicy(role) {
  if (role === "OWNER") {
    return "OWNER can access all users, projects, and device agents.";
  }
  if (role === "SENIOR_PM") {
    return "SENIOR_PM can access self and subordinate PM users/projects/devices.";
  }
  return "PM can access only own user/project/device scope.";
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
}

function isTaskOverdue(task) {
  if (!task.deadline || task.statusLabel === "completed") {
    return false;
  }
  const deadline = new Date(task.deadline).getTime();
  return Number.isFinite(deadline) && deadline < Date.now();
}

function recordAssistantPlatrumSnapshots(state, { context, now = new Date() }) {
  if (!context?.platrum) {
    return;
  }
  ensurePlatrumAnalyticsState(state);
  const date = getLocalDateKey(now);
  const reports = context.platrum.dailyReports?.reports || [];
  const teamMetrics = context.platrum.teamMetrics?.metrics || null;

  for (const item of context.platrum.userTasks || []) {
    const tasks = item.tasks || [];
    const userReports = reports.filter((report) => {
      if (item.platrumUserId && String(report.userId) === String(item.platrumUserId)) {
        return true;
      }
      if (item.platrumUsername && String(report.username || "").toLowerCase() === String(item.platrumUsername).toLowerCase()) {
        return true;
      }
      return false;
    });
    const analytics = buildEmployeeKpi({
      user: {
        ...item.user,
        platrumUserId: item.platrumUserId,
      },
      tasks,
      dailyReports: userReports,
      metrics: teamMetrics,
      date,
    });
    upsertById(state.employeeKpiDaily, {
      id: `assistant-platrum-employee-${item.user.id}-${date}`,
      kind: "employee",
      userId: item.user.id,
      platrumUserId: item.platrumUserId ?? null,
      date,
      source: "platrum",
      taskSummary: analytics.taskSummary,
      reportsSubmitted: analytics.reportsSubmitted,
      lateReports: analytics.lateReports,
      efficiencyPercent: analytics.efficiencyPercent,
      confidence: analytics.confidence,
      updatedAt: now.toISOString(),
    });
  }

  for (const item of context.platrum.projectTasks || []) {
    upsertById(state.projectKpiDaily, {
      id: `assistant-platrum-project-${item.project.id}-${date}`,
      kind: "project",
      projectId: item.project.id,
      platrumProjectId: item.platrumProjectId ?? null,
      date,
      source: "platrum",
      taskSummary: item.summary,
      projectReport: item.projectReport || null,
      efficiencyPercent: item.summary?.efficiencyPercent ?? null,
      updatedAt: now.toISOString(),
    });
  }
}

function upsertById(list, value) {
  const index = list.findIndex((item) => item.id === value.id);
  if (index === -1) {
    list.push(value);
  } else {
    list[index] = { ...list[index], ...value };
  }
}

function getLocalDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
