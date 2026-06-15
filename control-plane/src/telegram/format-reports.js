// Telegram report/status formatters — pure presentation, extracted from
// handler.js. They read public data and return HTML strings; no mutation.
import { escapeHtml } from "./render.js";
import {
  code,
  codeLine,
  formatDateTime,
  formatRole,
  formatSeconds,
  formatSource,
  formatTaskStatus,
  kv,
  subtitle,
  title,
} from "./format.js";
import { publicUser } from "../domain/policy.js";
import { ClaudeApiError } from "../assistant/claude-client.js";
import { listVisibleDeviceAgents } from "../domain/device-agents.js";
import { formatCommandMenuHelp, TELEGRAM_BOT_COMMANDS } from "./bot-commands.js";

export function formatInviteHelp(state) {
  const lines = [
    title("Создание invite-кода"),
    "Команда:",
    codeLine("/invite USER_ID"),
    "",
    "Примеры:",
    codeLine("/invite u-maksat"),
    codeLine("/invite u-pm-1"),
    codeLine("/invite u-pm-2"),
    codeLine("/invite u-pm-3"),
    "",
    subtitle("Доступные пользователи"),
  ];
  for (const user of state.users) {
    if (user.role === "OWNER") {
      continue;
    }
    const status = user.telegram?.telegramUserId ? "уже привязан" : "не привязан";
    lines.push(`- ${code(user.id)} - ${escapeHtml(user.displayName)} (${formatRole(user.role)}, ${status})`);
  }
  return lines.join("\n");
}

export function formatResetCodeHelp(state) {
  const lines = [
    title("Перевыпуск registration code"),
    "Команда:",
    codeLine("/reset_code USER_ID"),
    "",
    "Что делает команда:",
    "- отзывает старые действующие коды сотрудника",
    "- создает новый код на 24 часа",
    "- не отвязывает Telegram и не удаляет историю сотрудника",
    "",
    "Примеры:",
    codeLine("/reset_code u-maksat"),
    codeLine("/reset_code u-pm-1"),
    codeLine("/reset_code maksat"),
    "",
    subtitle("Доступные пользователи"),
  ];
  for (const user of state.users) {
    if (user.role === "OWNER") {
      continue;
    }
    const status = user.telegram?.telegramUserId ? "Telegram привязан" : "Telegram не привязан";
    lines.push(`- ${code(user.id)} - ${escapeHtml(user.displayName)} (${formatRole(user.role)}, ${status})`);
  }
  return lines.join("\n");
}

export function formatInviteCreated({ code: inviteCode, invite, targetUser }) {
  return [
    title("Invite-код создан"),
    kv("Сотрудник", `${targetUser.displayName} (${formatRole(targetUser.role)})`),
    kv("Код", inviteCode),
    kv("Действует до", formatDateTime(invite.expiresAt)),
    "",
    subtitle("Что отправить сотруднику"),
    codeLine(`/register ${inviteCode}`),
    "",
    "После регистрации сотруднику нужно подключить Google:",
    codeLine("/google_connect"),
  ].join("\n");
}

export function formatInviteReissued({ code: inviteCode, invite, targetUser, revokedCount }) {
  return [
    title("Registration code перевыпущен"),
    kv("Сотрудник", `${targetUser.displayName} (${formatRole(targetUser.role)})`),
    kv("Новый код", inviteCode),
    kv("Действует до", formatDateTime(invite.expiresAt)),
    kv("Старых кодов отозвано", revokedCount),
    "",
    subtitle("Что отправить сотруднику"),
    codeLine(`/register ${inviteCode}`),
    "",
    "Этот же код можно ввести в локальном OpenClaw при первой привязке устройства.",
  ].join("\n");
}

export function formatUser(user) {
  const publicView = publicUser(user);
  return [
    title("Мой профиль"),
    kv("Имя", publicView.displayName),
    kv("Роль", formatRole(publicView.role)),
    kv("ID", publicView.id),
    kv("Metricon ID", publicView.kickidlerEmployeeId ?? "не задан"),
    kv("Bitrix ID", publicView.bitrixUserId ?? "не задан"),
    kv("Telegram", publicView.telegramLinked ? "подключен" : "не подключен"),
  ].join("\n");
}

export function formatUsers(users) {
  if (!users.length) {
    return [title("Сотрудники"), "В твоем доступе пока нет сотрудников."].join("\n");
  }
  return [
    title("Сотрудники в твоем доступе"),
    ...users.map((user, index) => `${index + 1}. ${escapeHtml(user.displayName)} - ${formatRole(user.role)} - ${code(user.id)}`),
  ].join("\n");
}

export function formatProjects(projects) {
  if (!projects.length) {
    return [title("Проекты"), "В твоем доступе пока нет проектов."].join("\n");
  }
  return [
    title("Проекты в твоем доступе"),
    ...projects.map((project, index) => {
      const group = project.bitrixGroupId ? `Bitrix group ${project.bitrixGroupId}` : "Bitrix group не задан";
      return `${index + 1}. ${escapeHtml(project.name)} - ${code(project.id)} - ${escapeHtml(group)}`;
    }),
  ].join("\n");
}

export function formatMetriconReport(report, label) {
  const lines = [
    title("Metricon: активность"),
    kv("Период", label),
    kv("Источник", formatSource(report.source, report.configured)),
    kv("Сотрудников", report.employees.length),
  ];
  if (!report.employees.length) {
    lines.push("", "Данных по сотрудникам нет. Проверь Metricon ID у пользователей и доступность API.");
    return lines.join("\n");
  }

  lines.push("", subtitle("Сотрудники"));
  for (const [index, item] of report.employees.slice(0, 10).entries()) {
    const activeSeconds = item.metrics?.activeSeconds ?? item.metrics?.raw?.data?.totalActiveTime ?? null;
    const idleSeconds = item.metrics?.idleSeconds ?? item.metrics?.raw?.data?.totalIdleTime ?? null;
    const totalSeconds = item.metrics?.totalSeconds ?? null;
    lines.push(
      [
        `${index + 1}. <b>${escapeHtml(item.user.displayName)}</b>`,
        kv("Активность", formatSeconds(activeSeconds)),
        kv("Простой", formatSeconds(idleSeconds)),
        kv("Всего", formatSeconds(totalSeconds)),
      ].join("\n"),
    );
  }
  return lines.join("\n");
}

export function formatKickidlerReport(report, label) {
  const lines = [
    title("Metricon: активность"),
    kv("Период", label),
    kv("Источник", formatSource(report.source, report.configured)),
    kv("Сотрудников", report.employees.length),
  ];
  if (!report.employees.length) {
    lines.push("", "Данных по сотрудникам нет. Проверь Metricon ID у пользователей и доступность API.");
    return lines.join("\n");
  }

  lines.push("", subtitle("Сотрудники"));
  for (const [index, item] of report.employees.slice(0, 10).entries()) {
    const activeSeconds = item.metrics?.activeSeconds ?? item.metrics?.raw?.data?.totalActiveTime ?? null;
    const idleSeconds = item.metrics?.idleSeconds ?? item.metrics?.raw?.data?.totalIdleTime ?? null;
    lines.push(
      [
        `${index + 1}. <b>${escapeHtml(item.user.displayName)}</b>`,
        kv("Активность", formatSeconds(activeSeconds)),
        kv("Простой", formatSeconds(idleSeconds)),
      ].join("\n"),
    );
  }
  return lines.join("\n");
}

export function formatPlatrumReport(report) {
  const lines = [
    title("Platrum: project tasks"),
    kv("Project", report.project.name),
    kv("Source", `${formatSource(report.source, report.configured)} read-only`),
    kv("Total tasks", report.summary.total),
    kv("Open", report.summary.open),
    kv("Completed", report.summary.completed),
    kv("Review", report.summary.review),
    kv("Overdue", report.summary.overdue),
    kv("Efficiency", report.summary.efficiencyPercent === null ? "n/a" : `${report.summary.efficiencyPercent}%`),
  ];

  if (report.note) {
    lines.push(kv("Note", report.note));
  }

  if (!report.tasks.length) {
    lines.push(
      "",
      "No Platrum tasks were found for this project mapping.",
      "",
      subtitle("Check"),
      "- project.platrumProjectId in control-plane state",
      "- whether tasks are linked to this Platrum project",
      "- whether the current user has access to the requested project",
    );
    return lines.join("\n");
  }

  lines.push("", subtitle("Tasks"));
  for (const [index, task] of report.tasks.slice(0, 8).entries()) {
    const details = [
      `${index + 1}. <b>${escapeHtml(task.title)}</b>`,
      kv("Status", `${formatTaskStatus(task.statusLabel)}${task.overdue ? " | overdue" : ""}`),
    ];
    if (task.assigneeUsername || task.assigneeId) {
      details.push(kv("Assignee", task.assigneeUsername || `ID ${task.assigneeId}`));
    }
    if (task.deadline) {
      details.push(kv("Deadline", formatDateTime(task.deadline)));
    }
    lines.push(details.join("\n"));
  }
  return lines.join("\n");
}

export function formatBitrixReport(report) {
  const lines = [
    title("Bitrix: задачи проекта"),
    kv("Проект", report.project.name),
    kv("Источник", formatSource(report.source, report.configured)),
    kv("Всего задач", report.summary.total),
    kv("Открыто", report.summary.open),
    kv("Завершено", report.summary.completed),
    kv("Просрочено", report.summary.overdue),
  ];

  if (!report.tasks.length) {
    lines.push(
      "",
      "По этому проекту задачи не найдены.",
      "",
      subtitle("Что проверить"),
      "- задачи могут быть личными и не привязанными к группе проекта",
      "- у проекта может быть другой Bitrix group ID",
      "- сотрудник мог быть назначен ответственным без связи с проектом",
    );
    return lines.join("\n");
  }

  lines.push("", subtitle("Задачи"));
  for (const [index, task] of report.tasks.slice(0, 8).entries()) {
    const details = [
      `${index + 1}. <b>${escapeHtml(task.title)}</b>`,
      kv("Статус", `${formatTaskStatus(task.statusLabel)}${task.overdue ? " | просрочено" : ""}`),
    ];
    if (task.responsibleName || task.responsibleId) {
      details.push(kv("Ответственный", task.responsibleName || `ID ${task.responsibleId}`));
    }
    if (task.deadline) {
      details.push(kv("Дедлайн", formatDateTime(task.deadline)));
    }
    if (task.groupId) {
      details.push(kv("Группа", task.groupId));
    }
    lines.push(details.join("\n"));
  }
  return lines.join("\n");
}

export function formatDeviceAgents(agents) {
  if (!agents.length) {
    return [
      title("Агенты устройств"),
      "Устройства пока не выходили на связь.",
    ].join("\n");
  }

  const lines = [title("Агенты устройств")];
  for (const [index, agent] of agents.slice(0, 20).entries()) {
    lines.push(
      [
        `${index + 1}. ${escapeHtml(agent.userDisplayName)}`,
        `Устройство: ${escapeHtml(agent.displayName || agent.deviceId)}`,
        `Host: ${escapeHtml(agent.hostname || "n/a")}`,
        `Платформа: ${escapeHtml(agent.platform || "n/a")}`,
        `Последний сигнал: ${escapeHtml(agent.lastSeenAt || "n/a")}`,
      ].join("\n"),
    );
    if (index < Math.min(agents.length, 20) - 1) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function formatDeviceCommandHelp(state, actor) {
  const agents = listVisibleDeviceAgents(state, actor);
  const lines = [
    title("Управление локальным OpenClaw"),
    "Формат:",
    codeLine("/device USER_ID ACTION ARGS"),
    "",
    subtitle("Примеры"),
    codeLine("/device maksat open_app Chrome"),
    codeLine("/device u-pm-1 screenshot"),
    codeLine("/device pm-1 active_window"),
    codeLine("/device maksat open_url https://starlabagent.pp.ua"),
    codeLine("/device maksat hotkey ctrl+r"),
    codeLine("/device maksat play_youtube XXXTENTACION - Moonlight"),
    codeLine("/device maksat keyboard_type текст для ввода"),
    "",
    subtitle("Доступные ACTION"),
    "open_app, close_app, open_url, play_youtube, open_file, list_running_apps, active_window, screenshot, clipboard_get, clipboard_set, keyboard_type, hotkey, mouse_click",
    "",
    subtitle("Доступные устройства"),
  ];
  if (!agents.length) {
    lines.push("Пока нет активированных устройств.");
  } else {
    for (const agent of agents.slice(0, 12)) {
      lines.push(`- ${escapeHtml(agent.userDisplayName)}: ${codeLine(agent.deviceId)}`);
    }
  }
  return lines.join("\n");
}

export function formatDeviceCommandQueued(command, recent = []) {
  const lines = [
    title("Команда отправлена на устройство"),
    kv("Сотрудник", command.userDisplayName || command.userId),
    kv("Устройство", command.deviceDisplayName || command.deviceId),
    kv("Действие", command.type),
    kv("Статус", command.status),
    kv("Command ID", command.id),
    "",
    "Локальный OpenClaw заберет команду в течение нескольких секунд и вернет результат на сервер.",
  ];
  const history = recent.filter((item) => item.id !== command.id).slice(0, 3);
  if (history.length) {
    lines.push("", subtitle("Последние команды этого устройства"));
    for (const item of history) {
      lines.push(`- ${escapeHtml(item.type)}: ${escapeHtml(item.status)} (${escapeHtml(item.createdAt || "n/a")})`);
    }
  }
  return lines.join("\n");
}

export function formatGoogleStatus(status) {
  if (!status.connected) {
    return [
      title("Google не подключен"),
      "Для подключения используй:",
      codeLine("/google_connect"),
    ].join("\n");
  }
  return [
    title("Google подключен"),
    kv("Аккаунт", status.googleAccountEmail || "unknown"),
    kv("Scopes", status.scopes.length),
    kv("Подключен", formatDateTime(status.connectedAt)),
    kv("Обновлен", formatDateTime(status.updatedAt)),
  ].join("\n");
}

export function formatAiStatus(status) {
  if (status.ok) {
    return [
      title("Claude API доступен"),
      kv("Model", status.model || "unknown"),
      "Свободные вопросы в Telegram должны работать.",
    ].join("\n");
  }

  const lines = [
    title("Claude API недоступен"),
    kv("Model", status.model || "unknown"),
  ];
  if (status.status) {
    lines.push(kv("HTTP", status.status));
  }
  if (status.type) {
    lines.push(kv("Type", status.type));
  }
  lines.push(kv("Message", status.message || "unknown"));
  if (status.requestId) {
    lines.push(kv("Request ID", status.requestId));
  }
  lines.push(
    "",
    subtitle("Что проверить"),
    "- Anthropic Console",
    "- активность API key",
    "- billing/credits",
    "- доступ к API и региональные ограничения",
    "",
    "Пока это не исправлено, /bitrix, /report, /google_status и /agents работают отдельно от Claude.",
  );
  return lines.join("\n");
}

const INTEGRATION_LABELS = {
  claude: "Claude",
  telegram: "Telegram",
  metricon: "Metricon",
  platrum: "Platrum",
  bitrix: "Bitrix",
  voice: "Голос",
  google: "Google",
};

export function formatIntegrationsStatus(health) {
  const lines = [title("Статус интеграций")];
  for (const [key, label] of Object.entries(INTEGRATION_LABELS)) {
    const status = health.integrations?.[key];
    if (!status) {
      continue;
    }
    const icon = status.ok ? "✅" : "❌";
    lines.push(`${icon} ${label}: ${escapeHtml(status.message || (status.ok ? "ok" : "недоступно"))}`);
  }
  lines.push("", kv("Проверено", formatDateTime(health.checkedAt)));
  return lines.join("\n");
}

export function isAbortLikeError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    /operation was aborted|aborted|timed? ?out/iu.test(error.message || "")
  );
}

export function formatTelegramError(error) {
  if (error instanceof ClaudeApiError) {
    return [
      title("Ошибка Claude API"),
      kv("HTTP", error.status || "unknown"),
      kv("Message", error.message || "unknown"),
      "",
      "Проверь /ai_status. Команды /bitrix, /report, /google_status и /agents работают отдельно от Claude.",
    ].join("\n");
  }
  if (isAbortLikeError(error)) {
    return [
      title("Не успел собрать ответ"),
      "Один из сервисов отвечал слишком долго, и запрос был прерван.",
      "Попробуй задать вопрос ещё раз или сузить его (например, один сотрудник и один день).",
    ].join("\n");
  }
  return [
    title("Ошибка"),
    escapeHtml(error instanceof Error ? error.message : "Unknown error"),
  ].join("\n");
}

export function helpText() {
  return [
    title("Starlab Agent: команды"),
    formatCommandMenuHelp(TELEGRAM_BOT_COMMANDS),
    "",
    subtitle("Регистрация"),
    "Николай создает код:",
    codeLine("/invite USER_ID"),
    "Если код потерялся или истек, Николай перевыпускает его:",
    codeLine("/reset_code USER_ID"),
    "Сотрудник вводит:",
    codeLine("/register CODE"),
    "",
    subtitle("Ежедневная работа"),
    codeLine("/plan задача 1; задача 2"),
    codeLine("/today"),
    codeLine("/progress USER_ID"),
    codeLine("/blocker текст"),
    codeLine("/done НОМЕР"),
    codeLine("/daily_report"),
    codeLine("/device maksat open_app Chrome"),
    "",
    subtitle("Можно писать обычным текстом"),
    "Например: Как сегодня работала Бегайым?",
  ].join("\n");
}

export function unknownCommandText() {
  return [
    title("Неизвестная команда"),
    "Используй /help, там только актуальные команды Starlab Agent.",
    "",
    "Если команда видна в меню Telegram, но бот ее не знает, это старый кеш меню. Открой /help или перезапусти Telegram-клиент.",
  ].join("\n");
}
