const fs = require("fs");
const crypto = require("crypto");
const { URL } = require("url");

const input = $input.first().json;
if (input.skip) return [{ json: input }];

const STATE_PATH = "/legacy-data/control-plane.json";
const SECRETS_PATH = "/legacy-data/secrets.json";
const SECRETS_KEY_PATH = "/legacy-data/secrets.key";
const PUBLIC_BASE_URL = "https://starlabagent.pp.ua";

const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
const actor = resolveActor(state, input.telegramUserId);
const command = input.command || { name: "", argsText: "" };

if (!actor && !["/start", "/help"].includes(command.name)) {
  return [{ json: { ...input, responseText: [
    "Starlab Agent",
    "",
    "Этот Telegram аккаунт пока не привязан к сотруднику.",
    "Попроси Николая выдать invite-код и отправь:",
    "/register КОД",
  ].join("\n") } }];
}

const accessible = actor ? accessibleUsers(state, actor) : [];
const question = command.argsText || input.text || "";
const targets = actor ? resolveTargetUsers({ state, actor, question }) : [];
const period = resolvePeriod(input.text || "");

let responseText = null;
if (["/start", "/help"].includes(command.name)) {
  responseText = [
    "Starlab Agent",
    actor ? `Профиль: ${actor.displayName} (${formatRole(actor.role)})` : "Профиль еще не привязан.",
    "",
    "Основные команды:",
    "/agents - подключенные устройства",
    "/bitrix maksat - задачи сотрудника в Bitrix",
    "/google_connect - подключить Google",
    "/google_status - статус Google",
    "/ai_status - проверка Claude",
    "",
    "Можно писать обычным текстом:",
    "Какие задачи сейчас у Максата?",
    "Дай график Бегайым с 1 по 5 июня.",
  ].join("\n");
}

if (command.name === "/google_connect" && actor) {
  responseText = buildGoogleConnect(actor);
}

if (command.name === "/tokens") {
  const events = state.tokenUsageEvents || [];
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => new Date(event.createdAt || event.timestamp || 0).getTime() >= since);
  const total = recent.reduce((sum, event) => sum + Number(event.totalTokens || 0), 0);
  responseText = [
    "Токены за последние 24 часа",
    "",
    `Событий: ${recent.length}`,
    `Токенов всего: ${total}`,
  ].join("\n");
}

return [{
  json: {
    ...input,
    actor: actor ? publicUser(actor) : null,
    accessPolicy: actor ? describeAccess(actor) : null,
    accessibleUsers: accessible.map(publicUser),
    targetUsers: targets.map(publicUser),
    period,
    responseText,
    needsBitrix: !responseText && needsBitrix(input.text, command),
    needsGoogle: !responseText && needsGoogle(input.text, command),
    needsDevices: !responseText && (command.name === "/agents" || /агент|устройств|device|компьютер/iu.test(input.text || "")),
    needsClaude: !responseText && !["/agents", "/bitrix", "/google_status"].includes(command.name),
  },
}];

function resolveActor(state, telegramUserId) {
  return (state.users || []).find((user) => String(user.telegram?.telegramUserId || "") === String(telegramUserId)) || null;
}

function accessibleUsers(state, actor) {
  if (actor.role === "OWNER") return state.users || [];
  if (actor.role === "SENIOR_PM") return (state.users || []).filter((user) => user.id === actor.id || user.managerId === actor.id);
  return (state.users || []).filter((user) => user.id === actor.id);
}

function resolveTargetUsers({ state, actor, question }) {
  const users = accessibleUsers(state, actor);
  const normalized = normalize(question);
  const mentioned = users.filter((user) => aliases(user).some((alias) => normalize(alias) && normalized.includes(normalize(alias))));
  if (mentioned.length) return mentioned;
  if (/\b(все|команд|pm|пм|сотрудник|подчинен)/iu.test(question)) return users;
  if (actor.role === "PM") return [actor];
  return users.slice(0, Math.min(users.length, 3));
}

function aliases(user) {
  const base = [user.id, user.employeeId, user.displayName, user.telegram?.username, String(user.kickidlerEmployeeId || "")];
  if (user.id === "u-nikolay") base.push("николай", "николая", "nikolay", "nikolai");
  if (user.id === "u-maksat") base.push("максат", "максата", "максату", "maksat");
  if (user.id === "u-pm-1") base.push("бегайым", "бегайим", "бегайым пм", "begayym", "begoim", "pm1");
  return base.filter(Boolean);
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

function needsBitrix(text, command) {
  return command.name === "/bitrix" || /битрикс|bitrix|задач|таск|проект|канбан|просроч/iu.test(text || "");
}

function needsGoogle(text, command) {
  return command.name === "/google_status" || /google|календар|график|расписан|отработал|gmail|drive|docs|sheets/iu.test(text || "");
}

function buildGoogleConnect(actor) {
  const clientRaw = readSecret("googleOAuthClientJson");
  const stateSecret = readSecret("googleOAuthStateSecret");
  if (!clientRaw || !stateSecret) return "Google OAuth пока не настроен в setup.";
  const parsed = JSON.parse(clientRaw);
  const client = parsed.web || parsed.installed || parsed;
  const redirectUri = `${PUBLIC_BASE_URL}/api/v1/google/oauth/callback`;
  const stateValue = signState({ userId: actor.id, nonce: crypto.randomBytes(12).toString("base64url"), iat: new Date().toISOString() }, stateSecret);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [
    "openid", "email", "profile",
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
  return ["Подключение Google", "", "Открой ссылку и выдай доступы:", url.toString()].join("\n");
}

function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync(SECRETS_PATH, "utf8"));
  const item = raw.items?.[name];
  if (!item) return null;
  const key = Buffer.from(fs.readFileSync(SECRETS_KEY_PATH, "utf8").trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.iv, "base64"));
  decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function describeAccess(actor) {
  if (actor.role === "OWNER") return "OWNER can access all employees and projects.";
  if (actor.role === "SENIOR_PM") return "SENIOR_PM can access self and subordinate PM employees.";
  return "PM can access only own scope.";
}

function resolvePeriod(text) {
  const explicit = explicitDateRange(normalize(text));
  if (explicit) return explicit;
  if (/недел|week/u.test(normalize(text))) {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    return { label: "последние 7 дней", from: start.toISOString(), to: end.toISOString() };
  }
  const now = new Date();
  return { label: "сегодня", from: bishkek(now, false).toISOString(), to: bishkek(now, true).toISOString() };
}

function explicitDateRange(text) {
  const m = text.match(/(?:с\s*)?(\d{1,2})[./-](\d{1,2})\s*(?:по|до|-)\s*(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/iu);
  if (!m) return null;
  let year = Number(m[5] || new Date().getFullYear());
  if (year < 100) year += 2000;
  return {
    label: `${m[1]}.${m[2]}.${year} - ${m[3]}.${m[4]}.${year}`,
    from: new Date(`${year}-${pad(m[2])}-${pad(m[1])}T00:00:00.000+06:00`).toISOString(),
    to: new Date(`${year}-${pad(m[4])}-${pad(m[3])}T23:59:59.999+06:00`).toISOString(),
  };
}

function bishkek(date, end) {
  return new Date(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${end ? "23:59:59.999" : "00:00:00.000"}+06:00`);
}

function pad(value) { return String(value).padStart(2, "0"); }
function formatRole(role) { return ({ OWNER: "владелец", SENIOR_PM: "старший PM", PM: "PM" })[role] || role; }
function normalize(value) { return String(value || "").toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/giu, " ").replace(/\s+/gu, " ").trim(); }
