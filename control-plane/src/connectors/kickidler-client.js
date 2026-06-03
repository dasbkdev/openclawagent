import { validation } from "../domain/errors.js";

export function createKickidlerClientFromEnv(env = process.env) {
  const baseUrl = env.METRICON_BASE_URL || env.KICKIDLER_BASE_URL;
  const accessToken = env.METRICON_ACCESS_TOKEN || env.KICKIDLER_ACCESS_TOKEN;
  if (baseUrl && accessToken) {
    return new HttpKickidlerClient({ baseUrl, accessToken });
  }
  return new MockKickidlerClient();
}

export class MockKickidlerClient {
  constructor() {
    this.source = "mock";
    this.configured = false;
  }

  async getActivitySummary({ employeeIds, from, to }) {
    validateReportPeriod(from, to);
    return {
      source: this.source,
      configured: this.configured,
      from,
      to,
      employees: employeeIds.map((employeeId) => {
        const numeric = Number(employeeId) || 0;
        return {
          kickidlerEmployeeId: employeeId,
          activeSeconds: 14400 + numeric * 300,
          idleSeconds: 1200 + numeric * 60,
          lockSeconds: 600,
          topApplications: [
            { name: "IDE", seconds: 7200 },
            { name: "Browser", seconds: 3600 },
          ],
        };
      }),
    };
  }
}

export class HttpKickidlerClient {
  constructor({ baseUrl, accessToken, timeoutMs = 10000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.accessToken = accessToken;
    this.timeoutMs = timeoutMs;
    this.source = "metricon";
    this.configured = true;
  }

  async getActivitySummary({ employeeIds, from, to }) {
    validateReportPeriod(from, to);
    const employees = [];
    for (const employeeId of employeeIds) {
      const url = new URL(`${this.baseUrl}/api/v1/activity/report`);
      url.searchParams.set("employeeId", String(employeeId));
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      const payload = await this.fetchJson(url);
      employees.push({
        kickidlerEmployeeId: employeeId,
        raw: payload,
      });
    }

    return {
      source: this.source,
      configured: this.configured,
      from,
      to,
      employees,
    };
  }

  async fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw validation("Metricon API request failed", {
          status: response.status,
          body: text.slice(0, 1000),
        });
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateReportPeriod(from, to) {
  if (!isIsoDateTime(from) || !isIsoDateTime(to)) {
    throw validation("from and to must be ISO date-time strings");
  }
  if (new Date(from).getTime() > new Date(to).getTime()) {
    throw validation("from must be before to");
  }
}

function isIsoDateTime(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
