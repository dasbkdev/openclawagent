import { validation } from "../domain/errors.js";

export const READ_ONLY_PLATRUM_ENDPOINTS = Object.freeze([
  /^GET \/api\/v1\/auth\/me\/?$/u,
  /^GET \/api\/v1\/accounts\/org\/users\/?$/u,
  /^GET \/api\/v1\/accounts\/org\/structure\/?$/u,
  /^GET \/api\/v1\/accounts\/company\/structure\/?$/u,
  /^GET \/api\/v1\/accounts\/me\/team\/?$/u,
  /^GET \/api\/v1\/tasks\/my\/?$/u,
  /^GET \/api\/v1\/tasks\/team\/?$/u,
  /^GET \/api\/v1\/tasks\/projects\/?$/u,
  /^GET \/api\/v1\/tasks\/projects\/\d+\/?$/u,
  /^GET \/api\/v1\/tasks\/projects\/\d+\/tasks\/?$/u,
  /^GET \/api\/v1\/tasks\/projects\/\d+\/report\/?$/u,
  /^GET \/api\/v1\/tasks\/report-summary\/?$/u,
  /^GET \/api\/v1\/reports\/employee\/daily\/?$/u,
  /^GET \/api\/v1\/attendance\/team\/?$/u,
  /^GET \/api\/v1\/metrics\/team\/?$/u,
  /^GET \/api\/v1\/work-schedules\/my\/?$/u,
  /^GET \/api\/v1\/work-schedules\/admin\/weekly-plans\/?$/u,
  /^GET \/api\/v1\/work-schedules\/admin\/templates\/?$/u,
]);

const AUTH_PLATRUM_ENDPOINTS = Object.freeze([
  /^POST \/api\/v1\/auth\/login\/?$/u,
  /^POST \/api\/v1\/auth\/refresh\/?$/u,
]);

export function createPlatrumClientFromEnv(env = process.env) {
  if (env.PLATRUM_BASE_URL && env.PLATRUM_USERNAME && env.PLATRUM_PASSWORD) {
    return new HttpPlatrumClient({
      baseUrl: env.PLATRUM_BASE_URL,
      username: env.PLATRUM_USERNAME,
      password: env.PLATRUM_PASSWORD,
      timeoutMs: Number(env.PLATRUM_TIMEOUT_MS || 15000),
    });
  }
  return new MockPlatrumClient();
}

export function assertReadOnlyPlatrumRequest(method, path) {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();
  const normalizedPath = normalizePath(path);
  const key = `${normalizedMethod} ${normalizedPath}`;
  if (
    READ_ONLY_PLATRUM_ENDPOINTS.some((pattern) => pattern.test(key)) ||
    AUTH_PLATRUM_ENDPOINTS.some((pattern) => pattern.test(key))
  ) {
    return { method: normalizedMethod, path: normalizedPath };
  }
  throw validation("Platrum API request is blocked by read-only guard", {
    method: normalizedMethod,
    path: normalizedPath,
    allowed: "Only GET business-data endpoints are allowed; POST is allowed only for auth login/refresh.",
  });
}

export class MockPlatrumClient {
  constructor() {
    this.source = "mock";
    this.configured = false;
    this.readOnly = true;
  }

  async getProjectTasks({ project }) {
    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      platrumProjectId: project.platrumProjectId ?? null,
      note: "Platrum is not configured",
      tasks: [],
    };
  }

  async getProjectReport({ project }) {
    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      platrumProjectId: project.platrumProjectId ?? null,
      note: "Platrum is not configured",
      report: null,
    };
  }

  async getUserTasks({ user }) {
    return {
      source: this.source,
      configured: this.configured,
      userId: user.id,
      platrumUserId: user.platrumUserId ?? null,
      note: "Platrum is not configured",
      tasks: [],
    };
  }

  async getAllTasks() {
    return {
      source: this.source,
      configured: this.configured,
      note: "Platrum is not configured",
      tasks: [],
    };
  }

  async getDailyReports() {
    return {
      source: this.source,
      configured: this.configured,
      reports: [],
      note: "Platrum is not configured",
    };
  }

  async getTeamMetrics() {
    return {
      source: this.source,
      configured: this.configured,
      metrics: null,
      note: "Platrum is not configured",
    };
  }

  async getAdminWeeklyPlans() {
    return {
      source: this.source,
      configured: this.configured,
      plans: [],
      note: "Platrum is not configured",
    };
  }

  async getScheduleTemplates() {
    return {
      source: this.source,
      configured: this.configured,
      templates: [],
      note: "Platrum is not configured",
    };
  }
}

export class HttpPlatrumClient {
  constructor({ baseUrl, username, password, timeoutMs = 15000 }) {
    this.baseUrl = String(baseUrl || "").replace(/\/+$/u, "");
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.source = "platrum";
    this.configured = true;
    this.readOnly = true;
    this.tokens = null;
  }

  async getMe() {
    return await this.requestJson("/api/v1/auth/me/");
  }

  async getUsers() {
    return asArray(await this.requestJson("/api/v1/accounts/org/users/"));
  }

  async getTeam() {
    return asArray(await this.requestJson("/api/v1/accounts/me/team/"));
  }

  async getProjects({ limit = 50 } = {}) {
    const projects = asArray(await this.requestJson("/api/v1/tasks/projects/"));
    return projects.slice(0, normalizeLimit(limit)).map(normalizePlatrumProject);
  }

  async getProjectTasks({ project, limit = 50 }) {
    const platrumProjectId = normalizeId(project.platrumProjectId ?? project.id);
    if (!platrumProjectId) {
      return {
        source: this.source,
        configured: this.configured,
        projectId: project.id,
        platrumProjectId: null,
        note: "Project has no Platrum project mapping",
        tasks: [],
      };
    }

    const tasks = asArray(
      await this.requestJson(`/api/v1/tasks/projects/${encodeURIComponent(platrumProjectId)}/tasks/`),
    );
    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      platrumProjectId,
      tasks: tasks.slice(0, normalizeLimit(limit)).map(normalizePlatrumTask),
    };
  }

  async getProjectReport({ project }) {
    const platrumProjectId = normalizeId(project.platrumProjectId ?? project.id);
    if (!platrumProjectId) {
      return {
        source: this.source,
        configured: this.configured,
        projectId: project.id,
        platrumProjectId: null,
        note: "Project has no Platrum project mapping",
        report: null,
      };
    }

    return {
      source: this.source,
      configured: this.configured,
      projectId: project.id,
      platrumProjectId,
      report: normalizePlatrumProjectReport(
        await this.requestJson(`/api/v1/tasks/projects/${encodeURIComponent(platrumProjectId)}/report/`),
      ),
    };
  }

  async getUserTasks({ user, limit = 50, period = null }) {
    const platrumUser = await this.resolvePlatrumUser(user);
    if (!platrumUser?.id) {
      return {
        source: this.source,
        configured: this.configured,
        userId: user.id,
        platrumUserId: user.platrumUserId ?? null,
        note: "User has no Platrum user mapping",
        tasks: [],
      };
    }

    const query = {
      assignee: platrumUser.id,
      ...(period?.from ? { due_date_from: toPlatrumDate(period.from) } : {}),
      ...(period?.to ? { due_date_to: toPlatrumDate(period.to) } : {}),
    };
    const tasks = asArray(await this.requestJson("/api/v1/tasks/team/", { query }));
    return {
      source: this.source,
      configured: this.configured,
      userId: user.id,
      platrumUserId: platrumUser.id,
      platrumUsername: platrumUser.username ?? null,
      tasks: tasks.slice(0, normalizeLimit(limit)).map(normalizePlatrumTask),
    };
  }

  /**
   * All tasks across every board the account can see, including personal
   * kanban boards that have no project mapping (board_is_personal=true,
   * project_id=null). These are invisible to getProjectTasks, yet hold the
   * bulk of real work, so this is the source of truth for "all tasks".
   */
  async getAllTasks({ limit = 200 } = {}) {
    const tasks = asArray(await this.requestJson("/api/v1/tasks/team/"));
    return {
      source: this.source,
      configured: this.configured,
      tasks: tasks.slice(0, normalizeLimit(limit, 500)).map(normalizePlatrumTask),
    };
  }

  async getReportSummary({ scope = "team", user = null, period = null } = {}) {
    const query = {
      scope,
      ...(user?.platrumUserId ? { assignee: user.platrumUserId } : {}),
      ...(period?.from ? { due_date_from: toPlatrumDate(period.from) } : {}),
      ...(period?.to ? { due_date_to: toPlatrumDate(period.to) } : {}),
    };
    return normalizePlatrumReportSummary(await this.requestJson("/api/v1/tasks/report-summary/", { query }));
  }

  async getDailyReports({ date = null, limit = 100 } = {}) {
    const reports = asArray(
      await this.requestJson("/api/v1/reports/employee/daily/", {
        query: date ? { date } : {},
      }),
    );
    return {
      source: this.source,
      configured: this.configured,
      reports: reports.slice(0, normalizeLimit(limit, 200)).map(normalizePlatrumDailyReport),
    };
  }

  async getAttendance({ year, month }) {
    if (!year || !month) {
      return {
        source: this.source,
        configured: this.configured,
        records: [],
        note: "Attendance query requires year and month",
      };
    }
    return {
      source: this.source,
      configured: this.configured,
      records: asArray(await this.requestJson("/api/v1/attendance/team/", { query: { year, month } })),
    };
  }

  async getTeamMetrics() {
    return {
      source: this.source,
      configured: this.configured,
      metrics: await this.requestJson("/api/v1/metrics/team/"),
    };
  }

  async getAdminWeeklyPlans({ weekStart = null } = {}) {
    const plans = asArray(
      await this.requestJson("/api/v1/work-schedules/admin/weekly-plans/", {
        query: weekStart ? { week_start: weekStart } : {},
      }),
    );
    return {
      source: this.source,
      configured: this.configured,
      weekStart,
      plans: plans.map(normalizePlatrumWeeklyPlan),
    };
  }

  /**
   * Recurring weekly schedule templates ("шаблон графика на неделю"). Each
   * template lists a plan per day-of-week and how many users it is assigned to.
   * Used to answer "what is X's work schedule" when no explicit weekly plan was
   * submitted for the asked week.
   */
  async getScheduleTemplates() {
    const templates = asArray(
      await this.requestJson("/api/v1/work-schedules/admin/templates/"),
    );
    return {
      source: this.source,
      configured: this.configured,
      templates: templates.map(normalizePlatrumScheduleTemplate),
    };
  }

  async resolvePlatrumUser(user) {
    if (user?.platrumUserId) {
      return { id: Number(user.platrumUserId), username: user.platrumUsername ?? null };
    }
    const users = await this.getUsers();
    const tokens = buildUserCandidateTokens(user);
    const matches = users.filter((candidate) => {
      const values = [
        candidate.id,
        candidate.username,
        candidate.email,
        candidate.full_name,
        candidate.first_name,
        candidate.last_name,
      ];
      return tokens.some((token) => values.some((value) => userTokenMatchesValue(token, value)));
    });
    // Ambiguous matches must not silently map to the wrong person.
    return matches.length === 1 ? matches[0] : null;
  }

  async requestJson(path, { method = "GET", query = {}, body = undefined, auth = true, retry = true } = {}) {
    const normalized = assertReadOnlyPlatrumRequest(method, path);
    const url = new URL(`${this.baseUrl}${normalized.path}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (auth) {
      headers.Authorization = `Bearer ${await this.getAccessToken()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: normalized.method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (response.status === 401 && auth && retry) {
        await this.login();
        return await this.requestJson(path, { method, query, body, auth, retry: false });
      }
      if (!response.ok) {
        throw validation("Platrum API request failed", {
          status: response.status,
          path: normalized.path,
          body: text.slice(0, 1000),
        });
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async getAccessToken() {
    if (this.tokens?.access) {
      return this.tokens.access;
    }
    await this.login();
    return this.tokens.access;
  }

  async login() {
    const payload = await this.requestJson("/api/v1/auth/login/", {
      method: "POST",
      auth: false,
      body: {
        username: this.username,
        password: this.password,
      },
    });
    if (!payload?.access) {
      throw validation("Platrum login did not return access token");
    }
    this.tokens = {
      access: payload.access,
      refresh: payload.refresh ?? null,
      updatedAt: new Date().toISOString(),
    };
    return this.tokens;
  }
}

export function normalizePlatrumProject(project) {
  return {
    id: normalizeId(project.id),
    name: stringOrNull(project.name) || `Platrum project ${project.id}`,
    description: stringOrNull(project.description),
    status: stringOrNull(project.status),
    statusLabel: stringOrNull(project.status_label),
    deadline: stringOrNull(project.deadline ?? project.due_date),
    ownerId: normalizeId(project.owner_id),
    ownerName: stringOrNull(project.owner_name),
    pmId: normalizeId(project.pm_id),
    pmName: stringOrNull(project.pm_name),
    memberIds: Array.isArray(project.member_ids) ? project.member_ids.map(normalizeId).filter(Boolean) : [],
    memberNames: Array.isArray(project.member_names) ? project.member_names.filter(Boolean).map(String) : [],
    raw: project,
  };
}

export function normalizePlatrumTask(task) {
  const status = normalizeTaskStatus(task.status, task.status_label, task.column_order);
  return {
    id: normalizeId(task.id),
    title: stringOrNull(task.title) || "Untitled task",
    description: stringOrNull(task.description),
    projectId: normalizeId(task.project_id ?? task.board),
    projectName: stringOrNull(task.project_name ?? task.board_name),
    boardId: normalizeId(task.board),
    boardName: stringOrNull(task.board_name),
    boardIsPersonal: Boolean(task.board_is_personal),
    assigneeId: normalizeId(task.assignee),
    assigneeUsername: stringOrNull(task.assignee_username),
    reporterId: normalizeId(task.reporter),
    reporterUsername: stringOrNull(task.reporter_username),
    dueDate: stringOrNull(task.due_date),
    deadline: stringOrNull(task.due_date),
    priority: stringOrNull(task.priority),
    priorityLabel: stringOrNull(task.priority_label),
    status,
    statusLabel: status,
    sourceStatusLabel: stringOrNull(task.status_label ?? task.column_name),
    columnId: normalizeId(task.column),
    columnName: stringOrNull(task.column_name),
    columnOrder: Number.isFinite(Number(task.column_order)) ? Number(task.column_order) : null,
    overdue: Boolean(task.is_overdue),
    isOverdue: Boolean(task.is_overdue),
    workStartedAt: stringOrNull(task.work_started_at),
    completedAt: stringOrNull(task.completed_at),
    createdAt: stringOrNull(task.created_at),
    updatedAt: stringOrNull(task.updated_at),
    raw: task,
  };
}

export function normalizePlatrumProjectReport(report) {
  if (!report || typeof report !== "object") {
    return null;
  }
  return {
    projectId: normalizeId(report.project_id),
    totalTaskCount: Number(report.total_task_count || 0),
    completedTaskCount: Number(report.completed_task_count || 0),
    overdueTaskCount: Number(report.overdue_task_count || 0),
    progressPercentage: Number(report.progress_percentage || 0),
    statusCounts: report.status_counts && typeof report.status_counts === "object" ? report.status_counts : {},
    overdueTasks: asArray(report.overdue_tasks).map(normalizePlatrumTask),
    raw: report,
  };
}

export function normalizePlatrumReportSummary(summary) {
  return {
    scope: stringOrNull(summary?.scope) || "unknown",
    totalTaskCount: Number(summary?.total_task_count || 0),
    completedTaskCount: Number(summary?.completed_task_count || 0),
    overdueTaskCount: Number(summary?.overdue_task_count || 0),
    progressPercentage: Number(summary?.progress_percentage || 0),
    statusCounts: summary?.status_counts && typeof summary.status_counts === "object" ? summary.status_counts : {},
    overdueTasks: asArray(summary?.overdue_tasks).map(normalizePlatrumTask),
    raw: summary,
  };
}

export function normalizePlatrumDailyReport(report) {
  return {
    id: normalizeId(report.id),
    userId: normalizeId(report.user),
    username: stringOrNull(report.username),
    userFullName: stringOrNull(report.user_full_name),
    reportDate: stringOrNull(report.report_date),
    summary: stringOrNull(report.summary),
    startedTasks: stringOrNull(report.started_tasks),
    takenTasks: stringOrNull(report.taken_tasks),
    completedTasks: stringOrNull(report.completed_tasks),
    blockers: stringOrNull(report.blockers),
    blockerCategory: stringOrNull(report.blocker_category),
    isLate: Boolean(report.is_late),
    createdAt: stringOrNull(report.created_at),
    updatedAt: stringOrNull(report.updated_at),
    raw: report,
  };
}

export function normalizePlatrumWeeklyPlan(plan) {
  // The actual planned week lives in `days` (dated entries); `days_plan` is the
  // template-derived fallback used before a plan is submitted.
  const source = asArray(plan?.days?.length ? plan.days : plan?.days_plan);
  const days = source.map((day) => ({
    date: stringOrNull(day.date),
    mode: stringOrNull(day.mode),
    isOff: Boolean(day.is_off) || ["off", "day_off", "dayoff", "weekend"].includes(stringOrNull(day.mode) || ""),
    startTime: normalizeClockTime(day.start_time ?? day.start),
    endTime: normalizeClockTime(day.end_time ?? day.end),
    lunchStart: normalizeClockTime(day.lunch_start),
    lunchEnd: normalizeClockTime(day.lunch_end),
    comment: stringOrNull(day.comment),
    segments: asArray(day.segments).map((segment) => ({
      mode: stringOrNull(segment.mode),
      startTime: normalizeClockTime(segment.start),
      endTime: normalizeClockTime(segment.end),
    })),
  }));

  return {
    id: normalizeId(plan?.id),
    userId: normalizeId(plan?.user),
    username: stringOrNull(plan?.username),
    userName: stringOrNull(plan?.user_name),
    weekStart: stringOrNull(plan?.week_start),
    status: stringOrNull(plan?.status),
    statusLabel: stringOrNull(plan?.status_label),
    officeHours: Number.isFinite(Number(plan?.office_hours)) ? Number(plan.office_hours) : null,
    onlineHours: Number.isFinite(Number(plan?.online_hours)) ? Number(plan.online_hours) : null,
    onlineReason: stringOrNull(plan?.online_reason),
    employeeComment: stringOrNull(plan?.employee_comment),
    adminComment: stringOrNull(plan?.admin_comment),
    submittedAt: stringOrNull(plan?.submitted_at),
    updatedAt: stringOrNull(plan?.updated_at),
    days,
    raw: plan,
  };
}

const WEEKDAY_NAMES = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function normalizePlatrumScheduleTemplate(template) {
  const days = asArray(template?.days_plan).map((day) => {
    const dow = Number(day.day_of_week);
    return {
      dayOfWeek: Number.isInteger(dow) ? dow : null,
      dayName: Number.isInteger(dow) && WEEKDAY_NAMES[dow] ? WEEKDAY_NAMES[dow] : null,
      mode: stringOrNull(day.mode),
      isOff: Boolean(day.is_off),
      startTime: normalizeClockTime(day.start ?? day.start_time),
      endTime: normalizeClockTime(day.end ?? day.end_time),
      lunchStart: normalizeClockTime(day.lunch_start),
      lunchEnd: normalizeClockTime(day.lunch_end),
      segments: asArray(day.segments).map((segment) => ({
        mode: stringOrNull(segment.mode),
        startTime: normalizeClockTime(segment.start),
        endTime: normalizeClockTime(segment.end),
      })),
    };
  });

  return {
    id: normalizeId(template?.id),
    name: stringOrNull(template?.name),
    isDefault: Boolean(template?.is_default),
    isActive: Boolean(template?.is_active),
    usersCount: Number.isFinite(Number(template?.users_count)) ? Number(template.users_count) : null,
    days,
    raw: template,
  };
}

function normalizeTaskStatus(status, label, columnOrder) {
  const value = String(status || "").trim().toLowerCase();
  if (["new", "in_progress", "review", "completed"].includes(value)) {
    return value;
  }
  const numericOrder = Number(columnOrder);
  if (numericOrder === 1) return "new";
  if (numericOrder === 2) return "in_progress";
  if (numericOrder === 3) return "review";
  if (numericOrder === 4) return "completed";
  const normalizedLabel = normalizeSearch(label);
  if (normalizedLabel.includes("review") || normalizedLabel.includes("proverk")) return "review";
  if (normalizedLabel.includes("completed") || normalizedLabel.includes("done")) return "completed";
  if (normalizedLabel.includes("progress")) return "in_progress";
  return value || "unknown";
}

function buildUserCandidateTokens(user) {
  const telegramFullName = [user?.telegram?.firstName, user?.telegram?.lastName]
    .filter(Boolean)
    .join(" ");
  return [
    user?.platrumUsername,
    user?.email,
    user?.displayName,
    user?.employeeId,
    user?.telegram?.username,
    user?.telegram?.firstName,
    user?.telegram?.lastName,
    telegramFullName,
    user?.id,
  ].map(normalizeSearch).filter((token) => token && token.length >= 3);
}

/**
 * A candidate token matches a directory value when it equals the whole
 * normalized value or one of its words (so "Перизат" finds
 * "Усенкулова Перизат"). Word-level matching only applies to tokens of
 * 4+ characters to avoid false positives on short fragments.
 */
export function userTokenMatchesValue(token, value) {
  const normalizedValue = normalizeSearch(value);
  if (!token || !normalizedValue) {
    return false;
  }
  if (normalizedValue === token) {
    return true;
  }
  if (token.length < 4) {
    return false;
  }
  return normalizedValue.split(/[\s/.,_-]+/u).includes(token);
}

function asArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return payload ? [payload] : [];
}

function normalizePath(path) {
  const raw = String(path || "").trim();
  const parsed = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw).pathname
    : raw.split("?")[0];
  const withLeadingSlash = parsed.startsWith("/") ? parsed : `/${parsed}`;
  return withLeadingSlash.replace(/\/{2,}/gu, "/");
}

function normalizeId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function normalizeLimit(value, max = 100) {
  const normalized = Number(value || 50);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > max) {
    throw validation(`limit must be an integer between 1 and ${max}`);
  }
  return normalized;
}

function stringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeClockTime(value) {
  const text = stringOrNull(value);
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d{1,2}):(\d{2})/u);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

function toPlatrumDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
