// Shared Telegram presentation primitives — pure formatters/helpers with no
// store, network, or side effects. Extracted from handler.js to keep the
// dispatcher lean.
import { escapeHtml, markdownToTelegramHtml } from "./render.js";

export function title(value) {
  return `<b>${escapeHtml(value)}</b>`;
}

export function subtitle(value) {
  return `<b>${escapeHtml(value)}</b>`;
}

export function kv(label, value) {
  return `<b>${escapeHtml(label)}:</b> ${escapeHtml(value ?? "n/a")}`;
}

export function code(value) {
  return `<code>${escapeHtml(value)}</code>`;
}

export function codeLine(value) {
  return code(value);
}

export function formatRole(role) {
  const roles = {
    OWNER: "Владелец",
    SENIOR_PM: "Старший PM",
    PM: "PM",
  };
  return roles[role] || role;
}

export function formatTaskStatus(statusLabel) {
  const statuses = {
    new: "новая",
    pending: "ждет выполнения",
    in_progress: "в работе",
    waiting_control: "на проверке",
    completed: "завершена",
    deferred: "отложена",
    unknown: "неизвестно",
  };
  return statuses[statusLabel] || statusLabel || "неизвестно";
}

export function formatSource(source, configured) {
  return `${source || "unknown"}${configured ? "" : " (тестовые данные)"}`;
}

export function formatDateTime(value) {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("ru-RU", { timeZone: "Asia/Bishkek" });
}

export function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return "n/a";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours && minutes) {
    return `${hours} ч ${minutes} мин`;
  }
  if (hours) {
    return `${hours} ч`;
  }
  return `${minutes} мин`;
}

export function normalizeSearchToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\s_]+/gu, "")
    .trim();
}

export function isNaturalRemainingDoneText(value) {
  const text = String(value || "").toLowerCase().replace(/ё/gu, "е");
  const hasDoneVerb = /(сделал|сделала|сделали|выполнил|выполнила|выполнили|закрыл|закрыла|закрыли|готово|done)/iu.test(text);
  const hasRemaining = /(оставш|остальн|оставшиеся|оставшиеся задачи|все задачи|все пункты|все остальное|все остальные)/iu.test(text);
  return hasDoneVerb && hasRemaining;
}

export function stepIcon(status) {
  if (status === "succeeded") return "✅";
  if (status === "rejected") return "🚫";
  if (status === "unsupported") return "⚠️";
  return "❌";
}

export function stepStatusLabel(status) {
  const map = {
    succeeded: "выполнено",
    failed: "ошибка",
    rejected: "отклонено сотрудником",
    unsupported: "не поддерживается",
    expired: "истекло время",
  };
  return map[status] || status;
}

export function formatAssistantAnswer(answer) {
  if (answer && typeof answer === "object") {
    return {
      html: typeof answer.html === "string" ? answer.html : escapeHtml(answer.plainText ?? ""),
      plainText: typeof answer.plainText === "string" ? answer.plainText : "",
    };
  }
  const text = String(answer ?? "");
  return {
    html: markdownToTelegramHtml(text),
    plainText: text,
  };
}
