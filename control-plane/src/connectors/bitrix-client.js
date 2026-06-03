import { validation } from "../domain/errors.js";

export function createBitrixClientFromEnv(env = process.env) {
  if (env.BITRIX_WEBHOOK_URL) {
    return new HttpBitrixClient({
      webhookUrl: env.BITRIX_WEBHOOK_URL,
      timeoutMs: Number(env.BITRIX_TIMEOUT_MS || 10000),
    });
  }
  return new MockBitrixClient();
}

export class MockBitrixClient {
  constructor() {
    this.source = "mock";
    this.configured = false;
  }

  async getProjectTasks({ project, limit = 20 }) {
    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      tasks: buildMockTasks(project, limit),
    };
  }
}

export class HttpBitrixClient {
  constructor({ webhookUrl, timeoutMs = 10000 }) {
    this.webhookUrl = webhookUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
    this.source = "bitrix";
    this.configured = true;
  }

  async getProjectTasks({ project, limit = 20 }) {
    if (!project.bitrixGroupId) {
      throw validation("Project has no Bitrix group mapping", { projectId: project.id });
    }

    const payload = await this.callMethod("tasks.task.list", {
      order: { DEADLINE: "asc", CHANGED_DATE: "desc" },
      filter: { GROUP_ID: project.bitrixGroupId },
      select: [
        "ID",
        "TITLE",
        "STATUS",
        "DEADLINE",
        "RESPONSIBLE_ID",
        "RESPONSIBLE_NAME",
        "CHANGED_DATE",
        "CLOSED_DATE",
      ],
      start: 0,
    });

    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      tasks: readTasks(payload).slice(0, limit).map(normalizeBitrixTask),
    };
  }

  async callMethod(method, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.webhookUrl}/${method}.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok || payload.error) {
        throw validation("Bitrix API request failed", {
          status: response.status,
          error: payload.error,
          errorDescription: payload.error_description,
          body: text.slice(0, 1000),
        });
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function normalizeBitrixTask(task) {
  const status = normalizeStatus(task.status ?? task.STATUS ?? task.realStatus ?? task.REAL_STATUS);
  return {
    id: String(task.id ?? task.ID ?? ""),
    title: String(task.title ?? task.TITLE ?? "Untitled task"),
    status,
    statusLabel: statusLabel(status),
    deadline: normalizeNullableString(task.deadline ?? task.DEADLINE),
    responsibleId: normalizeNullableString(task.responsibleId ?? task.RESPONSIBLE_ID),
    responsibleName: normalizeNullableString(task.responsibleName ?? task.RESPONSIBLE_NAME),
    changedAt: normalizeNullableString(task.changedDate ?? task.CHANGED_DATE),
    closedAt: normalizeNullableString(task.closedDate ?? task.CLOSED_DATE),
    url: normalizeNullableString(task.url ?? task.URL),
  };
}

function readTasks(payload) {
  const result = payload?.result;
  if (Array.isArray(result?.tasks)) {
    return result.tasks;
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

function normalizeStatus(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function statusLabel(status) {
  switch (status) {
    case 1:
      return "new";
    case 2:
      return "pending";
    case 3:
      return "in_progress";
    case 4:
      return "waiting_control";
    case 5:
      return "completed";
    case 6:
      return "deferred";
    default:
      return "unknown";
  }
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function buildMockTasks(project, limit) {
  const now = Date.now();
  const taskTemplates = [
    ["Prepare weekly status", 3, 24],
    ["Resolve blocker", 2, -8],
    ["Client review notes", 4, 48],
    ["Deployment checklist", 5, -24],
  ];
  return taskTemplates.slice(0, limit).map(([title, status, deadlineHours], index) => ({
    id: `${project.id}-${index + 1}`,
    title,
    status,
    statusLabel: statusLabel(status),
    deadline: new Date(now + Number(deadlineHours) * 60 * 60 * 1000).toISOString(),
    responsibleId: project.ownerUserId,
    responsibleName: project.ownerUserId,
    changedAt: new Date(now - index * 60 * 60 * 1000).toISOString(),
    closedAt: status === 5 ? new Date(now - 2 * 60 * 60 * 1000).toISOString() : null,
    url: null,
  }));
}
