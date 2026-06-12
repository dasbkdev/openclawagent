const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const input = $input.first().json;
if (input.skip || input.responseText || !input.needsGoogle) return [{ json: { ...input, google: { requested: false } } }];

const accounts = [];
for (const user of googleCandidates(input).slice(0, 6)) {
  const tokens = readGoogleTokens(user.id);
  if (!tokens?.refreshToken) {
    accounts.push({ user, connected: false });
    continue;
  }
  try {
    const accessToken = await getAccessToken(tokens);
    const calendarList = await readCalendarList(accessToken);
    const sharedCalendars = await readSharedCalendars({ accessToken, calendars: calendarList.calendars, terms: calendarTerms(input), period: input.period });
    accounts.push({ user, connected: true, accountEmail: tokens.googleAccountEmail || null, calendarList, sharedCalendars });
  } catch (error) {
    accounts.push({ user, connected: true, error: error.message });
  }
}

const google = { requested: true, period: input.period, accounts };
let responseText = input.responseText;
if (input.command?.name === "/google_status") responseText = formatGoogleStatus(accounts.find((item) => item.user.id === input.actor?.id));
return [{ json: { ...input, google, responseText } }];

function googleCandidates(input) {
  const result = [];
  const add = (user) => { if (user && !result.some((item) => item.id === user.id)) result.push(user); };
  for (const user of input.targetUsers || []) add(user);
  for (const user of input.accessibleUsers || []) if (readGoogleTokens(user.id)?.refreshToken) add(user);
  return result;
}
function calendarTerms(input) {
  const terms = [input.text || ""];
  for (const user of input.targetUsers || []) terms.push(user.displayName, user.employeeId, `${user.displayName} PM`, `${user.displayName} ПМ`);
  return [...new Set(terms.filter(Boolean))];
}
async function readCalendarList(accessToken) {
  const url = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  url.searchParams.set("maxResults", "200");
  url.searchParams.set("minAccessRole", "reader");
  url.searchParams.set("fields", "items(id,summary,summaryOverride,description,primary,accessRole,selected,hidden,timeZone)");
  const payload = await fetchJson(url, accessToken);
  const calendars = (payload.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || "Без названия", summary: c.summary || null, description: c.description || null, primary: Boolean(c.primary), accessRole: c.accessRole || null }));
  return { count: calendars.length, calendars };
}
async function readSharedCalendars({ accessToken, calendars, terms, period }) {
  const normalizedTerms = normalizeTerms(terms);
  const matches = (calendars || []).filter((c) => !c.primary).map((calendar) => {
    const haystack = normalize([calendar.name, calendar.summary, calendar.description, calendar.id].filter(Boolean).join(" "));
    return { calendar, matchedTerms: normalizedTerms.filter((term) => haystack.includes(normalize(term))) };
  }).filter((item) => item.matchedTerms.length).slice(0, 10);
  const result = [];
  for (const match of matches) {
    const events = await readEvents(accessToken, match.calendar.id, period);
    result.push({ ...match, events, workSummary: summarizeEvents(events.events) });
  }
  return { availableCalendars: (calendars || []).length, matchedCalendars: result.length, calendars: result };
}
async function readEvents(accessToken, calendarId, period) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set("timeMin", period.from); url.searchParams.set("timeMax", period.to); url.searchParams.set("singleEvents", "true"); url.searchParams.set("orderBy", "startTime"); url.searchParams.set("maxResults", "60");
  url.searchParams.set("fields", "items(id,summary,status,start,end,htmlLink)");
  const payload = await fetchJson(url, accessToken);
  const events = (payload.items || []).map((e) => ({ id: e.id || null, title: e.summary || "Без названия", status: e.status || null, start: e.start?.dateTime || e.start?.date || null, end: e.end?.dateTime || e.end?.date || null, url: e.htmlLink || null }));
  return { calendarId, count: events.length, events };
}
function summarizeEvents(events) {
  let totalMinutes = 0;
  for (const event of events || []) {
    const start = new Date(event.start).getTime(); const end = new Date(event.end).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) totalMinutes += Math.round((end - start) / 60000);
  }
  return { eventCount: (events || []).length, totalMinutes, totalHours: Math.round(totalMinutes / 6) / 10 };
}
async function getAccessToken(tokens) {
  if (tokens.accessToken && tokens.expiresAt && new Date(tokens.expiresAt).getTime() - Date.now() > 120000) return tokens.accessToken;
  const parsed = JSON.parse(readSecret("googleOAuthClientJson"));
  const client = parsed.web || parsed.installed || parsed;
  const body = new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tokens.refreshToken, grant_type: "refresh_token" });
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const text = await res.text(); const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error_description || payload.error || `Google HTTP ${res.status}`);
  return payload.access_token;
}
async function fetchJson(url, accessToken) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
  const text = await res.text(); const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error?.message || `Google HTTP ${res.status}`);
  return payload;
}
function readGoogleTokens(userId) { const raw = readSecret(`googleOAuthTokens:${userId}`); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
function readSecret(name) {
  const raw = JSON.parse(fs.readFileSync("/legacy-data/secrets.json", "utf8")); const item = raw.items?.[name]; if (!item) return null;
  const key = Buffer.from(fs.readFileSync("/legacy-data/secrets.key", "utf8").trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(item.iv, "base64")); decipher.setAuthTag(Buffer.from(item.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(item.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
function formatGoogleStatus(account) { if (!account?.connected) return "Google не подключен. Используй /google_connect."; return [`Google подключен`, "", `Аккаунт: ${account.accountEmail || "unknown"}`, `Календарей видно: ${account.calendarList?.count || 0}`].join("\n"); }
function normalizeTerms(terms) { return [...new Set((terms || []).map(normalize).filter(Boolean))]; }
function normalize(value) { return String(value || "").toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/giu, " ").replace(/\s+/gu, " ").trim(); }
function fetch(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue)); const transport = url.protocol === "http:" ? http : https; let body = options.body || "";
    if (body instanceof URLSearchParams) body = body.toString(); if (body && typeof body !== "string" && !Buffer.isBuffer(body)) body = String(body);
    const headers = { ...(options.headers || {}) }; if (body) headers["content-length"] = Buffer.byteLength(body);
    const req = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: `${url.pathname}${url.search}`, method: options.method || "GET", headers }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => { const buffer = Buffer.concat(chunks); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => buffer.toString("utf8") }); });
    });
    req.on("error", reject); req.setTimeout(30000, () => req.destroy(new Error("HTTP request timed out"))); if (body) req.write(body); req.end();
  });
}
