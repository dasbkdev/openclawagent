const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const input = $input.first().json;
if (input.skip || input.responseText || !input.needsBitrix) return [{ json: { ...input, bitrix: { requested: false } } }];

const webhookUrl = trimSlash(readSecret("bitrixWebhookUrl"));
if (!webhookUrl) return [{ json: { ...input, bitrix: { requested: true, configured: false, error: "Bitrix webhook is not configured" } } }];

const userTasks = [];
for (const user of input.targetUsers || []) {
  if (!user.bitrixUserId) {
    userTasks.push({ user, summary: summary([]), tasks: [], note: "Bitrix user id не задан." });
    continue;
  }
  try {
    const payload = await bitrixCall(webhookUrl, "tasks.task.list", {
      order: { DEADLINE: "asc", CHANGED_DATE: "desc", ID: "desc" },
      filter: { RESPONSIBLE_ID: user.bitrixUserId },
      select: ["ID", "TITLE", "GROUP_ID", "STAGE_ID", "STATUS", "DEADLINE", "RESPONSIBLE_ID", "RESPONSIBLE_NAME", "CHANGED_DATE", "CLOSED_DATE"],
      start: 0,
    });
    const tasks = readTasks(payload).slice(0, 50).map(normalizeTask);
    userTasks.push({ user, bitrixUserId: user.bitrixUserId, summary: summary(tasks), tasks: tasks.slice(0, 12) });
  } catch (error) {
    userTasks.push({ user, bitrixUserId: user.bitrixUserId, error: error.message, summary: summary([]), tasks: [] });
  }
}

const bitrix = { requested: true, configured: true, userTasks };
let responseText = input.responseText;
if (input.command?.name === "/bitrix") responseText = formatBitrix(bitrix);
return [{ json: { ...input, bitrix, responseText } }];

async function bitrixCall(base, method, params) {
  const allowed = new Set(["tasks.task.list", "tasks.task.get", "user.get", "user.search", "sonet_group.get", "socialnetwork.api.workgroup.list"]);
  if (!allowed.has(method)) throw new Error(`Bitrix method blocked: ${method}`);
  const res = await fetch(`${base}/${method}.json`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(params) });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok || payload.error) throw new Error(payload.error_description || payload.error || `HTTP ${res.status}`);
  return payload;
}

function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync("/legacy-data/secrets.json", "utf8"));
  const item = raw.items?.[name];
  if (!item) return null;
  const key = Buffer.from(fs.readFileSync("/legacy-data/secrets.key", "utf8").trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.iv, "base64"));
  decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function readTasks(payload) { return Array.isArray(payload?.result?.tasks) ? payload.result.tasks : Array.isArray(payload?.result) ? payload.result : []; }
function normalizeTask(task) {
  const status = Number(task.status ?? task.STATUS ?? 0);
  const deadline = task.deadline ?? task.DEADLINE ?? null;
  return {
    id: String(task.id ?? task.ID ?? ""),
    title: String(task.title ?? task.TITLE ?? "Без названия"),
    groupId: nullable(task.groupId ?? task.GROUP_ID),
    stageId: nullable(task.stageId ?? task.STAGE_ID),
    status,
    statusLabel: ({ 1: "new", 2: "pending", 3: "in_progress", 4: "waiting_control", 5: "completed", 6: "deferred" })[status] || "unknown",
    deadline: nullable(deadline),
    responsibleName: nullable(task.responsibleName ?? task.RESPONSIBLE_NAME),
    changedAt: nullable(task.changedDate ?? task.CHANGED_DATE),
    closedAt: nullable(task.closedDate ?? task.CLOSED_DATE),
    overdue: deadline && status !== 5 && new Date(deadline).getTime() < Date.now(),
  };
}
function summary(tasks) {
  const completed = tasks.filter((task) => task.status === 5).length;
  const overdue = tasks.filter((task) => task.overdue).length;
  return { total: tasks.length, open: tasks.length - completed, completed, overdue, efficiencyPercent: tasks.length ? Math.round(completed / tasks.length * 100) : null };
}
function formatBitrix(bitrix) {
  const lines = ["Bitrix: задачи", ""];
  for (const item of bitrix.userTasks || []) {
    lines.push(item.user.displayName);
    if (item.error) lines.push(`Ошибка: ${item.error}`);
    if (item.note) lines.push(item.note);
    lines.push(`Всего: ${item.summary.total}`);
    lines.push(`Открыто: ${item.summary.open}`);
    lines.push(`Завершено: ${item.summary.completed}`);
    lines.push(`Просрочено: ${item.summary.overdue}`);
    if (item.summary.efficiencyPercent !== null) lines.push(`Эффективность: ${item.summary.efficiencyPercent}%`);
    if (item.tasks?.length) {
      lines.push("Ближайшие задачи:");
      for (const task of item.tasks.slice(0, 8)) lines.push(`- ${task.title} (${task.statusLabel}${task.overdue ? ", просрочено" : ""})`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
function nullable(value) { const s = String(value ?? "").trim(); return s || null; }
function trimSlash(value) { return String(value || "").replace(/\/+$/u, ""); }
function fetch(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    const transport = url.protocol === "http:" ? http : https;
    const body = options.body || "";
    const headers = { ...(options.headers || {}), "content-length": Buffer.byteLength(body) };
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: `${url.pathname}${url.search}`, method: options.method || "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => { const buffer = Buffer.concat(chunks); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => buffer.toString("utf8") }); });
    });
    req.on("error", reject); req.setTimeout(30000, () => req.destroy(new Error("HTTP request timed out"))); if (body) req.write(body); req.end();
  });
}
