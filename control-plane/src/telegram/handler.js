import { buildBitrixProjectStatusReport } from "../domain/bitrix-reports.js";
import { unauthorized } from "../domain/errors.js";
import { redeemInviteCode } from "../domain/invite-codes.js";
import { listAccessibleUserIds, publicProject, publicUser } from "../domain/policy.js";
import { buildKickidlerActivitySummary } from "../domain/reports.js";
import { appendAuditEvent } from "../infra/audit.js";
import { parseTelegramCommand, resolveReportPeriod } from "./commands.js";
import { sendTokenUsageReportNow } from "./token-usage-reporter.js";

export async function handleTelegramMessage({
  store,
  telegram,
  kickidlerClient,
  bitrixClient,
  message,
  now = new Date(),
}) {
  const chatId = message?.chat?.id;
  const telegramUserId = message?.from?.id;
  const username = message?.from?.username;
  const command = parseTelegramCommand(message?.text);

  if (!chatId) {
    return;
  }

  try {
    switch (command.name) {
      case "start":
      case "help":
        await telegram.sendMessage({ chatId, text: helpText() });
        return;

      case "register":
        await registerTelegramUser({ store, telegram, chatId, telegramUserId, username, code: command.args[0] });
        return;

      case "me":
        await withActor(store, telegramUserId, async (state, actor) => {
          await telegram.sendMessage({ chatId, text: formatUser(actor) });
        });
        return;

      case "users":
        await withActor(store, telegramUserId, async (state, actor) => {
          const userIds = new Set(listAccessibleUserIds(state, actor));
          const users = state.users.filter((user) => userIds.has(user.id));
          await telegram.sendMessage({
            chatId,
            text: users.map((user) => `${escapeHtml(user.displayName)} - ${user.role}`).join("\n"),
          });
        });
        return;

      case "projects":
        await withActor(store, telegramUserId, async (state, actor) => {
          const projects = accessibleProjects(state, actor).map(publicProject);
          await telegram.sendMessage({
            chatId,
            text: projects.map((project) => `${project.id}: ${escapeHtml(project.name)}`).join("\n") || "No projects",
          });
        });
        return;

      case "report":
        await sendKickidlerReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          kickidlerClient,
          period: resolveReportPeriod(command.args[0], now),
        });
        return;

      case "project":
        await sendKickidlerReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          kickidlerClient,
          projectId: command.args[0],
          period: resolveReportPeriod(command.args[1], now),
        });
        return;

      case "bitrix":
        await sendBitrixReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          bitrixClient,
          projectId: command.args[0],
        });
        return;

      case "tokens":
        await sendTokenUsageReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          periodName: command.args[0] || "day",
          now,
        });
        return;

      default:
        await telegram.sendMessage({ chatId, text: "Unknown command. Use /help." });
    }
  } catch (error) {
    await telegram.sendMessage({
      chatId,
      text: `Error: ${escapeHtml(error instanceof Error ? error.message : "Unknown error")}`,
    });
  }
}

async function registerTelegramUser({ store, telegram, chatId, telegramUserId, username, code }) {
  const result = await store.update((state) => {
    const redeemed = redeemInviteCode(state, {
      code,
      telegramUserId,
      username,
    });
    appendAuditEvent(state, {
      actorUserId: redeemed.user.id,
      actorTelegramUserId: redeemed.user.telegram.telegramUserId,
      action: "telegram.register",
      target: { userId: redeemed.user.id, inviteCodeLast4: redeemed.invite.codeLast4 },
    });
    return publicUser(redeemed.user);
  });

  await telegram.sendMessage({
    chatId,
    text: `Registered: ${escapeHtml(result.displayName)} (${result.role})`,
  });
}

async function sendKickidlerReport({ store, telegram, chatId, telegramUserId, kickidlerClient, period, projectId }) {
  const report = await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return await buildKickidlerActivitySummary(state, {
      actor,
      request: {
        ...(projectId ? { projectId } : {}),
        from: period.from,
        to: period.to,
      },
      kickidlerClient,
    });
  });

  await telegram.sendMessage({ chatId, text: formatKickidlerReport(report, period.label) });
}

async function sendBitrixReport({ store, telegram, chatId, telegramUserId, bitrixClient, projectId }) {
  const report = await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return await buildBitrixProjectStatusReport(state, {
      actor,
      request: { projectId },
      bitrixClient,
    });
  });

  await telegram.sendMessage({ chatId, text: formatBitrixReport(report) });
}

async function sendTokenUsageReport({ store, telegram, chatId, telegramUserId, periodName, now }) {
  const recipientTelegramId = process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133";
  if (String(telegramUserId) !== String(recipientTelegramId)) {
    throw unauthorized("Token usage reports are restricted");
  }
  await sendTokenUsageReportNow({ store, telegram, chatId, periodName, now });
}

async function withActor(store, telegramUserId, callback) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  return await callback(state, actor);
}

function resolveActorByTelegramId(state, telegramUserId) {
  const actor = state.users.find((user) => user.telegram?.telegramUserId === String(telegramUserId));
  if (!actor) {
    throw unauthorized("Telegram account is not registered. Use /register CODE.");
  }
  return actor;
}

function accessibleProjects(state, actor) {
  const userIds = new Set(listAccessibleUserIds(state, actor));
  if (actor.role === "OWNER") {
    return state.projects;
  }
  return state.projects.filter((project) => {
    return project.managerUserId === actor.id || project.memberUserIds.some((id) => userIds.has(id));
  });
}

function formatUser(user) {
  const publicView = publicUser(user);
  return [
    `User: ${escapeHtml(publicView.displayName)}`,
    `Role: ${publicView.role}`,
    `ID: ${publicView.id}`,
  ].join("\n");
}

function formatKickidlerReport(report, label) {
  const lines = [
    `Metricon activity (${escapeHtml(label)})`,
    `Source: ${report.source}${report.configured ? "" : " mock"}`,
    `Employees: ${report.employees.length}`,
  ];
  for (const item of report.employees.slice(0, 10)) {
    const activeSeconds = item.metrics?.activeSeconds ?? item.metrics?.raw?.data?.totalActiveTime ?? null;
    lines.push(`- ${escapeHtml(item.user.displayName)}: active=${formatSeconds(activeSeconds)}`);
  }
  return lines.join("\n");
}

function formatBitrixReport(report) {
  const lines = [
    `Bitrix project: ${escapeHtml(report.project.name)}`,
    `Source: ${report.source}${report.configured ? "" : " mock"}`,
    `Tasks: ${report.summary.total}, open: ${report.summary.open}, overdue: ${report.summary.overdue}`,
  ];
  for (const task of report.tasks.slice(0, 8)) {
    const overdue = task.overdue ? " overdue" : "";
    lines.push(`- [${task.statusLabel}${overdue}] ${escapeHtml(task.title)}`);
  }
  return lines.join("\n");
}

function formatSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return "n/a";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function helpText() {
  return [
    "Commands:",
    "/register CODE - link Telegram account",
    "/me - show your profile",
    "/users - list users you can access",
    "/projects - list projects you can access",
    "/report today|week - Metricon summary",
    "/project PROJECT_ID today|week - Metricon project summary",
    "/bitrix PROJECT_ID - Bitrix project status",
    "/tokens day|week|month - token usage report",
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
