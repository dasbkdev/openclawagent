import { validation } from "../domain/errors.js";

export const READ_ONLY_BITRIX_METHODS = Object.freeze([
  "profile",
  "scope",
  "tasks.task.get",
  "tasks.task.getfields",
  "tasks.task.list",
  "task.item.getdata",
  "task.item.list",
  "task.stages.get",
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

// Workgroup names and kanban-stage (column) titles change rarely but are needed
// to label every task in the all-boards view. The Bitrix client is constructed
// per request, so cache these lookups at module scope (keyed by webhook) with a
// short TTL to avoid dozens of extra REST calls on every assistant question.
const NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const workgroupNameCache = new Map(); // webhookUrl -> { at, map }
const stageNameCache = new Map(); // `${webhookUrl}\n${groupId}` -> { at, map }

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

  async getAllTasks() {
    return {
      source: this.source,
      configured: this.configured,
      note: "Bitrix is not configured; all-boards task view is unavailable.",
      tasks: [],
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

  /**
   * Read EVERY task across all Bitrix workgroups and personal kanban boards,
   * newest-first, regardless of whether the project is mapped in our state.
   * Each task is labelled with its workgroup name and kanban column (stage)
   * title. This is the all-boards / kanban view, analogous to Platrum's
   * getAllTasks — the per-project getProjectTasks only sees mapped groups and
   * surfaces the oldest tasks first (DEADLINE asc), hiding current work.
   */
  async getAllTasks({ limit = 200 } = {}) {
    const cap = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const select = [
      "ID", "TITLE", "GROUP_ID", "STAGE_ID", "STATUS", "DEADLINE",
      "RESPONSIBLE_ID", "RESPONSIBLE_NAME", "CREATED_BY", "CHANGED_DATE", "CLOSED_DATE",
    ];
    const collected = [];
    let start = 0;
    // Bitrix returns 50 tasks per page and a `next` offset; page newest-first
    // until we reach the cap or run out (guard bounds the loop).
    for (let guard = 0; guard < 20 && collected.length < cap; guard += 1) {
      const payload = await this.callMethod("tasks.task.list", {
        order: { CHANGED_DATE: "desc", ID: "desc" },
        select,
        start,
      });
      const page = readTasks(payload);
      if (page.length === 0) {
        break;
      }
      collected.push(...page);
      const next = payload?.next;
      if (next === undefined || next === null) {
        break;
      }
      start = Number(next);
    }

    const normalized = collected.slice(0, cap).map(normalizeBitrixTask);
    const groupNames = await this.loadWorkgroupNames().catch(() => new Map());
    const stageNames = await this.loadStageNames(normalized).catch(() => new Map());

    const tasks = normalized.map((task) => {
      const groupKey = task.groupId ? String(task.groupId) : "0";
      // GROUP_ID 0 (or absent) means the task lives on the user's personal
      // kanban ("Мой план"), not a workgroup.
      const isPersonal = groupKey === "0";
      return {
        ...task,
        groupName: isPersonal ? "Личные задачи" : groupNames.get(groupKey) ?? null,
        stageName: stageNames.get(`${groupKey}:${task.stageId ?? "0"}`) ?? null,
      };
    });

    return { source: this.source, configured: this.configured, tasks };
  }

  async loadWorkgroupNames() {
    const cached = workgroupNameCache.get(this.webhookUrl);
    if (cached && Date.now() - cached.at < NAME_CACHE_TTL_MS) {
      return cached.map;
    }
    const payload = await this.callMethod("socialnetwork.api.workgroup.list", {
      select: ["ID", "NAME"],
    });
    const result = payload?.result;
    const list = Array.isArray(result?.workgroups)
      ? result.workgroups
      : Array.isArray(result?.items)
        ? result.items
        : Array.isArray(result)
          ? result
          : [];
    const map = new Map();
    for (const group of list) {
      const id = group.ID ?? group.id;
      if (id !== undefined && id !== null) {
        map.set(String(id), normalizeNullableString(group.NAME ?? group.name));
      }
    }
    workgroupNameCache.set(this.webhookUrl, { at: Date.now(), map });
    return map;
  }

  async loadStageNames(tasks) {
    const groupIds = new Set();
    for (const task of tasks) {
      groupIds.add(task.groupId ? String(task.groupId) : "0");
    }
    const map = new Map();
    for (const groupId of groupIds) {
      const cacheKey = `${this.webhookUrl}\n${groupId}`;
      const cached = stageNameCache.get(cacheKey);
      let stageMap;
      if (cached && Date.now() - cached.at < NAME_CACHE_TTL_MS) {
        stageMap = cached.map;
      } else {
        stageMap = new Map();
        try {
          const payload = await this.callMethod("task.stages.get", {
            entityId: Number(groupId) || 0,
            isAdmin: "N",
          });
          const stages = payload?.result;
          if (stages && typeof stages === "object") {
            for (const key of Object.keys(stages)) {
              const stage = stages[key];
              const stageId = stage?.ID ?? key;
              stageMap.set(String(stageId), normalizeNullableString(stage?.TITLE));
            }
          }
        } catch {
          // Stages may be unavailable for this group — leave column unlabelled.
        }
        stageNameCache.set(cacheKey, { at: Date.now(), map: stageMap });
      }
      for (const [stageId, title] of stageMap.entries()) {
        map.set(`${groupId}:${stageId}`, title);
      }
    }
    return map;
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
