// Throwaway READ-ONLY probe of the live Platrum API to discover the work
// schedule / weekly-plan / schedule-template endpoints. GET only. Does NOT print
// tokens. Run on the server:
//   CONTROL_PLANE_CONFIG_DIR=/var/lib/company-control-plane \
//   node /opt/company-control-plane/scripts/linux/probe-platrum-schedule.mjs
import { createSetupService } from "../../src/setup/setup-service.js";
import { HttpPlatrumClient } from "../../src/connectors/platrum-client.js";

const setup = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setup.applyToEnv(process.env, { overwrite: true });

const baseUrl = (process.env.PLATRUM_BASE_URL || "").replace(/\/+$/, "");
if (!baseUrl || !process.env.PLATRUM_USERNAME || !process.env.PLATRUM_PASSWORD) {
  console.log("Platrum is NOT configured");
  process.exit(0);
}
console.log("Platrum base url configured: yes (host:", new URL(baseUrl).host, ")");

const client = new HttpPlatrumClient({
  baseUrl,
  username: process.env.PLATRUM_USERNAME,
  password: process.env.PLATRUM_PASSWORD,
});
const token = await client.getAccessToken();
console.log("login ok:", Boolean(token));

// Find the calling user id (for "my" scoped endpoints).
let me = null;
try { me = await client.getMe(); } catch (e) { console.log("getMe failed:", e.message); }
const myId = me?.id ?? me?.user?.id ?? null;
console.log("me id:", myId, "name:", me?.full_name ?? me?.username ?? "-");

async function get(path, query = {}) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
    return { status: res.status, body };
  } catch (e) {
    return { status: "ERR", body: { error: e.message } };
  }
}

function shape(body) {
  if (Array.isArray(body)) return `array(${body.length})` + (body[0] ? ` first-keys: ${Object.keys(body[0]).join(",")}` : "");
  if (Array.isArray(body?.results)) return `paginated results(${body.results.length})` + (body.results[0] ? ` first-keys: ${Object.keys(body.results[0]).join(",")}` : "");
  if (body && typeof body === "object") return `object keys: ${Object.keys(body).join(",")}`;
  return String(body);
}

// Week start (Monday) for queries that need it.
const now = new Date();
const day = (now.getUTCDay() + 6) % 7;
const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
const weekStart = monday.toISOString().slice(0, 10);
console.log("weekStart:", weekStart);

const candidates = [
  ["/api/v1/work-schedules/my/", {}],
  ["/api/v1/work-schedules/my/", { week_start: weekStart }],
  ["/api/v1/work-schedules/admin/weekly-plans/", {}],
  ["/api/v1/work-schedules/admin/weekly-plans/", { week_start: weekStart }],
  ["/api/v1/work-schedules/team/", {}],
  ["/api/v1/work-schedules/templates/", {}],
  ["/api/v1/work-schedules/admin/templates/", {}],
  ["/api/v1/work-schedules/my/template/", {}],
  ["/api/v1/work-schedules/weekly-plans/", {}],
  ["/api/v1/schedules/", {}],
  ["/api/v1/schedules/weekly/", {}],
];

for (const [path, query] of candidates) {
  const r = await get(path, query);
  const q = Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  console.log(`\n[${r.status}] GET ${path}${q}`);
  if (r.status === 200) {
    console.log("  ", shape(r.body));
    console.log("   sample:", JSON.stringify(r.body).slice(0, 700));
  } else if (r.status !== 404) {
    console.log("  ", JSON.stringify(r.body).slice(0, 200));
  }
}

console.log("\n--- probe done ---");
