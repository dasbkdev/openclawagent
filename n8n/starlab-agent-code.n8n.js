const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const STATE_PATH = env("LEGACY_STATE_PATH", "/legacy-data/control-plane.json");
const SECRETS_PATH = env("LEGACY_SECRETS_PATH", "/legacy-data/secrets.json");
const SECRETS_KEY_PATH = env("LEGACY_SECRETS_KEY_PATH", "/legacy-data/secrets.key");
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://starlabagent.pp.ua").replace(/\/+$/u, "");
const TELEGRAM_TOKEN = readSecret("telegramBotToken") || env("TELEGRAM_BOT_TOKEN");
const CLAUDE_API_KEY = readSecret("claudeApiKey") || env("CLAUDE_API_KEY") || env("ANTHROPIC_API_KEY");
const CLAUDE_MODEL = env("CLAUDE_MODEL", "claude-sonnet-4-6");
const BITRIX_WEBHOOK_URL = trimSlash(readSecret("bitrixWebhookUrl") || env("BITRIX_WEBHOOK_URL"));
const ELEVENLABS_API_KEY = readSecret("elevenLabsApiKey") || env("ELEVENLABS_API_KEY");
const STT_API_KEY = readSecret("sttApiKey") || env("STT_API_KEY") || ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = env("ELEVENLABS_VOICE_ID");
const OWNER_TOKEN_REPORT_TELEGRAM_ID = env("TOKEN_USAGE_REPORT_TELEGRAM_ID", "984834133");

const input = $input.first()?.json || {};
const update = input.body || input;
await handleTelegramUpdate(update);
return [{ json: { ok: true } }];

async function handleTelegramUpdate(update) {
  const message = update.message || update.edited_message;
  if (!message?.chat?.id) {
    return;
  }

  const chatId = message.chat.id;
  const telegramUserId = String(message.from?.id || "");
  const state = readState();
  const actor = resolveActor(state, telegramUserId);

  try {
    const text = await readMessageText(message);
    const command = parseCommand(text);

    if (!actor && !["/start", "/help"].includes(command.name)) {
      await sendMessage(chatId, [
        "Starlab Agent",
        "",
        "Этот Telegram аккаунт пока не привязан к сотруднику.",
        "Попроси Николая выдать invite-код и отправь:",
        "/register КОД",
      ].join("\n"));
      return;
    }

    switch (command.name) {
      case "/start":
      case "/help":
        await sendHelp(chatId, actor);
        return;
      case "/agents":
        await sendAgents(chatId, state, actor);
        return;
      case "/bitrix":
        await sendBitrixCommand(chatId, state, actor, command.argsText || "");
        return;
      case "/google_connect":
      case "/google":
        await sendGoogleConnect(chatId, actor);
        return;
      case "/google_status":
        await sendGoogleStatus(chatId, actor);
        return;
      case "/ai_status":
        await sendAiStatus(chatId);
        return;
      case "/tokens":
        await sendTokenNotice(chatId, telegramUserId);
        return;
      default:
        if (command.name && command.name.startsWith("/")) {
          await sendMessage(chatId, [
            "Неизвестная команда.",
            "",
            "Используй /help. В меню оставлены только основные команды Starlab Agent.",
          ].join("\n"));
          return;
        }
    }

    if (!text.trim()) {
      await sendHelp(chatId, actor);
      return;
    }

    await sendTyping(chatId);
    const context = await buildBusinessContext({ state, actor, question: text });
    const answer = await answerWithClaude({ question: text, actor, context });
    await sendLongMessage(chatId, answer.text);

    if (wantsVoiceAnswer(text)) {
      await maybeSendVoiceAnswer(chatId, answer.text);
    }
  } catch (error) {
    await sendMessage(chatId, formatError(error));
  }
}

async function readMessageText(message) {
  if (message.text || message.caption) {
    return String(message.text || message.caption || "").trim();
  }
  if (message.voice) {
    return await transcribeTelegramVoice(message.voice);
  }
  return "";
}

function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) {
    return { name: "", argsText: raw, args: [] };
  }
  const [commandRaw, ...args] = raw.split(/\s+/u);
  const name = commandRaw.split("@")[0].toLowerCase();
  return {
    name,
    args,
    argsText: raw.slice(commandRaw.length).trim(),
  };
}

async function sendHelp(chatId, actor) {
  const roleLine = actor ? `Профиль: ${actor.displayName} (${formatRole(actor.role)})` : "Профиль еще не привязан.";
  await sendMessage(chatId, [
    "Starlab Agent",
    roleLine,
    "",
    "Основные команды:",
    "/agents - кто сейчас подключен",
    "/bitrix maksat - задачи сотрудника в Bitrix",
    "/google_connect - подключить Google календарь/Gmail/Drive",
    "/google_status - проверить Google подключение",
    "/ai_status - проверить Claude API",
    "",
    "Можно писать обычным текстом:",
    "Дай сводку Максата за неделю по календарю и Bitrix.",
    "Что по графику Бегайым с 1 по 5 июня?",
    "Какие задачи сейчас у Максата?",
  ].join("\n"));
}

async function sendAgents(chatId, state, actor) {
  const users = accessibleUsers(state, actor);
  const userIds = new Set(users.map((user) => user.id));
  const devices = (state.deviceAgents || []).filter((device) => userIds.has(device.userId));

  if (!devices.length) {
    await sendMessage(chatId, "Агенты устройств пока не выходили на связь.");
    return;
  }

  const lines = ["Агенты устройств", ""];
  for (const [index, device] of devices.entries()) {
    const user = state.users.find((item) => item.id === device.userId);
    lines.push(`${index + 1}. ${user?.displayName || device.userId}`);
    lines.push(`Устройство: ${device.displayName || device.deviceId || "n/a"}`);
    lines.push(`Host: ${device.hostname || "n/a"}`);
    lines.push(`Платформа: ${device.platform || "n/a"}`);
    lines.push(`Статус: ${device.status || "unknown"}`);
    lines.push("");
  }
  await sendLongMessage(chatId, lines.join("\n").trim());
}

async function sendBitrixCommand(chatId, state, actor, argsText) {
  const targets = resolveTargetUsers({ state, actor, question: argsText || "self" });
  const context = await readBitrixContext({ state, actor, targets });
  await sendLongMessage(chatId, formatBitrixSummary(context));
}

async function sendGoogleConnect(chatId, actor) {
  const clientRaw = readSecret("googleOAuthClientJson");
  const stateSecret = readSecret("googleOAuthStateSecret");
  if (!clientRaw || !stateSecret) {
    await sendMessage(chatId, "Google OAuth пока не настроен в setup.");
    return;
  }

  const client = JSON.parse(clientRaw).web || JSON.parse(clientRaw).installed || JSON.parse(clientRaw);
  const redirectUri = `${PUBLIC_BASE_URL}/api/v1/google/oauth/callback`;
  const stateValue = signGoogleState({
    userId: actor.id,
    nonce: crypto.randomBytes(12).toString("base64url"),
    iat: new Date().toISOString(),
  }, stateSecret);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", stateValue);

  await sendMessage(chatId, [
    "Подключение Google",
    "",
    "Открой ссылку, выбери рабочий Google аккаунт и выдай доступы:",
    url.toString(),
    "",
    "После подтверждения Google вернет тебя на сервер, refresh token сохранится в старом зашифрованном хранилище.",
  ].join("\n"), { disableWebPagePreview: true });
}

async function sendGoogleStatus(chatId, actor) {
  const tokens = readGoogleTokens(actor.id);
  if (!tokens?.refreshToken) {
    await sendMessage(chatId, [
      "Google не подключен.",
      "",
      "Используй /google_connect и подключи рабочий аккаунт.",
    ].join("\n"));
    return;
  }
  await sendMessage(chatId, [
    "Google подключен",
    "",
    `Аккаунт: ${tokens.googleAccountEmail || "unknown"}`,
    `Подключен: ${formatDateTime(tokens.connectedAt)}`,
    `Обновлен: ${formatDateTime(tokens.updatedAt)}`,
    `Scopes: ${(tokens.scopes || []).length}`,
  ].join("\n"));
}

async function sendAiStatus(chatId) {
  if (!CLAUDE_API_KEY) {
    await sendMessage(chatId, "Claude API key не настроен.");
    return;
  }
  try {
    const result = await callClaude({
      system: "Answer with one short Russian sentence.",
      user: "Проверка связи. Ответь: Claude API доступен.",
      maxTokens: 80,
    });
    await sendMessage(chatId, [
      "Claude API доступен",
      "",
      `Model: ${CLAUDE_MODEL}`,
      `Ответ: ${result.text}`,
    ].join("\n"));
  } catch (error) {
    await sendMessage(chatId, [
      "Claude API недоступен",
      "",
      `Model: ${CLAUDE_MODEL}`,
      error.message,
      "",
      "Проверь Anthropic Console: API key, billing/credits, регион и доступ к модели.",
    ].join("\n"));
  }
}

async function sendTokenNotice(chatId, telegramUserId) {
  if (String(telegramUserId) !== String(OWNER_TOKEN_REPORT_TELEGRAM_ID)) {
    await sendMessage(chatId, "Отчеты по токенам доступны только владельцу.");
    return;
  }
  const state = readState();
  const events = state.tokenUsageEvents || [];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => new Date(event.createdAt || event.timestamp || 0).getTime() >= since);
  const total = recent.reduce((sum, event) => sum + Number(event.totalTokens || 0), 0);
  await sendMessage(chatId, [
    "Токены за последние 24 часа",
    "",
    `Событий: ${recent.length}`,
    `Токенов всего: ${total}`,
    "",
    "Новая n8n-ветка пока читает старую статистику. Полная запись usage из n8n будет отдельным workflow.",
  ].join("\n"));
}

async function buildBusinessContext({ state, actor, question }) {
  const targets = resolveTargetUsers({ state, actor, question });
  const period = resolvePeriod(question);
  const [bitrix, google] = await Promise.all([
    readBitrixContext({ state, actor, targets, period }),
    readGoogleContext({ state, actor, targets, question, period }),
  ]);
  const devices = readDeviceContext({ state, actor, targets });
  return {
    now: new Date().toISOString(),
    timezone: "Asia/Bishkek",
    actor: publicUser(actor),
    accessPolicy: describeAccess(actor),
    period,
    targets: targets.map(publicUser),
    devices,
    bitrix,
    google,
  };
}

async function answerWithClaude({ question, actor, context }) {
  if (!CLAUDE_API_KEY) {
    return {
      text: [
        "Claude API key не настроен.",
        "",
        "Я собрал контекст, но не могу сформировать AI-ответ. Проверь setup.",
        "",
        formatFallbackContext(context),
      ].join("\n"),
    };
  }

  try {
    const result = await callClaude({
      system: buildSystemPrompt(actor),
      user: [
        `Вопрос пользователя: ${question}`,
        "",
        "Контекст Starlab Agent:",
        JSON.stringify(context, null, 2),
        "",
        "Сформируй красивый и понятный ответ для Telegram на русском языке.",
      ].join("\n"),
      maxTokens: 1800,
    });
    return { text: normalizeTelegramText(result.text), usage: result.usage };
  } catch (error) {
    return {
      text: [
        "Claude API сейчас не ответил.",
        "",
        error.message,
        "",
        "Пока показываю короткую сводку по доступным данным:",
        "",
        formatFallbackContext(context),
      ].join("\n"),
    };
  }
}

function buildSystemPrompt(actor) {
  return [
    "Ты корпоративный AI-ассистент Starlab Agent для Telegram.",
    "Отвечай на русском языке, понятно, аккуратно и без технического мусора.",
    "Не показывай JSON, сырые webhook-и, токены, ключи, пароли, внутренние ошибки и debug-контекст.",
    "Формат: короткий заголовок, блок 'Коротко', блок 'Детали', блок 'Что проверить дальше' только если он нужен.",
    "Не используй Markdown-таблицы. Они плохо читаются в Telegram.",
    "Если данных нет, честно скажи каких именно данных не хватает и где проверять.",
    "Для Bitrix сначала смотри userTasks по ответственному, потом projectTasks по группам.",
    "Для графиков и календарей сотрудников сначала смотри sharedCalendars из Google 'Другие календари'.",
    "Если календарь найден в sharedCalendars, считай это рабочим графиком сотрудника и суммируй события за период.",
    "Эффективность считай только если есть задачи: completed / total * 100. Если данных мало, не выдумывай процент.",
    `Роль автора запроса: ${actor.role}. Соблюдай accessPolicy из контекста.`,
  ].join(" ");
}

async function callClaude({ system, user, maxTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": CLAUDE_API_KEY,
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const details = payload.error?.message || payload.message || text.slice(0, 500);
    throw new Error(`HTTP ${response.status}: ${details}`);
  }
  return {
    text: (payload.content || []).map((item) => item.text || "").join("\n").trim(),
    usage: payload.usage || null,
  };
}

async function readBitrixContext({ state, actor, targets, period }) {
  if (!BITRIX_WEBHOOK_URL) {
    return { configured: false, error: "BITRIX_WEBHOOK_URL is not configured", userTasks: [], projectTasks: [] };
  }
  const visibleProjects = relevantProjects(state, actor, targets);
  const userTasks = [];
  const projectTasks = [];

  for (const user of targets) {
    if (!user.bitrixUserId) {
      userTasks.push({ user: publicUser(user), bitrixUserId: null, tasks: [], summary: emptyTaskSummary(), note: "Bitrix user id не задан." });
      continue;
    }
    try {
      const tasks = await bitrixCall("tasks.task.list", {
        order: { DEADLINE: "asc", CHANGED_DATE: "desc", ID: "desc" },
        filter: { RESPONSIBLE_ID: user.bitrixUserId },
        select: bitrixTaskSelect(),
        start: 0,
      });
      const normalized = readBitrixTasks(tasks).slice(0, 50).map(normalizeBitrixTask);
      userTasks.push({ user: publicUser(user), bitrixUserId: user.bitrixUserId, summary: summarizeTasks(normalized), tasks: normalized.slice(0, 15) });
    } catch (error) {
      userTasks.push({ user: publicUser(user), bitrixUserId: user.bitrixUserId, error: error.message, summary: emptyTaskSummary(), tasks: [] });
    }
  }

  for (const project of visibleProjects) {
    if (!project.bitrixGroupId) {
      continue;
    }
    try {
      const payload = await bitrixCall("tasks.task.list", {
        order: { DEADLINE: "asc", CHANGED_DATE: "desc", ID: "desc" },
        filter: { GROUP_ID: project.bitrixGroupId },
        select: bitrixTaskSelect(),
        start: 0,
      });
      const tasks = readBitrixTasks(payload).slice(0, 50).map(normalizeBitrixTask);
      projectTasks.push({ project: publicProject(project), summary: summarizeTasks(tasks), tasks: tasks.slice(0, 15) });
    } catch (error) {
      projectTasks.push({ project: publicProject(project), error: error.message, summary: emptyTaskSummary(), tasks: [] });
    }
  }

  return {
    configured: true,
    period,
    userTasks,
    projectTasks,
  };
}

async function bitrixCall(method, params) {
  const allowed = new Set(["tasks.task.list", "tasks.task.get", "user.get", "user.search", "sonet_group.get", "socialnetwork.api.workgroup.list"]);
  if (!allowed.has(method)) {
    throw new Error(`Bitrix method blocked by n8n read-only guard: ${method}`);
  }
  const response = await fetch(`${BITRIX_WEBHOOK_URL}/${method}.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(params || {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function bitrixTaskSelect() {
  return [
    "ID",
    "TITLE",
    "GROUP_ID",
    "STAGE_ID",
    "STATUS",
    "DEADLINE",
    "RESPONSIBLE_ID",
    "RESPONSIBLE_NAME",
    "CREATED_BY",
    "CHANGED_DATE",
    "CLOSED_DATE",
  ];
}

function readBitrixTasks(payload) {
  if (Array.isArray(payload?.result?.tasks)) return payload.result.tasks;
  if (Array.isArray(payload?.result)) return payload.result;
  return [];
}

function normalizeBitrixTask(task) {
  const status = Number(task.status ?? task.STATUS ?? task.realStatus ?? task.REAL_STATUS ?? 0);
  const deadline = task.deadline ?? task.DEADLINE ?? null;
  const closedAt = task.closedDate ?? task.CLOSED_DATE ?? null;
  return {
    id: String(task.id ?? task.ID ?? ""),
    title: String(task.title ?? task.TITLE ?? "Без названия"),
    groupId: stringOrNull(task.groupId ?? task.GROUP_ID),
    stageId: stringOrNull(task.stageId ?? task.STAGE_ID),
    status,
    statusLabel: bitrixStatusLabel(status),
    deadline: stringOrNull(deadline),
    responsibleId: stringOrNull(task.responsibleId ?? task.RESPONSIBLE_ID),
    responsibleName: stringOrNull(task.responsibleName ?? task.RESPONSIBLE_NAME),
    changedAt: stringOrNull(task.changedDate ?? task.CHANGED_DATE),
    closedAt: stringOrNull(closedAt),
    overdue: isOverdue({ status, deadline }),
  };
}

function summarizeTasks(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === 5 || task.statusLabel === "completed").length;
  const open = total - completed;
  const overdue = tasks.filter((task) => task.overdue).length;
  return {
    total,
    open,
    completed,
    overdue,
    efficiencyPercent: total ? Math.round((completed / total) * 100) : null,
  };
}

function emptyTaskSummary() {
  return { total: 0, open: 0, completed: 0, overdue: 0, efficiencyPercent: null };
}

function bitrixStatusLabel(status) {
  return ({
    1: "new",
    2: "pending",
    3: "in_progress",
    4: "waiting_control",
    5: "completed",
    6: "deferred",
  })[status] || "unknown";
}

function isOverdue(task) {
  if (!task.deadline || Number(task.status) === 5) return false;
  const time = new Date(task.deadline).getTime();
  return Number.isFinite(time) && time < Date.now();
}

async function readGoogleContext({ state, actor, targets, question, period }) {
  const isCalendar = /календар|график|расписан|calendar|schedule|отработал|работал/iu.test(question);
  if (!isCalendar) {
    return { requested: false, accounts: [] };
  }

  const candidates = googleCandidateUsers(state, actor, targets);
  const searchTerms = buildCalendarSearchTerms({ question, targets });
  const accounts = [];
  for (const user of candidates.slice(0, 6)) {
    const tokens = readGoogleTokens(user.id);
    if (!tokens?.refreshToken) {
      accounts.push({ user: publicUser(user), connected: false });
      continue;
    }
    try {
      const accessToken = await getGoogleAccessToken(tokens);
      const [primary, calendarList] = await Promise.all([
        readGoogleCalendarEvents({ accessToken, calendarId: "primary", period, maxResults: 20 }),
        readGoogleCalendarList({ accessToken }),
      ]);
      const shared = await readMatchingSharedCalendars({ accessToken, calendars: calendarList.calendars, searchTerms, period });
      accounts.push({
        user: publicUser(user),
        connected: true,
        accountEmail: tokens.googleAccountEmail || null,
        primaryCalendar: primary,
        calendarList,
        sharedCalendars: shared,
      });
    } catch (error) {
      accounts.push({ user: publicUser(user), connected: true, error: error.message });
    }
  }
  return {
    requested: true,
    period,
    searchTerms,
    accounts,
  };
}

function googleCandidateUsers(state, actor, targets) {
  const users = [];
  const add = (user) => {
    if (user && !users.some((item) => item.id === user.id)) users.push(user);
  };
  for (const user of targets) add(user);
  for (const user of accessibleUsers(state, actor)) {
    if (readGoogleTokens(user.id)?.refreshToken) add(user);
  }
  return users;
}

async function readGoogleCalendarList({ accessToken }) {
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("minAccessRole", "reader");
  url.searchParams.set("fields", "items(id,summary,summaryOverride,description,primary,accessRole,selected,hidden,timeZone)");
  const payload = await fetchGoogleJson(url, accessToken);
  const calendars = (payload.items || []).map((calendar) => ({
    id: calendar.id || null,
    name: calendar.summaryOverride || calendar.summary || "Без названия",
    summary: calendar.summary || null,
    summaryOverride: calendar.summaryOverride || null,
    description: calendar.description || null,
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole || null,
    selected: Boolean(calendar.selected),
    hidden: Boolean(calendar.hidden),
    timeZone: calendar.timeZone || null,
  }));
  return { count: calendars.length, calendars };
}

async function readMatchingSharedCalendars({ accessToken, calendars, searchTerms, period }) {
  const normalizedTerms = normalizeSearchTerms(searchTerms);
  const matches = (calendars || [])
    .filter((calendar) => !calendar.primary)
    .map((calendar) => {
      const haystack = normalizeSearchText([calendar.name, calendar.summary, calendar.description, calendar.id].filter(Boolean).join(" "));
      const matchedTerms = normalizedTerms.filter((term) => haystack.includes(normalizeSearchText(term)));
      return { calendar, matchedTerms };
    })
    .filter((item) => item.matchedTerms.length)
    .slice(0, 10);

  const result = [];
  for (const item of matches) {
    const events = await readGoogleCalendarEvents({
      accessToken,
      calendarId: item.calendar.id,
      period,
      maxResults: 60,
    });
    result.push({ ...item, events, workSummary: summarizeCalendarWork(events.events) });
  }
  return {
    availableCalendars: (calendars || []).length,
    matchedCalendars: result.length,
    calendars: result,
  };
}

async function readGoogleCalendarEvents({ accessToken, calendarId, period, maxResults }) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", period.from);
  url.searchParams.set("timeMax", period.to);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("fields", "items(id,summary,status,start,end,htmlLink)");
  const payload = await fetchGoogleJson(url, accessToken);
  const events = (payload.items || []).map((event) => ({
    id: event.id || null,
    title: event.summary || "Без названия",
    status: event.status || null,
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    url: event.htmlLink || null,
  }));
  return { calendarId, count: events.length, events };
}

async function fetchGoogleJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      "authorization": `Bearer ${accessToken}`,
      "accept": "application/json",
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error?.message || `Google HTTP ${response.status}`);
  }
  return payload;
}

async function getGoogleAccessToken(tokens) {
  if (tokens.accessToken && !isExpiringSoon(tokens.expiresAt)) {
    return tokens.accessToken;
  }
  const clientRaw = readSecret("googleOAuthClientJson");
  const client = JSON.parse(clientRaw).web || JSON.parse(clientRaw).installed || JSON.parse(clientRaw);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "accept": "application/json" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `Google token refresh HTTP ${response.status}`);
  }
  return payload.access_token;
}

function isExpiringSoon(expiresAt) {
  if (!expiresAt) return true;
  const time = new Date(expiresAt).getTime();
  return !Number.isFinite(time) || time - Date.now() < 2 * 60 * 1000;
}

function summarizeCalendarWork(events) {
  let totalMinutes = 0;
  const byDay = {};
  for (const event of events || []) {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const minutes = Math.round((end - start) / 60000);
    totalMinutes += minutes;
    const day = new Date(start).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" });
    byDay[day] = (byDay[day] || 0) + minutes;
  }
  return {
    eventCount: (events || []).length,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    byDay,
  };
}

function readDeviceContext({ state, actor, targets }) {
  const targetIds = new Set(targets.map((user) => user.id));
  const visibleIds = new Set(accessibleUsers(state, actor).map((user) => user.id));
  return (state.deviceAgents || [])
    .filter((device) => visibleIds.has(device.userId) && (!targetIds.size || targetIds.has(device.userId)))
    .map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      displayName: device.displayName || null,
      hostname: device.hostname || null,
      platform: device.platform || null,
      status: device.status || null,
      lastHeartbeatAt: device.lastHeartbeatAt || device.lastSeenAt || null,
    }));
}

async function transcribeTelegramVoice(voice) {
  if (!STT_API_KEY) {
    throw new Error("Голосовые сообщения пока не настроены: в setup нужен STT API key или ElevenLabs API key.");
  }
  const fileInfo = await telegramApi("getFile", { file_id: voice.file_id });
  const filePath = fileInfo?.file_path;
  if (!filePath) {
    throw new Error("Telegram не вернул file_path для голосового сообщения.");
  }
  const audioResponse = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`);
  if (!audioResponse.ok) {
    throw new Error(`Не удалось скачать voice file: HTTP ${audioResponse.status}`);
  }
  const audioBytes = await audioResponse.arrayBuffer();
  const form = new FormData();
  form.append("model_id", env("STT_MODEL", "scribe_v1"));
  if (env("STT_LANGUAGE_CODE")) {
    form.append("language_code", env("STT_LANGUAGE_CODE"));
  }
  form.append("file", new Blob([audioBytes], { type: "audio/ogg" }), "voice.oga");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": STT_API_KEY },
    body: form,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.detail?.message || payload.message || `STT HTTP ${response.status}`);
  }
  return String(payload.text || "").trim();
}

async function maybeSendVoiceAnswer(chatId, answer) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    await sendMessage(chatId, [
      "Голосовой ответ не отправлен.",
      "",
      "В setup нужно указать ElevenLabs API key и ElevenLabs Voice ID.",
    ].join("\n"));
    return;
  }
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "content-type": "application/json",
      "accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: answer.slice(0, 4500),
      model_id: env("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
    }),
  });
  if (!response.ok) {
    await sendMessage(chatId, `Голосовой ответ не отправлен: ElevenLabs HTTP ${response.status}`);
    return;
  }
  const audioBytes = await response.arrayBuffer();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", "Голосовой ответ Starlab Agent");
  form.append("audio", new Blob([audioBytes], { type: "audio/mpeg" }), "answer.mp3");
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendAudio`, { method: "POST", body: form });
}

function wantsVoiceAnswer(text) {
  return /ответь\s+голос|голосом|voice reply|audio reply/iu.test(text);
}

async function telegramApi(method, payload) {
  if (!TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `Telegram ${method} HTTP ${response.status}`);
  }
  return data.result;
}

async function sendMessage(chatId, text, options = {}) {
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: normalizeTelegramText(text).slice(0, 4090),
    disable_web_page_preview: options.disableWebPagePreview ?? true,
  });
}

async function sendLongMessage(chatId, text) {
  const chunks = splitTelegramText(normalizeTelegramText(text), 3900);
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk);
  }
}

async function sendTyping(chatId) {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    // Non-critical.
  }
}

function splitTelegramText(text, limit) {
  const lines = String(text || "").split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > limit) {
      if (current.trim()) chunks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : ["Готово."];
}

function normalizeTelegramText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function formatFallbackContext(context) {
  const lines = [];
  lines.push(`Период: ${context.period.label}`);
  if (context.targets?.length) {
    lines.push(`Сотрудники: ${context.targets.map((user) => user.displayName).join(", ")}`);
  }
  for (const item of context.bitrix?.userTasks || []) {
    lines.push("");
    lines.push(`Bitrix: ${item.user.displayName}`);
    lines.push(`Всего: ${item.summary.total}, открыто: ${item.summary.open}, завершено: ${item.summary.completed}, просрочено: ${item.summary.overdue}`);
  }
  for (const account of context.google?.accounts || []) {
    lines.push("");
    lines.push(`Google: ${account.user.displayName} (${account.accountEmail || "not connected"})`);
    const shared = account.sharedCalendars;
    if (shared) {
      lines.push(`Другие календари: найдено ${shared.matchedCalendars} из ${shared.availableCalendars}`);
      for (const match of shared.calendars || []) {
        lines.push(`- ${match.calendar.name}: ${match.events.count} событий, ${match.workSummary.totalHours} ч`);
      }
    }
  }
  return lines.join("\n");
}

function formatBitrixSummary(context) {
  const lines = ["Bitrix: задачи", ""];
  if (!context.configured) {
    return "Bitrix webhook не настроен.";
  }
  for (const item of context.userTasks || []) {
    lines.push(item.user.displayName);
    if (item.error) lines.push(`Ошибка: ${item.error}`);
    if (item.note) lines.push(item.note);
    lines.push(`Всего: ${item.summary.total}`);
    lines.push(`Открыто: ${item.summary.open}`);
    lines.push(`Завершено: ${item.summary.completed}`);
    lines.push(`Просрочено: ${item.summary.overdue}`);
    if (item.summary.efficiencyPercent !== null) {
      lines.push(`Эффективность по задачам: ${item.summary.efficiencyPercent}%`);
    }
    if (item.tasks?.length) {
      lines.push("Ближайшие задачи:");
      for (const task of item.tasks.slice(0, 8)) {
        lines.push(`- ${task.title} (${formatBitrixStatus(task.statusLabel)}${task.overdue ? ", просрочено" : ""})`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatBitrixStatus(status) {
  return ({
    new: "новая",
    pending: "ждет выполнения",
    in_progress: "в работе",
    waiting_control: "на проверке",
    completed: "завершена",
    deferred: "отложена",
  })[status] || "неизвестно";
}

function formatError(error) {
  return [
    "Ошибка",
    "",
    error?.message || String(error),
  ].join("\n");
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function readGoogleTokens(userId) {
  const raw = readSecret(`googleOAuthTokens:${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8"));
  const item = raw.items?.[name];
  if (!item) return null;
  return decryptSecret(readSecretKey(), item);
}

function readSecretKey() {
  return Buffer.from(fs.readFileSync(SECRETS_KEY_PATH, "utf8").trim(), "base64");
}

function decryptSecret(key, encrypted) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function signGoogleState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function resolveActor(state, telegramUserId) {
  return (state.users || []).find((user) => String(user.telegram?.telegramUserId || "") === String(telegramUserId)) || null;
}

function accessibleUsers(state, actor) {
  if (!actor) return [];
  if (actor.role === "OWNER") return state.users || [];
  if (actor.role === "SENIOR_PM") {
    return (state.users || []).filter((user) => user.id === actor.id || user.managerId === actor.id);
  }
  return (state.users || []).filter((user) => user.id === actor.id);
}

function resolveTargetUsers({ state, actor, question }) {
  const users = accessibleUsers(state, actor);
  const normalized = normalizeSearchText(question);
  const mentioned = users.filter((user) => userAliases(user).some((alias) => normalized.includes(normalizeSearchText(alias))));
  if (mentioned.length) return mentioned;
  if (/\b(все|команд|pm|пм|сотрудник|подчинен)/iu.test(question)) return users;
  if (actor.role === "PM") return [actor];
  return users.slice(0, Math.min(users.length, 3));
}

function userAliases(user) {
  const aliases = [
    user.id,
    user.employeeId,
    user.displayName,
    user.telegram?.username,
    String(user.kickidlerEmployeeId || ""),
  ];
  if (user.id === "u-nikolay") aliases.push("николай", "николая", "nikolay", "nikolai");
  if (user.id === "u-maksat") aliases.push("максат", "максата", "максату", "maksat", "maksat sultanbiev");
  if (user.id === "u-pm-1") aliases.push("бегайым", "бегайим", "бегайым пм", "begayym", "begoim", "pgaim", "pm1", "project manager 1");
  if (user.id === "u-pm-2") aliases.push("pm2", "project manager 2");
  if (user.id === "u-pm-3") aliases.push("pm3", "project manager 3");
  return aliases.filter(Boolean);
}

function relevantProjects(state, actor, targets) {
  const visibleIds = new Set(accessibleUsers(state, actor).map((user) => user.id));
  const targetIds = new Set(targets.map((user) => user.id));
  return (state.projects || []).filter((project) => {
    if (actor.role === "OWNER") return true;
    if (project.managerUserId === actor.id) return true;
    if ((project.memberUserIds || []).some((id) => visibleIds.has(id))) return true;
    return targetIds.has(project.ownerUserId) || targetIds.has(project.managerUserId);
  }).filter((project) => {
    if (!targetIds.size) return true;
    return targetIds.has(project.ownerUserId) || targetIds.has(project.managerUserId) || (project.memberUserIds || []).some((id) => targetIds.has(id));
  });
}

function publicUser(user) {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    employeeId: user.employeeId,
    managerId: user.managerId,
    bitrixUserId: user.bitrixUserId ?? null,
    kickidlerEmployeeId: user.kickidlerEmployeeId ?? null,
    projectIds: user.projectIds || [],
    telegramLinked: Boolean(user.telegram?.telegramUserId),
  };
}

function publicProject(project) {
  return {
    id: project.id,
    name: project.name,
    bitrixGroupId: project.bitrixGroupId ?? null,
    ownerUserId: project.ownerUserId,
    managerUserId: project.managerUserId,
    memberUserIds: project.memberUserIds || [],
  };
}

function describeAccess(actor) {
  if (actor.role === "OWNER") return "OWNER can access all employees and projects.";
  if (actor.role === "SENIOR_PM") return "SENIOR_PM can access self and subordinate PM employees.";
  return "PM can access only own scope.";
}

function resolvePeriod(question) {
  const text = normalizeSearchText(question);
  const explicit = explicitDateRange(text);
  if (explicit) return explicit;
  if (/недел|week/u.test(text)) {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { label: "последние 7 дней", from: start.toISOString(), to: end.toISOString() };
  }
  const now = new Date();
  return {
    label: "сегодня",
    from: bishkekDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), false).toISOString(),
    to: bishkekDate(now.getFullYear(), now.getMonth() + 1, now.getDate(), true).toISOString(),
  };
}

function explicitDateRange(text) {
  const monthNames = {
    "января": 1, "январь": 1,
    "февраля": 2, "февраль": 2,
    "марта": 3, "март": 3,
    "апреля": 4, "апрель": 4,
    "мая": 5, "май": 5,
    "июня": 6, "июнь": 6,
    "июля": 7, "июль": 7,
    "августа": 8, "август": 8,
    "сентября": 9, "сентябрь": 9,
    "октября": 10, "октябрь": 10,
    "ноября": 11, "ноябрь": 11,
    "декабря": 12, "декабрь": 12,
  };
  const monthPattern = Object.keys(monthNames).join("|");
  let match = text.match(new RegExp(`(?:с\\s*)?(\\d{1,2})\\s*(?:-|по|до)\\s*(\\d{1,2})\\s*(${monthPattern})(?:\\s*(\\d{4}))?`, "iu"));
  if (match) {
    const year = Number(match[4] || new Date().getFullYear());
    const month = monthNames[match[3]];
    return buildRange(year, month, Number(match[1]), month, Number(match[2]));
  }
  match = text.match(/(?:с\s*)?(\d{1,2})[./-](\d{1,2})\s*(?:по|до|-)\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/iu);
  if (match) {
    let year = Number(match[5] || new Date().getFullYear());
    if (year < 100) year += 2000;
    return buildRange(year, Number(match[2]), Number(match[1]), Number(match[4]), Number(match[3]));
  }
  return null;
}

function buildRange(year, fromMonth, fromDay, toMonth, toDay) {
  return {
    label: `${pad(fromDay)}.${pad(fromMonth)}.${year} - ${pad(toDay)}.${pad(toMonth)}.${year}`,
    from: bishkekDate(year, fromMonth, fromDay, false).toISOString(),
    to: bishkekDate(year, toMonth, toDay, true).toISOString(),
  };
}

function bishkekDate(year, month, day, endOfDay) {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`${year}-${pad(month)}-${pad(day)}T${time}+06:00`);
}

function buildCalendarSearchTerms({ question, targets }) {
  const terms = [question];
  for (const user of targets) {
    terms.push(...userAliases(user));
    terms.push(`${user.displayName} PM`);
    terms.push(`${user.displayName} ПМ`);
  }
  for (const phrase of extractNamePhrases(question)) terms.push(phrase);
  return [...new Set(terms.map((term) => String(term || "").trim()).filter(Boolean))].slice(0, 30);
}

function extractNamePhrases(question) {
  const cleaned = String(question || "").replace(/[?!,.;:]+/gu, " ").replace(/\s+/gu, " ").trim();
  const phrases = [];
  const patterns = [
    /(?:по|про|график|календарь|расписание)\s+([a-zа-яё0-9/ _-]{2,60})/giu,
    /(?:сводк[ауи]\s+по)\s+([a-zа-яё0-9/ _-]{2,60})/giu,
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const phrase = match[1].replace(/\b(?:с|по|за|на|от|до|и|июня|июль|мая|неделю|текущую)\b.*$/giu, "").trim();
      if (phrase) phrases.push(phrase);
    }
  }
  return phrases;
}

function normalizeSearchTerms(terms) {
  const result = [];
  for (const term of terms || []) {
    for (const variant of [term, transliterateLatinToCyrillic(term)]) {
      const normalized = String(variant || "").trim();
      if (normalized && !result.some((item) => normalizeSearchText(item) === normalizeSearchText(normalized))) {
        result.push(normalized);
      }
    }
  }
  return result;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function transliterateLatinToCyrillic(value) {
  const source = String(value || "").toLowerCase();
  if (!/[a-z]/u.test(source)) return "";
  const pairs = [
    ["shch", "щ"], ["yo", "е"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
    ["zh", "ж"], ["ch", "ч"], ["sh", "ш"], ["kh", "х"], ["ts", "ц"],
  ];
  let result = source;
  for (const [latin, cyrillic] of pairs) result = result.replaceAll(latin, cyrillic);
  const chars = { a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "и", z: "з" };
  return result.replace(/[a-z]/gu, (char) => chars[char] || char);
}

function formatRole(role) {
  return ({ OWNER: "владелец", SENIOR_PM: "старший PM", PM: "PM" })[role] || role;
}

function formatDateTime(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/u, "");
}

function env(name, fallback = "") {
  try {
    if (typeof $env !== "undefined" && $env && $env[name] !== undefined && $env[name] !== null) {
      return String($env[name]);
    }
  } catch {
    // n8n Code node exposes env through $env; keep a safe fallback for tests.
  }
  return fallback;
}

function fetch(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    const transport = url.protocol === "http:" ? http : https;
    const headers = { ...(options.headers || {}) };
    let body = options.body;

    if (body instanceof URLSearchParams) {
      body = body.toString();
      headers["content-type"] = headers["content-type"] || "application/x-www-form-urlencoded";
    }
    if (body && typeof body !== "string" && !Buffer.isBuffer(body)) {
      body = String(body);
    }
    if (body !== undefined && body !== null) {
      headers["content-length"] = Buffer.byteLength(body);
    }

    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || "GET",
      headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          statusText: response.statusMessage || "",
          headers: response.headers,
          text: async () => buffer.toString("utf8"),
          json: async () => JSON.parse(buffer.toString("utf8") || "{}"),
          arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      });
    });
    request.on("error", reject);
    request.setTimeout(30000, () => request.destroy(new Error("HTTP request timed out")));
    if (body !== undefined && body !== null) {
      request.write(body);
    }
    request.end();
  });
}
