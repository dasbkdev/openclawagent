import { validation } from "../domain/errors.js";

const refreshLocks = new Map();

export function createKickidlerClientFromEnv(env = process.env, options = {}) {
  const baseUrl = env.METRICON_BASE_URL || env.KICKIDLER_BASE_URL;
  const accessToken = env.METRICON_ACCESS_TOKEN || env.KICKIDLER_ACCESS_TOKEN;
  const refreshToken = env.METRICON_REFRESH_TOKEN || env.KICKIDLER_REFRESH_TOKEN;
  const username = env.METRICON_USERNAME || env.KICKIDLER_USERNAME || env.METRICON_EMAIL || env.KICKIDLER_EMAIL;
  const password = env.METRICON_PASSWORD || env.KICKIDLER_PASSWORD;
  if (baseUrl && (accessToken || refreshToken || (username && password))) {
    return new HttpKickidlerClient({
      baseUrl,
      accessToken,
      refreshToken,
      username,
      password,
      onTokenRefresh: options.onTokenRefresh,
    });
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

  async listEmployees() {
    return [];
  }
}

export class HttpKickidlerClient {
  constructor({
    baseUrl,
    accessToken,
    refreshToken,
    username = null,
    password = null,
    timeoutMs = 10000,
    onTokenRefresh = null,
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.accessToken = accessToken || null;
    this.refreshToken = refreshToken || null;
    this.username = username || null;
    this.password = password || null;
    this.timeoutMs = timeoutMs;
    this.onTokenRefresh = onTokenRefresh;
    this.source = "metricon";
    this.configured = true;
  }

  async getActivitySummary({ employeeIds, from, to }) {
    validateReportPeriod(from, to);
    const employees = [];
    for (const employeeId of employeeIds) {
      try {
        const payload = await this.requestJson("reports/activity", {
          method: "POST",
          body: {
            employeeId: Number(employeeId),
            from,
            to,
            groupBy: "DAY",
            onlyWorkTime: false,
          },
        });
        const activity = unwrapMetriconData(payload);
        employees.push({
          kickidlerEmployeeId: employeeId,
          ...normalizeActivityReport(activity),
          raw: {
            activity: payload,
          },
        });
      } catch (error) {
        employees.push({
          kickidlerEmployeeId: employeeId,
          activeSeconds: null,
          idleSeconds: null,
          totalSeconds: null,
          topApplications: [],
          error: toPublicMetriconError(error),
        });
      }
    }

    return {
      source: this.source,
      configured: this.configured,
      from,
      to,
      employees,
    };
  }

  async fetchJson(url, options = {}) {
    return await this.requestJson(url, options);
  }

  /**
   * List company employees visible to the service account (read-only).
   * Used to auto-resolve `kickidlerEmployeeId` for new users by name.
   */
  async listEmployees() {
    const payload = await this.requestJson("employees/available", { method: "GET" });
    const list = unwrapMetriconData(payload);
    return (Array.isArray(list) ? list : []).map((item) => ({
      id: item.id ?? item.employeeId ?? null,
      name: item.employeeName ?? item.name ?? null,
      status: item.status ?? null,
    }));
  }

  async requestJson(urlOrPath, options = {}) {
    const url = urlOrPath instanceof URL ? urlOrPath : this.buildApiUrl(urlOrPath);
    const method = options.method || "GET";
    const body = options.body;
    let retriedWithFreshToken = false;
    let retriedWithLogin = false;
    for (;;) {
      const accessToken = await this.getAccessToken();
      const response = await this.fetchWithTimeout(url, {
        method,
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      if (response.ok) {
        return await response.json();
      }

      if (!retriedWithFreshToken && this.refreshToken && response.status === 401) {
        retriedWithFreshToken = true;
        try {
          await this.refreshAccessToken();
          continue;
        } catch (error) {
          if (!this.canLoginAfterRefreshFailure(error)) {
            throw error;
          }
        }
      }

      if (!retriedWithLogin && this.canLogin() && response.status === 401) {
        retriedWithLogin = true;
        await this.login();
        continue;
      }

      const text = await response.text();
      throw validation("Metricon API request failed", {
        status: response.status,
        body: text.slice(0, 1000),
      });
    }
  }

  async getAccessToken() {
    if (this.accessToken) {
      return this.accessToken;
    }
    if (this.refreshToken) {
      try {
        return await this.refreshAccessToken();
      } catch (error) {
        if (this.canLoginAfterRefreshFailure(error)) {
          return await this.login();
        }
        throw error;
      }
    }
    if (this.canLogin()) {
      return await this.login();
    }
    return null;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw validation("Metricon refresh token is not configured");
    }

    const lockKey = `${this.baseUrl}:${this.refreshToken}`;
    if (refreshLocks.has(lockKey)) {
      const tokens = await refreshLocks.get(lockKey);
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken || this.refreshToken;
      return this.accessToken;
    }

    const refreshPromise = this.performRefreshAccessToken();
    refreshLocks.set(lockKey, refreshPromise);
    try {
      const tokens = await refreshPromise;
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken || this.refreshToken;
      return this.accessToken;
    } finally {
      refreshLocks.delete(lockKey);
    }
  }

  async performRefreshAccessToken() {
    const response = await this.fetchWithTimeout(this.buildApiUrl("auth/refresh"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw validation("Metricon token refresh failed", {
        status: response.status,
        body: text.slice(0, 1000),
      });
    }

    const payload = await response.json();
    const tokens = this.normalizeTokenPayload(payload, this.refreshToken);
    if (!tokens.accessToken) {
      throw validation("Metricon token refresh response did not include accessToken");
    }

    if (this.onTokenRefresh) {
      await this.onTokenRefresh(tokens);
    }
    return tokens;
  }

  async login() {
    if (!this.canLogin()) {
      throw validation("Metricon login credentials are not configured");
    }

    const lockKey = `${this.baseUrl}:${this.username}:login`;
    if (refreshLocks.has(lockKey)) {
      const tokens = await refreshLocks.get(lockKey);
      this.applyTokens(tokens);
      return this.accessToken;
    }

    const loginPromise = this.performLogin();
    refreshLocks.set(lockKey, loginPromise);
    try {
      const tokens = await loginPromise;
      this.applyTokens(tokens);
      return this.accessToken;
    } finally {
      refreshLocks.delete(lockKey);
    }
  }

  async performLogin() {
    const response = await this.fetchWithTimeout(this.buildApiUrl("auth/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: this.username,
        password: this.password,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw validation("Metricon login failed", {
        status: response.status,
        body: text.slice(0, 1000),
      });
    }

    const payload = await response.json();
    const tokens = this.normalizeTokenPayload(payload, this.refreshToken);
    if (!tokens.accessToken) {
      throw validation("Metricon login response did not include accessToken");
    }

    if (this.onTokenRefresh) {
      await this.onTokenRefresh(tokens);
    }
    return tokens;
  }

  normalizeTokenPayload(payload, fallbackRefreshToken = null) {
    const data = payload?.data || payload || {};
    return {
      accessToken: data.accessToken || data.access_token || data.token || null,
      refreshToken: data.refreshToken || data.refresh_token || fallbackRefreshToken || null,
      expiresIn: data.expiresIn ?? data.expires_in ?? null,
      tokenType: data.tokenType ?? data.token_type ?? null,
    };
  }

  applyTokens(tokens) {
    this.accessToken = tokens.accessToken || this.accessToken;
    this.refreshToken = tokens.refreshToken || this.refreshToken;
  }

  canLogin() {
    return Boolean(this.username && this.password);
  }

  canLoginAfterRefreshFailure(error) {
    if (!this.canLogin()) {
      return false;
    }
    const details = error?.details || {};
    const body = String(details.body || "");
    return (
      details.status === 400 ||
      details.status === 401 ||
      /REFRESH_TOKEN_REUSE_DETECTED|INVALID_REFRESH|refresh token/iu.test(body)
    );
  }

  buildApiUrl(pathname) {
    const cleanPath = String(pathname).replace(/^\/+/, "");
    const baseHasApiPrefix = /\/api\/v1$/iu.test(this.baseUrl);
    return new URL(`${this.baseUrl}/${baseHasApiPrefix ? "" : "api/v1/"}${cleanPath}`);
  }

  async fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function unwrapMetriconData(payload) {
  return payload?.data || payload || {};
}

function normalizeActivityReport(activity) {
  const topApplications = Array.isArray(activity?.topApplications)
    ? activity.topApplications.map((item) => ({
        name: item.name || item.applicationName || item.title || "Unknown",
        seconds: Number(item.seconds ?? item.totalSeconds ?? item.durationSeconds ?? item.timeSeconds ?? 0),
      }))
    : [];

  const activeSeconds = firstNumber(activity, [
    "totalActiveTime",
    "activeSeconds",
    "activeTime",
    "activitySeconds",
    "productiveSeconds",
  ]);
  const idleSeconds = firstNumber(activity, ["totalIdleTime", "idleSeconds", "idleTime"]);
  const appSeconds = firstNumber(activity, ["totalAppTime", "appSeconds"]);
  const webSeconds = firstNumber(activity, ["totalWebTime", "webSeconds"]);
  const totalSeconds = firstNumber(activity, ["totalSeconds", "totalTime", "workTimeSeconds", "workedSeconds"]);

  return {
    employeeName: activity?.employeeName || null,
    activeSeconds,
    idleSeconds,
    appSeconds,
    webSeconds,
    totalSeconds: totalSeconds ?? sumNumbers([activeSeconds, idleSeconds]),
    topApplications,
  };
}

function firstNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function sumNumbers(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function toPublicMetriconError(error) {
  const details = error?.details || {};
  return {
    message: error instanceof Error ? error.message : String(error),
    status: details.status || null,
    code: readMetriconErrorCode(details.body),
  };
}

function readMetriconErrorCode(body) {
  if (!body) {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.code || parsed?.code || null;
  } catch {
    return null;
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
