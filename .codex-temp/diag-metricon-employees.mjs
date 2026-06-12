// Read-only Metricon employees diagnostic. Run on the server as:
//   set -a; . /etc/company-control-plane/control-plane.env; set +a; node /tmp/diag-metricon-employees.mjs
// Prints employee IDs/names only. Never prints tokens.
import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";

const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });

const baseUrl = (process.env.METRICON_BASE_URL || process.env.KICKIDLER_BASE_URL || "").replace(/\/$/, "");
let accessToken = process.env.METRICON_ACCESS_TOKEN || process.env.KICKIDLER_ACCESS_TOKEN || "";

if (!baseUrl) {
  console.log("NO_BASE_URL");
  process.exit(0);
}

async function tryFetch(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  return response;
}

async function loginFallback() {
  const username = process.env.METRICON_USERNAME || process.env.KICKIDLER_USERNAME;
  const password = process.env.METRICON_PASSWORD || process.env.KICKIDLER_PASSWORD;
  if (!username || !password) return null;
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: username, password }),
  });
  if (!response.ok) {
    console.log("LOGIN_FALLBACK_FAILED", response.status);
    return null;
  }
  const payload = await response.json();
  return payload.accessToken || payload.access_token || payload?.data?.accessToken || null;
}

const paths = ["/api/v1/employees/available", "/api/v1/employees/company/23"];
for (const p of paths) {
  let response = await tryFetch(p, accessToken);
  if (response.status === 401 || response.status === 403) {
    const fresh = await loginFallback();
    if (fresh) {
      accessToken = fresh;
      response = await tryFetch(p, accessToken);
    }
  }
  console.log("===", p, "->", response.status);
  if (!response.ok) continue;
  const payload = await response.json();
  const list = Array.isArray(payload) ? payload : payload.employees || payload.data || payload.content || [];
  for (const e of Array.isArray(list) ? list : []) {
    console.log(e.id ?? e.employeeId, "|", e.name ?? e.fullName ?? `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim());
  }
}
