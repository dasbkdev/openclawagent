import { validation } from "../domain/errors.js";

export const READ_ONLY_BITRIX_METHODS = Object.freeze([
  "profile",
  "scope",
  "tasks.task.get",
  "tasks.task.getfields",
  "tasks.task.list",
  "task.item.getdata",
  "task.item.list",
  "sonet_group.get",
  "socialnetwork.api.workgroup.get",
  "socialnetwork.api.workgroup.list",
  "user.get",
  "user.search",
  "crm.category.list",
  "crm.deal.get",
  "crm.deal.list",
  "crm.dealcategory.list",
  "crm.dealcategory.stage.list",
  "crm.item.get",
  "crm.item.list",
  "crm.lead.get",
  "crm.lead.list",
  "crm.stage.list",
  "crm.status.list",
  "crm.type.get",
  "crm.type.list",
]);

const READ_ONLY_BITRIX_METHOD_SET = new Set(READ_ONLY_BITRIX_METHODS);

export function createBitrixClientFromEnv(env = process.env) {
  if (env.BITRIX_WEBHOOK_URL) {
    return new HttpBitrixClient({
      webhookUrl: env.BITRIX_WEBHOOK_URL,
      timeoutMs: Number(env.BITRIX_TIMEOUT_MS || 10000),
    });
  }
  return new MockBitrixClient();
}

export function assertReadOnlyBitrixMethod(method) {
  const normalized = normalizeBitrixMethodName(method);
  if (!READ_ONLY_BITRIX_METHOD_SET.has(normalized)) {
    throw validation("Bitrix REST method is blocked by read-only guard", {
      method: normalized || String(method ?? ""),
      allowedMethods: READ_ONLY_BITRIX_METHODS,
    });
  }
  return normalized;
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

  async getUserTasks({ user, limit = 20 }) {
    return {
      source: this.source,
      configured: this.configured,
      userId: user.id,
      bitrixUserId: user.bitrixUserId ?? null,
      tasks: buildMockTasks({ id: `user-${user.id}`, ownerUserId: user.id }, limit),
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
        "GROUP_ID",
        "STAGE_ID",
        "STATUS",
        "DEADLINE",
        "RESPONSIBLE_ID",
        "RESPONSIBLE_NAME",
        "CREATED_BY",
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

  /**
   * Resolve the Bitrix user for a control-plane user. Uses the stored
   * mapping when present; otherwise searches the company directory by
   * name through the admin webhook (`user.search` is in the read-only
   * allowlist). Ambiguous results return null - never guess identities.
   */
  async resolveBitrixUser(user) {
    if (user?.bitrixUserId) {
      return { id: Number(user.bitrixUserId), resolvedByName: false };
    }
    const tokens = buildBitrixSearchTokens(user);
    for (const token of tokens) {
      let found;
      try {
        found = await this.callMethod("user.search", { FILTER: { FIND: token } });
      } catch {
        continue;
      }
      const list = Array.isArray(found?.result) ? found.result : Array.isArray(found) ? found : [];
      const active = list.filter((item) => item?.ID);
      if (active.length === 1) {
        return {
          id: Number(active[0].ID),
          name: [active[0].NAME, active[0].LAST_NAME].filter(Boolean).join(" ") || null,
          resolvedByName: true,
        };
      }
    }
    return null;
  }

  async getUserTasks({ user, limit = 20, includeClosed = true }) {
    const resolved = await this.resolveBitrixUser(user);
    if (!resolved?.id) {
      return {
        source: this.source,
        configured: this.configured,
        userId: user.id,
        bitrixUserId: null,
        note: "User has no Bitrix user mapping",
        tasks: [],
      };
    }

    const filter = { RESPONSIBLE_ID: resolved.id };
    if (!includeClosed) {
      filter["!STATUS"] = 5;
    }

    const payload = await this.callMethod("tasks.task.list", {
      order: { DEADLINE: "asc", CHANGED_DATE: "desc", ID: "desc" },
      filter,
      select: [
        "ID",
        "TITLE",
        "GROUP_ID",
        "STAGE_ID",
        "STATUS",
        "DEADLINE",
        "RESPONSIBLE_ID",
        "RESPONSIBLE_NAME",
        "CREATED_BY",
        "CHANGED_DATE",
        "CLOSED_DATE",
      ],
      start: 0,
    });

    return {
      source: this.source,
      configured: this.configured,
      userId: user.id,
      bitrixUserId: resolved.id,
      bitrixResolvedByName: Boolean(resolved.resolvedByName),
      tasks: readTasks(payload).slice(0, limit).map(normalizeBitrixTask),
    };
  }

  async callMethod(method, params) {
    assertReadOnlyBitrixMethod(method);
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

function normalizeBitrixMethodName(method) {
  return String(method ?? "")
    .trim()
    .toLowerCase();
}

export function normalizeBitrixTask(task) {
  const status = normalizeStatus(task.status ?? task.STATUS ?? task.realStatus ?? task.REAL_STATUS);
  return {
    id: String(task.id ?? task.ID ?? ""),
    title: String(task.title ?? task.TITLE ?? "Untitled task"),
    groupId: normalizeNullableString(task.groupId ?? task.GROUP_ID),
    stageId: normalizeNullableString(task.stageId ?? task.STAGE_ID),
    status,
    statusLabel: statusLabel(status),
    deadline: normalizeNullableString(task.deadline ?? task.DEADLINE),
    responsibleId: normalizeNullableString(task.responsibleId ?? task.RESPONSIBLE_ID),
    responsibleName: normalizeNullableString(task.responsibleName ?? task.RESPONSIBLE_NAME),
    createdBy: normalizeNullableString(task.createdBy ?? task.CREATED_BY),
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

function buildBitrixSearchTokens(user) {
  const telegramFullName = [user?.telegram?.firstName, user?.telegram?.lastName]
    .filter(Boolean)
    .join(" ");
  return [
    user?.displayName,
    telegramFullName,
    user?.telegram?.firstName,
  ]
    .map((value) => String(value || "").trim())
    .filter((value) => value.length >= 3 && !/^(project manager|pm)\s*\d+$/iu.test(value));
}
