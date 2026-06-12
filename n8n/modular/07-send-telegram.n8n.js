const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const input = $input.first().json;
if (input.skip || !input.chatId) return [{ json: { ok: true, skipped: true } }];

const token = readSecret("telegramBotToken");
const text = normalize(input.responseText || "Готово.");
const chunks = split(text, 3900);
for (const chunk of chunks) {
  await telegram("sendMessage", { chat_id: input.chatId, text: chunk, disable_web_page_preview: true }, token);
}

return [{ json: { ok: true, sent: chunks.length, chatId: input.chatId } }];

async function telegram(method, payload, token) {
  if (!token) throw new Error("telegramBotToken is not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const text = await res.text(); const data = text ? JSON.parse(text) : {};
  if (!res.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} HTTP ${res.status}`);
  return data.result;
}
function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync("/legacy-data/secrets.json", "utf8")); const item = raw.items?.[name]; if (!item) return null;
  const key = Buffer.from(fs.readFileSync("/legacy-data/secrets.key", "utf8").trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.iv, "base64")); decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function normalize(text) { return String(text || "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim(); }
function split(text, limit) {
  const chunks = []; let current = "";
  for (const line of String(text).split("\n")) {
    if ((current + "\n" + line).length > limit) { if (current.trim()) chunks.push(current.trim()); current = line; }
    else current = current ? `${current}\n${line}` : line;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : ["Готово."];
}
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
