import { validation } from "../domain/errors.js";

const DEFAULT_BASE_URL = "https://yougile.com/api-v2";

export function createYouGileClientFromEnv(env = process.env) {
  const enabled = env.YOUGILE_ENABLED === "true";
  const apiKey = String(env.YOUGILE_API_KEY || "").trim();
  const baseUrl = env.YOUGILE_BASE_URL || DEFAULT_BASE_URL;
  if (!enabled || !apiKey) {
    return new DisabledYouGileClient({
      enabled,
      configured: Boolean(apiKey),
      baseUrl,
    });
  }
  return new HttpYouGileClient({
    baseUrl,
    apiKey,
    timeoutMs: Number(env.YOUGILE_TIMEOUT_MS || 15000),
  });
}

export class DisabledYouGileClient {
  constructor({ enabled = false, configured = false, baseUrl = DEFAULT_BASE_URL } = {}) {
    this.source = "yougile";
    this.enabled = enabled;
    this.configured = configured;
    this.baseUrl = baseUrl;
  }

  async getTasks() {
    return {
      source: this.source,
      enabled: this.enabled,
      configured: this.configured,
      tasks: [],
      note: "YouGile connector is intentionally disabled until credentials and mappings are approved.",
    };
  }

  async createTask() {
    throw validation("YouGile connector is disabled. Enable it only after API key and company mappings are configured.");
  }

  async updateTask() {
    throw validation("YouGile connector is disabled. Enable it only after API key and company mappings are configured.");
  }
}

export class HttpYouGileClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, apiKey, timeoutMs = 15000 }) {
    this.source = "yougile";
    this.enabled = true;
    this.configured = Boolean(apiKey);
    this.baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.apiKey = String(apiKey || "").trim();
    this.timeoutMs = timeoutMs;
  }

  async getTasks({ limit = 50, offset = 0, columnId = null, assignedTo = null, title = null } = {}) {
    const payload = await this.requestJson("/task-list", {
      query: {
        limit: normalizeLimit(limit),
        offset: normalizeOffset(offset),
        columnId,
        assignedTo: Array.isArray(assignedTo) ? assignedTo.join(",") : assignedTo,
        title,
        includeDeleted: false,
      },
    });
    return {
      source: this.source,
      enabled: this.enabled,
      configured: this.configured,
      tasks: Array.isArray(payload?.content) ? payload.content : Array.isArray(payload) ? payload : [],
      paging: {
        limit: normalizeLimit(limit),
        offset: normalizeOffset(offset),
        next: payload?.paging?.next || null,
      },
    };
  }

  async createTask({ task, confirmed = false } = {}) {
    assertConfirmed(confirmed);
    if (!task?.title || !String(task.title).trim()) {
      throw validation("YouGile task title is required");
    }
    assertNoDeleteMutation(task);
    return await this.requestJson("/tasks", {
      method: "POST",
      body: task,
    });
  }

  async updateTask({ taskId, changes, confirmed = false } = {}) {
    assertConfirmed(confirmed);
    const normalizedTaskId = requireString(taskId, "taskId");
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw validation("YouGile task changes must be an object");
    }
    assertNoDeleteMutation(changes);
    return await this.requestJson(`/tasks/${encodeURIComponent(normalizedTaskId)}`, {
      method: "PUT",
      body: changes,
    });
  }

  async requestJson(path, { method = "GET", query = {}, body } = {}) {
    if (!this.configured) {
      throw validation("YouGile API key is not configured");
    }
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw validation("YouGile API request failed", {
          status: response.status,
          path,
          body: text.slice(0, 1000),
        });
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertConfirmed(confirmed) {
  if (confirmed !== true) {
    throw validation("YouGile write requires explicit user confirmation");
  }
}

function assertNoDeleteMutation(value) {
  if (value?.deleted === true) {
    throw validation("YouGile delete operations are permanently blocked");
  }
}

function normalizeLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw validation("YouGile limit must be an integer between 1 and 1000");
  }
  return limit;
}

function normalizeOffset(value) {
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    throw validation("YouGile offset must be a non-negative integer");
  }
  return offset;
}

function requireString(value, name) {
  const text = String(value || "").trim();
  if (!text) {
    throw validation(`${name} is required`);
  }
  return text;
}
