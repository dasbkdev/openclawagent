import { createDeviceCommand } from "./device-agents.js";
import { listAccessibleUserIds } from "./policy.js";

const APP_ALIASES = Object.freeze([
  { aliases: ["google chrome", "chrome", "хром", "гугл хром", "браузер"], app: "Google Chrome" },
  { aliases: ["safari", "сафари"], app: "Safari" },
  { aliases: ["telegram", "телеграм", "телегу"], app: "Telegram" },
  { aliases: ["zoom", "зум"], app: "zoom.us" },
  { aliases: ["figma", "фигма"], app: "Figma" },
  { aliases: ["cursor"], app: "Cursor" },
  { aliases: ["vscode", "vs code", "visual studio code"], app: "Visual Studio Code" },
  { aliases: ["terminal", "терминал"], app: "Terminal" },
  { aliases: ["finder", "файндер"], app: "Finder" },
]);

const OPEN_VERBS = /(открой|открыть|запусти|запустить|включи|перейди|зайди|open|launch|start|play)/iu;
const CLOSE_VERBS = /(закрой|закрыть|выключи|заверши|кильни|убей|close|quit|kill)/iu;
const TAB_WORDS = /(вкладк|tab\b)/iu;
const MINIMIZE_WORDS = /(сверн|свора|минимиз|minimi[sz]e)/iu;
// Cyrillic \b is unreliable in JS regex; match "все/всё/all" with explicit
// boundaries instead.
const ALL_WINDOWS_WORDS = /(^|\s)(все|всё|all|everything)(\s|$)|все\s+окн|все\s+прилож/iu;
const SITE_WORDS = /(сайт|site|website|страниц|webpage)/iu;
const KNOWN_SITES = Object.freeze([
  { match: /(facebook|фейсбук|фэйсбук)/iu, url: "https://www.facebook.com" },
  { match: /(instagram|инстаграм|инсту|инста)/iu, url: "https://www.instagram.com" },
  { match: /(\bvk\b|вконтакте|вк\b)/iu, url: "https://vk.com" },
  { match: /(gmail|гмайл|гмаил|джимейл|почт)/iu, url: "https://mail.google.com" },
  { match: /(google|гугл)(?!\s*chrome|\s*хром)/iu, url: "https://www.google.com" },
  { match: /(twitter|твиттер|\bx\.com\b|\bикс\b)/iu, url: "https://x.com" },
  { match: /(github|гитхаб|гит\b)/iu, url: "https://github.com" },
  { match: /(chatgpt|чатгпт|чат\s*гпт|gpt\b)/iu, url: "https://chat.openai.com" },
  { match: /(wikipedia|википеди)/iu, url: "https://ru.wikipedia.org" },
  { match: /(linkedin|линкедин)/iu, url: "https://www.linkedin.com" },
  { match: /(whatsapp|вотсап|ватсап|whats\s*app)/iu, url: "https://web.whatsapp.com" },
  { match: /(netflix|нетфликс)/iu, url: "https://www.netflix.com" },
  { match: /(avito|авито)/iu, url: "https://www.avito.ru" },
  { match: /(yandex|яндекс)/iu, url: "https://ya.ru" },
  { match: /(telegram\s*web|телеграм\s*веб)/iu, url: "https://web.telegram.org" },
]);
const TLD = "com|ru|org|net|io|kg|kz|uz|info|biz|co|app|dev|me|tv|ai|gov|edu|uk|de|fr|pp\\.ua|ua";
const BARE_DOMAIN = new RegExp(`\\b([a-z0-9-]{2,}\\.(?:${TLD}))(\\/[^\\s]*)?\\b`, "iu");
const STOP_APP_WORDS = new Set([
  "приложение", "приложения", "программу", "программа", "окно", "окна", "сайт",
  "на", "в", "во", "мой", "моем", "моём", "компьютере", "компе", "пк", "это",
  "пожалуйста", "сейчас", "app", "application", "the", "please", "now", "window",
  ...["открой","открыть","запусти","запустить","включи","перейди","зайди","закрой","закрыть","выключи","заверши","кильни","убей","open","launch","start","close","quit","kill"],
]);
const SCREENSHOT_WORDS = /(скриншот|скрин|screenshot|screen shot)/iu;
const ACTIVE_WINDOW_WORDS = /(активн(?:ое|ый|ого)?\s+окн|текущее\s+окн|какое\s+окн|active\s+window|frontmost)/iu;
const MUSIC_WORDS = /(песн|музык|трек|music|song)/iu;
const YOUTUBE_WORDS = /(youtube|ютуб|ютюб|ютьюб)/iu;
const DEVICE_FAILURE_FOLLOWUP = /(не\s+открыл|не\s+откры(лос|ва)|не\s+сработ|не\s+получил|не\s+запуст|didn.?t\s+open|not\s+opened|failed)/iu;
const DEVICE_RETRY_CHOICE = /^(?:1|перв(?:ый|ое|ую)|повтори(?:ть)?|снова|запусти\s+снова|поставь\s+снова)$/iu;
const DEVICE_CHOICE_TTL_MS = 15 * 60 * 1000;

export function parseNaturalDeviceAction(text) {
  const raw = String(text || "").trim();
  if (!raw || raw.startsWith("/")) {
    return null;
  }

  const normalized = normalizeHumanText(raw);
  const hasOpenVerb = OPEN_VERBS.test(normalized);
  const hasCloseVerb = CLOSE_VERBS.test(normalized);

  if (SCREENSHOT_WORDS.test(normalized) && /(сделай|покажи|take|make|show|дай)/iu.test(normalized)) {
    return {
      type: "screenshot",
      args: {},
      humanAction: "сделать скриншот",
    };
  }

  if (ACTIVE_WINDOW_WORDS.test(normalized)) {
    return {
      type: "active_window",
      args: {},
      humanAction: "проверить активное окно",
    };
  }

  // Close a browser tab (Ctrl+W) — must win over close_app for "закрой вкладку".
  if (hasCloseVerb && TAB_WORDS.test(normalized)) {
    return {
      type: "hotkey",
      args: { keys: ["ctrl", "w"] },
      humanAction: "закрыть вкладку в браузере",
    };
  }

  // Minimize windows.
  if (MINIMIZE_WORDS.test(normalized)) {
    if (ALL_WINDOWS_WORDS.test(normalized)) {
      return { type: "minimize_all", args: {}, humanAction: "свернуть все окна" };
    }
    return { type: "minimize_window", args: {}, humanAction: "свернуть активное окно" };
  }

  const explicitUrl = extractUrl(raw);
  if (explicitUrl && hasOpenVerb) {
    return {
      type: "open_url",
      args: { url: explicitUrl },
      humanAction: `открыть ссылку ${explicitUrl}`,
    };
  }

  if (hasOpenVerb && (YOUTUBE_WORDS.test(normalized) || MUSIC_WORDS.test(normalized))) {
    const query = extractYouTubeQuery(raw);
    if (query) {
      return {
        type: "play_youtube",
        args: { query, provider: "youtube" },
        humanAction: `запустить на YouTube: ${query}`,
      };
    }

    const url = MUSIC_WORDS.test(normalized)
      ? "https://www.youtube.com/results?search_query=music"
      : "https://www.youtube.com";
    return {
      type: "open_url",
      args: { url },
      humanAction: MUSIC_WORDS.test(normalized)
        ? "открыть YouTube с поиском музыки"
        : "открыть YouTube",
    };
  }

  // Open any website: bare domain ("открой example.com"), or a known site by
  // name ("открой фейсбук"), or "открой сайт X".
  if (hasOpenVerb && !hasCloseVerb) {
    const site = resolveWebsiteUrl(raw, normalized);
    if (site) {
      return {
        type: "open_url",
        args: { url: site },
        humanAction: `открыть сайт ${site}`,
      };
    }
  }

  // Open/close an app: known alias first, then a free-form app name after the
  // verb so ANY installed app works ("закрой Spotify", "открой Postman").
  const appName = resolveAppName(normalized) || extractFreeAppName(raw, { hasOpenVerb, hasCloseVerb });
  if (appName && (hasOpenVerb || hasCloseVerb)) {
    return {
      type: hasCloseVerb ? "close_app" : "open_app",
      args: { app: appName },
      humanAction: `${hasCloseVerb ? "закрыть" : "открыть"} ${appName}`,
    };
  }

  return null;
}

function resolveWebsiteUrl(raw, normalized) {
  const bare = String(raw).match(BARE_DOMAIN);
  if (bare) {
    const dom = bare[0].replace(/[),.;]+$/u, "");
    return /^https?:\/\//iu.test(dom) ? dom : `https://${dom}`;
  }
  const known = KNOWN_SITES.find((s) => s.match.test(normalized));
  if (known) {
    return known.url;
  }
  // "открой сайт <name>" -> treat the name as a .com domain guess.
  if (SITE_WORDS.test(normalized)) {
    const after = String(raw).match(/(?:сайт|site|website|страниц\w*)\s+([a-z0-9.-]{2,})/iu);
    if (after?.[1]) {
      const name = after[1].toLowerCase();
      if (name.includes(".")) {
        return /^https?:\/\//iu.test(name) ? name : `https://${name}`;
      }
      return `https://www.${name}.com`;
    }
  }
  return null;
}

function extractFreeAppName(raw, { hasOpenVerb, hasCloseVerb }) {
  if (!hasOpenVerb && !hasCloseVerb) {
    return null;
  }
  // Take the words after the verb, drop filler/stop words; keep it short to
  // avoid false positives on long sentences.
  const words = String(raw)
    .replace(/[«»"“”]/gu, " ")
    .split(/\s+/u)
    .map((w) => w.trim())
    .filter(Boolean);
  if (words.length === 0 || words.length > 6) {
    return null;
  }
  const verbRe = new RegExp(`^(${OPEN_VERBS.source}|${CLOSE_VERBS.source})`, "iu");
  const verbIdx = words.findIndex((w) => verbRe.test(w));
  const after = (verbIdx >= 0 ? words.slice(verbIdx + 1) : words)
    .filter((w) => !STOP_APP_WORDS.has(w.toLowerCase()));
  const name = after.join(" ").trim();
  if (name.length < 2 || name.length > 40) {
    return null;
  }
  // Reject obvious non-app phrases.
  if (/[?!]/u.test(name) || /\b(почему|как|что|когда|кто|зачем|сколько)\b/iu.test(name)) {
    return null;
  }
  return name;
}

export function tryCreateNaturalDeviceCommand(
  state,
  {
    actor,
    text,
    currentDeviceId = null,
    source = "natural-language",
    now = new Date(),
  },
) {
  const retry = resolveDeviceRetryFollowup(state, { actor, text, now });
  if (retry) {
    const command = createDeviceCommand(
      state,
      {
        deviceId: retry.previous.deviceId,
        type: retry.previous.type,
        args: retry.previous.args || {},
        source,
        ttlSeconds: 300,
      },
      { actor, now },
    );
    return { intent: retry.intent, command, previousCommand: retry.previous };
  }

  const intent = parseNaturalDeviceAction(text);
  if (!intent) {
    return null;
  }

  const target = resolveNaturalTargetPayload(state, {
    actor,
    text,
    currentDeviceId,
  });
  const commandIntent = resolveCommandIntentForTarget(state, target, intent);
  const command = createDeviceCommand(
    state,
    {
      ...target,
      type: commandIntent.type,
      args: commandIntent.args,
      source,
      ttlSeconds: 300,
    },
    { actor, now },
  );

  return { intent: commandIntent, requestedIntent: intent, command };
}

function resolveDeviceRetryFollowup(state, { actor, text, now }) {
  const raw = String(text || "").trim();
  const failureFollowup = DEVICE_FAILURE_FOLLOWUP.test(raw);
  const explicitRetryChoice =
    DEVICE_RETRY_CHOICE.test(raw) &&
    hasRecentDeviceRetryChoice(state, { actor, now });
  if (!failureFollowup && !explicitRetryChoice) {
    return null;
  }

  const nowMs = now.getTime();
  const previous = (state.deviceCommands || [])
    .filter((command) => command.actorUserId === actor.id)
    .filter((command) => ["open_app", "open_url", "open_file", "screenshot", "active_window", "play_youtube"].includes(command.type))
    .filter((command) => {
      const createdAt = new Date(command.createdAt || 0).getTime();
      return Number.isFinite(createdAt) && nowMs - createdAt <= 60 * 60 * 1000;
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];

  if (!previous) {
    return null;
  }

  return {
    previous,
    intent: {
      type: previous.type,
      args: previous.args || {},
      humanAction:
        previous.type === "play_youtube" && previous.args?.query
          ? `повторно запустить на YouTube: ${previous.args.query}`
          : `повторить прошлую команду ${previous.type}`,
    },
  };
}

function hasRecentDeviceRetryChoice(state, { actor, now }) {
  const nowMs = now.getTime();
  return (state.assistantMemory || [])
    .filter((event) => event.userId === actor.id && event.role === "assistant")
    .some((event) => {
      const createdAt = new Date(event.createdAt || 0).getTime();
      if (!Number.isFinite(createdAt) || nowMs - createdAt > DEVICE_CHOICE_TTL_MS) {
        return false;
      }
      const text = String(event.text || "");
      return /(?:^|\n)\s*1[.)]\s*/u.test(text) &&
        /(play_youtube|постав|повтор|запуст|команд)/iu.test(text);
    });
}

export function formatNaturalDeviceCommandQueued({ command, intent }) {
  return [
    "Команда отправлена на локальный OpenClaw.",
    `Действие: ${intent.humanAction}`,
    `Устройство: ${command.deviceDisplayName || command.deviceId}`,
    `Статус: ${command.status}`,
    "",
    "Локальный агент заберет команду в течение нескольких секунд.",
  ].join("\n");
}

function resolveNaturalTargetPayload(state, { actor, text, currentDeviceId }) {
  const mentioned = resolveMentionedDeviceOrUser(state, actor, text);
  if (mentioned?.deviceId) {
    return { deviceId: mentioned.deviceId };
  }
  if (mentioned?.userId) {
    return { userId: mentioned.userId };
  }
  if (currentDeviceId) {
    return { deviceId: currentDeviceId };
  }
  return { userId: actor.id };
}

function resolveMentionedDeviceOrUser(state, actor, text) {
  const haystack = normalizeSearchToken(text);
  if (!haystack) {
    return null;
  }

  const accessibleUserIds = new Set(listAccessibleUserIds(state, actor));
  const deviceMatches = (state.deviceAgents || [])
    .filter((agent) => accessibleUserIds.has(agent.userId))
    .flatMap((agent) =>
      deviceAliases(agent).map((alias) => ({
        kind: "device",
        deviceId: agent.deviceId,
        token: normalizeSearchToken(alias),
      })),
    )
    .filter((match) => match.token.length >= 4 && haystack.includes(match.token))
    .sort((a, b) => b.token.length - a.token.length);
  if (deviceMatches[0]) {
    return { deviceId: deviceMatches[0].deviceId };
  }

  const userMatches = (state.users || [])
    .filter((user) => accessibleUserIds.has(user.id))
    .flatMap((user) =>
      userAliases(user).map((alias) => ({
        kind: "user",
        userId: user.id,
        token: normalizeSearchToken(alias),
      })),
    )
    .filter((match) => match.token.length >= 4 && haystack.includes(match.token))
    .sort((a, b) => b.token.length - a.token.length);
  if (userMatches[0]) {
    return { userId: userMatches[0].userId };
  }

  return null;
}

function resolveCommandIntentForTarget(state, target, intent) {
  if (intent.type !== "play_youtube") {
    return intent;
  }

  if (target.deviceId) {
    const agent = (state.deviceAgents || []).find((item) => item.deviceId === target.deviceId);
    if (agentSupports(agent, "play_youtube")) {
      return intent;
    }
    if (agentSupports(agent, "open_url")) {
      return fallbackYouTubeSearchIntent(intent);
    }
    return intent;
  }

  const userId = target.userId;
  if (userId) {
    const agents = (state.deviceAgents || []).filter((agent) => agent.userId === userId);
    if (agents.some((agent) => agentSupports(agent, "play_youtube"))) {
      return intent;
    }
    if (agents.some((agent) => agentSupports(agent, "open_url"))) {
      return fallbackYouTubeSearchIntent(intent);
    }
  }

  return intent;
}

function fallbackYouTubeSearchIntent(intent) {
  const query = intent.args?.query || "music";
  return {
    type: "open_url",
    args: { url: buildYouTubeSearchUrl(query) },
    humanAction: `открыть точный поиск YouTube: ${query}`,
    fallbackFrom: intent.type,
  };
}

function agentSupports(agent, capability) {
  return Boolean(agent?.capabilities?.includes("command-polling") && agent.capabilities.includes(capability));
}

function resolveAppName(normalizedText) {
  for (const entry of APP_ALIASES) {
    if (entry.aliases.some((alias) => normalizedText.includes(normalizeHumanText(alias)))) {
      return entry.app;
    }
  }
  return null;
}

function extractYouTubeQuery(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const quoted = raw.match(/[«"“](.+?)[»"”]/u);
  if (quoted?.[1]) {
    return cleanYouTubeQuery(quoted[1]);
  }

  const afterSongWord = raw.match(/(?:песню|песня|трек|track|song|composition)\s+(.+)$/iu);
  if (afterSongWord?.[1]) {
    const query = cleanYouTubeQuery(afterSongWord[1]);
    if (query) {
      return query;
    }
  }

  const afterPlayVerb = raw.match(/(?:запусти|запустить|включи|play|start)\s+(.+)$/iu);
  if (afterPlayVerb?.[1]) {
    const query = cleanYouTubeQuery(afterPlayVerb[1]);
    if (query) {
      return query;
    }
  }

  return cleanYouTubeQuery(raw);
}

function cleanYouTubeQuery(value) {
  const query = String(value || "")
    .replace(/\bhttps?:\/\/\S+/giu, " ")
    .replace(/(?:youtube|ютубе?|ютюбе?|ютьюбе?)/giu, " ")
    .replace(/(?:google chrome|chrome|браузере?|хроме?|хром|safari|сафари)/giu, " ")
    .replace(/(?:маке|mac|компьютере|ноуте|устройстве|пк)/giu, " ")
    .replace(/(?:открой|открыть|запусти|запустить|включи|перейди|зайди|open|launch|start|play)/giu, " ")
    .replace(/(?:песню|песня|трек|музыку|music|song|video|видео|любую|любой|какую-нибудь|пожалуйста)/giu, " ")
    .replace(/(^|\s)(?:на|в|и|and|please)(?=\s|$)/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[,.:;\-–—]+|[,.:;\-–—]+$/gu, "")
    .trim();
  return query.length >= 2 ? query : null;
}

function extractUrl(text) {
  const match = String(text || "").match(/\b(?:https?:\/\/|www\.|youtube\.com\/|youtu\.be\/)[^\s<>"']+/iu);
  if (!match) {
    return null;
  }
  const value = match[0].replace(/[),.;]+$/u, "");
  if (/^https?:\/\//iu.test(value)) {
    return value;
  }
  return `https://${value}`;
}

function buildYouTubeSearchUrl(query) {
  const params = new URLSearchParams({ search_query: query });
  return `https://www.youtube.com/results?${params.toString()}`;
}

function deviceAliases(agent) {
  return [
    agent.deviceId,
    agent.displayName,
    agent.hostname,
    agent.labels?.person,
    agent.labels?.role,
  ].filter(Boolean);
}

function userAliases(user) {
  return [
    user.id,
    user.employeeId,
    user.displayName,
    user.displayName?.replace(/\s+/gu, ""),
    user.id?.replace(/^u-/u, ""),
    user.employeeId?.replace(/-/gu, ""),
  ].filter(Boolean);
}

function normalizeHumanText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .trim();
}

function normalizeSearchToken(value) {
  return normalizeHumanText(value)
    .replace(/[\s_@.]+/gu, "")
    .replace(/-/gu, "");
}
