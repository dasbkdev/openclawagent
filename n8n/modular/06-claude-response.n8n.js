const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const input = $input.first().json;
if (input.skip || input.responseText) return [{ json: input }];

const apiKey = readSecret("claudeApiKey");
const model = "claude-sonnet-4-6";
if (!apiKey) return [{ json: { ...input, responseText: "Claude API key не настроен." } }];

if (input.command?.name === "/ai_status") {
  try {
    const check = await callClaude({ apiKey, model, system: "Answer in Russian with one short sentence.", user: "Проверка связи. Ответь: Claude API доступен.", maxTokens: 80 });
    return [{ json: { ...input, responseText: ["Claude API доступен", "", `Model: ${model}`, `Ответ: ${check.text}`].join("\n"), claudeUsage: check.usage || null } }];
  } catch (error) {
    return [{ json: { ...input, responseText: ["Claude API недоступен", "", `Model: ${model}`, error.message].join("\n") } }];
  }
}

const context = {
  now: new Date().toISOString(),
  timezone: "Asia/Bishkek",
  actor: input.actor,
  accessPolicy: input.accessPolicy,
  period: input.period,
  targets: input.targetUsers,
  bitrix: input.bitrix,
  google: input.google,
  devices: input.devices,
};

try {
  const result = await callClaude({
    apiKey,
    model,
    system: [
      "Ты корпоративный AI-ассистент Starlab Agent для Telegram.",
      "Отвечай на русском языке, красиво, понятно и без технического мусора.",
      "Не показывай JSON, токены, webhook-и, внутренние ошибки или debug-контекст.",
      "Структура: короткий заголовок, Коротко, Детали, Что проверить дальше если нужно.",
      "Для Bitrix сначала используй userTasks. Для календарей сначала используй sharedCalendars из Google 'Другие календари'.",
      "Если данных нет, честно скажи каких именно данных не хватает.",
    ].join(" "),
    user: [`Вопрос: ${input.text}`, "", "Контекст:", JSON.stringify(context, null, 2)].join("\n"),
    maxTokens: 1800,
  });
  return [{ json: { ...input, responseText: clean(result.text), claudeUsage: result.usage || null } }];
} catch (error) {
  return [{ json: { ...input, responseText: ["Claude API сейчас не ответил.", "", error.message, "", fallback(context)].join("\n") } }];
}

async function callClaude({ apiKey, model, system, user, maxTokens }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
  });
  const text = await res.text(); const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error?.message || `Claude HTTP ${res.status}`);
  return { text: (payload.content || []).map((item) => item.text || "").join("\n").trim(), usage: payload.usage || null };
}
function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync("/legacy-data/secrets.json", "utf8")); const item = raw.items?.[name]; if (!item) return null;
  const key = Buffer.from(fs.readFileSync("/legacy-data/secrets.key", "utf8").trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.iv, "base64")); decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function fallback(context) {
  const lines = [];
  for (const item of context.bitrix?.userTasks || []) lines.push(`${item.user.displayName}: задач ${item.summary.total}, открыто ${item.summary.open}, завершено ${item.summary.completed}.`);
  for (const account of context.google?.accounts || []) lines.push(`${account.user.displayName}: Google ${account.connected ? "подключен" : "не подключен"}, календарей ${account.calendarList?.count || 0}.`);
  return lines.join("\n") || "Контекст собран, но данных для краткой сводки мало.";
}
function clean(text) { return String(text || "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim(); }
function fetch(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue)); const transport = url.protocol === "http:" ? http : https; const body = options.body || "";
    const headers = { ...(options.headers || {}), "content-length": Buffer.byteLength(body) };
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: `${url.pathname}${url.search}`, method: options.method || "GET", headers }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => { const buffer = Buffer.concat(chunks); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => buffer.toString("utf8") }); });
    });
    req.on("error", reject); req.setTimeout(30000, () => req.destroy(new Error("HTTP request timed out"))); if (body) req.write(body); req.end();
  });
}
