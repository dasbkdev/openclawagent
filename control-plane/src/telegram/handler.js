import { ClaudeApiError } from "../assistant/claude-client.js";
import { answerCompanyAssistant, isWebResearchQuery } from "../assistant/company-assistant.js";
import { buildBitrixProjectStatusReport } from "../domain/bitrix-reports.js";
import { buildPlatrumProjectStatusReport } from "../domain/platrum-reports.js";
import {
  addDailyBlocker,
  buildDailyManagerReport,
  buildDailyProgress,
  createOrUpdateDailyPlan,
  formatBlockerResult,
  formatDailyPlan,
  formatDailyProgress,
  formatDoneResult,
  formatManagerReport,
  formatRemainingDoneResult,
  getCommandRemainder,
  findTodayPlanForUser,
  markDailyPlanItemDone,
  markRemainingDailyPlanItemsDone,
} from "../domain/daily-assistant.js";
import {
  parseNaturalPlanIntent,
  parseNaturalDoneIntent,
  matchPlanItemByPhrase,
} from "../domain/natural-plan-actions.js";
import {
  createDeviceCommand,
  listVisibleDeviceAgents,
  listVisibleDeviceCommands,
} from "../domain/device-agents.js";
import { unauthorized, validation } from "../domain/errors.js";
import {
  createInviteCode,
  generateInviteCode,
  hashInviteCode,
  redeemInviteCode,
  reissueInviteCode,
} from "../domain/invite-codes.js";
import { autoResolveUserMappings } from "../domain/external-mapping.js";
import { runAgentTask, makeDeviceCommandRunner, resolveAgentTaskDevice } from "../assistant/agent-loop.js";
import { createBrowserClientFromEnv } from "../integrations/browser-client.js";
import {
  formatNaturalDeviceCommandQueued,
  tryCreateNaturalDeviceCommand,
} from "../domain/natural-device-actions.js";
import { recordAssistantMemoryEvent } from "../domain/assistant-memory.js";
import { listAccessibleUserIds, publicProject, publicUser } from "../domain/policy.js";
import { buildIntegrationsHealth } from "../domain/integration-health.js";
import { buildKickidlerActivitySummary } from "../domain/reports.js";
import { appendAuditEvent } from "../infra/audit.js";
import { VoiceServiceError } from "../integrations/voice-service.js";
import { formatCommandMenuHelp, TELEGRAM_BOT_COMMANDS } from "./bot-commands.js";
import { parseTelegramCommand, resolveReportPeriod } from "./commands.js";
import { sendTokenUsageReportNow } from "./token-usage-reporter.js";
import { escapeHtml, markdownToTelegramHtml, renderBlocks, sendLongMessage } from "./render.js";
import {
  code,
  codeLine,
  formatAssistantAnswer,
  formatDateTime,
  formatRole,
  formatSeconds,
  formatSource,
  formatTaskStatus,
  isNaturalRemainingDoneText,
  kv,
  normalizeSearchToken,
  stepIcon,
  stepStatusLabel,
  subtitle,
  title,
} from "./format.js";

export async function handleTelegramMessage({
  store,
  telegram,
  kickidlerClient,
  bitrixClient,
  platrumClient,
  claudeClient,
  googleOAuthService,
  voiceService,
  message,
  now = new Date(),
}) {
  const chatId = message?.chat?.id;
  const telegramUserId = message?.from?.id;
  const username = message?.from?.username;
  const firstName = message?.from?.first_name;
  const lastName = message?.from?.last_name;
  const voice = message?.voice;
  let command = parseTelegramCommand(message?.text);
  let voiceReplyRequested = Boolean(voiceService?.wantsVoiceReply(command.raw));

  if (!chatId) {
    return;
  }

  try {
    if (!command.raw && voice) {
      if (!voiceService) {
        throw new VoiceServiceError("Голосовые сообщения пока не подключены на сервере.");
      }
      const transcript = await voiceService.transcribeTelegramVoice({ telegram, voice });
      if (!transcript.text) {
        throw new VoiceServiceError("Не получилось распознать голосовое сообщение. Попробуй сказать короче или отправь текстом.");
      }
      voiceReplyRequested = voiceService.wantsVoiceReply(transcript.text);
      command = parseTelegramCommand(transcript.text);
    }

    if (voiceReplyRequested && command.raw.startsWith("/")) {
      command = stripVoiceDirectiveFromCommand(command);
    }

    telegram = createVoiceAwareTelegram({
      telegram,
      voiceService,
      voiceReplyRequested,
    });

    switch (command.name) {
      case "start":
      case "help":
        await telegram.sendMessage({ chatId, text: helpText() });
        return;

      case "register":
        await registerTelegramUser({
          store,
          telegram,
          chatId,
          telegramUserId,
          username,
          firstName,
          lastName,
          code: command.args[0],
          platrumClient,
          bitrixClient,
          kickidlerClient,
        });
        return;

      case "invite":
        await createTelegramInvite({
          store,
          telegram,
          chatId,
          telegramUserId,
          target: command.args[0],
          ttl: command.args[1],
        });
        return;

      case "reset_code":
      case "reissue_code":
        await resetTelegramInviteCode({
          store,
          telegram,
          chatId,
          telegramUserId,
          target: command.args[0],
          ttl: command.args[1],
        });
        return;

      case "reset_owner_code":
        await recoverOwnerRegistrationCode({
          store,
          telegram,
          chatId,
          telegramUserId,
          args: command.args,
          now,
        });
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
          await telegram.sendMessage({ chatId, text: formatUsers(users) });
        });
        return;

      case "agents":
        await withActor(store, telegramUserId, async (state, actor) => {
          const agents = listVisibleDeviceAgents(state, actor);
          await telegram.sendMessage({ chatId, text: formatDeviceAgents(agents) });
        });
        return;

      case "device":
        await sendDeviceCommand({
          store,
          telegram,
          chatId,
          telegramUserId,
          args: command.args,
        });
        return;

      case "task":
        await runAgentTaskCommand({
          store,
          telegram,
          chatId,
          telegramUserId,
          claudeClient,
          instruction: command.args.join(" "),
        });
        return;

      case "projects":
        await withActor(store, telegramUserId, async (state, actor) => {
          const projects = accessibleProjects(state, actor).map(publicProject);
          await telegram.sendMessage({ chatId, text: formatProjects(projects) });
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
        if (!platrumClient?.getProjectTasks) {
          await sendBitrixReport({
            store,
            telegram,
            chatId,
            telegramUserId,
            bitrixClient,
            projectId: command.args[0],
          });
          return;
        }
        await sendPlatrumReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          platrumClient,
          projectId: command.args[0],
        });
        return;

      case "platrum":
        await sendPlatrumReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          platrumClient,
          projectId: command.args[0],
        });
        return;

      case "today":
      case "progress":
        await sendDailyProgress({
          store,
          telegram,
          chatId,
          telegramUserId,
          kickidlerClient,
          bitrixClient,
          platrumClient,
          target: command.args[0],
          now,
        });
        return;

      case "plan":
        await saveDailyPlan({
          store,
          telegram,
          chatId,
          telegramUserId,
          text: getCommandRemainder(command),
          now,
        });
        return;

      case "blocker":
        await saveDailyBlocker({
          store,
          telegram,
          chatId,
          telegramUserId,
          text: getCommandRemainder(command),
          now,
        });
        return;

      case "done":
        await markDailyDone({
          store,
          telegram,
          chatId,
          telegramUserId,
          selector: getCommandRemainder(command),
          now,
        });
        return;

      case "daily_report":
        await sendDailyReport({
          store,
          telegram,
          chatId,
          telegramUserId,
          kickidlerClient,
          bitrixClient,
          platrumClient,
          target: command.args[0],
          now,
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

      case "ai_status":
        await sendAiStatus({
          store,
          telegram,
          chatId,
          telegramUserId,
          claudeClient,
        });
        return;

      case "status":
        await sendIntegrationsStatus({
          store,
          telegram,
          chatId,
          telegramUserId,
          claudeClient,
          kickidlerClient,
          platrumClient,
          bitrixClient,
          voiceService,
          googleOAuthService,
        });
        return;

      case "google_connect":
      case "google":
        await sendGoogleConnect({
          store,
          telegram,
          chatId,
          telegramUserId,
          googleOAuthService,
        });
        return;

      case "google_status":
        await sendGoogleStatus({
          store,
          telegram,
          chatId,
          telegramUserId,
          googleOAuthService,
        });
        return;

      case "google_disconnect":
        await disconnectGoogle({
          store,
          telegram,
          chatId,
          telegramUserId,
          googleOAuthService,
        });
        return;

      default:
        if (command.raw && !command.raw.startsWith("/")) {
          const handledPlanCreate = await maybeCreateNaturalPlan({
            store, telegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledPlanCreate) {
            return;
          }

          const handledDailyUpdate = await maybeMarkRemainingDailyDone({
            store,
            telegram,
            chatId,
            telegramUserId,
            text: command.raw,
            now,
          });
          if (handledDailyUpdate) {
            return;
          }

          const handledNaturalDone = await maybeMarkNaturalDone({
            store, telegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledNaturalDone) {
            return;
          }

          const handledDeviceAction = await maybeSendNaturalDeviceCommand({
            store,
            telegram,
            chatId,
            telegramUserId,
            text: command.raw,
            now,
          });
          if (handledDeviceAction) {
            return;
          }

          if (isWebResearchQuery(command.raw)) {
            await telegram.sendMessage({ chatId, text: "🔎 Ищу в интернете, это может занять минуту-полторы…" }).catch(() => {});
          }
          const answer = await answerCompanyAssistant({
            store,
            telegramUserId,
            question: command.raw,
            claudeClient,
            kickidlerClient,
            bitrixClient,
            platrumClient,
            googleOAuthService,
            now,
          });
          await sendAssistantAnswer({ telegram, chatId, answer, voiceService, voiceReplyRequested });
          return;
        }
        await telegram.sendMessage({ chatId, text: unknownCommandText() });
    }
  } catch (error) {
    await telegram.sendMessage({
      chatId,
      text: formatTelegramError(error),
    });
  }
}

/**
 * Process a single Telegram update with its own error isolation: a
 * failure handling one update is logged and (best-effort) reported to
 * the chat, but never propagates to the caller so the rest of a batch of
 * updates keeps being processed.
 *
 * `buildMessageDeps` is called once per update and must return the
 * extra dependencies handleTelegramMessage needs (kickidlerClient,
 * bitrixClient, platrumClient, claudeClient, voiceService, ...).
 */
export async function processTelegramUpdate({ update, store, telegram, googleOAuthService, buildMessageDeps, now = new Date() }) {
  if (!update?.message) {
    return;
  }

  try {
    const extraDeps = buildMessageDeps ? await buildMessageDeps(update) : {};
    await handleTelegramMessage({
      store,
      telegram,
      googleOAuthService,
      ...extraDeps,
      message: update.message,
      now,
    });
  } catch (error) {
    console.error(
      `telegram update ${update.update_id} failed:`,
      error instanceof Error ? error.message : error,
    );
    const chatId = update.message?.chat?.id;
    if (chatId) {
      try {
        await telegram.sendMessage({
          chatId,
          text: "Не получилось обработать сообщение, попробуй ещё раз.",
        });
      } catch (sendError) {
        console.error(
          `telegram update ${update.update_id} failure notice failed:`,
          sendError instanceof Error ? sendError.message : sendError,
        );
      }
    }
  }
}

async function registerTelegramUser({
  store,
  telegram,
  chatId,
  telegramUserId,
  username,
  firstName,
  lastName,
  code,
  platrumClient,
  bitrixClient,
  kickidlerClient,
}) {
  const result = await store.update((state) => {
    const redeemed = redeemInviteCode(state, {
      code,
      telegramUserId,
      username,
      firstName,
      lastName,
    });
    appendAuditEvent(state, {
      actorUserId: redeemed.user.id,
      actorTelegramUserId: redeemed.user.telegram.telegramUserId,
      action: "telegram.register",
      target: { userId: redeemed.user.id, inviteCodeLast4: redeemed.invite.codeLast4 },
    });
    return publicUser(redeemed.user);
  });

  // Auto-resolve Platrum/Bitrix/Metricon IDs by name through the
  // company-wide service accounts so the new employee's data works
  // immediately, without manual mapping.
  let mappingNote = null;
  try {
    const resolved = await autoResolveUserMappings({
      store,
      userId: result.id,
      platrumClient,
      bitrixClient,
      kickidlerClient,
    });
    const found = [];
    if (resolved.updated.platrumUserId) found.push("Platrum");
    if (resolved.updated.bitrixUserId) found.push("Bitrix");
    if (resolved.updated.kickidlerEmployeeId) found.push("Metricon");
    if (found.length > 0) {
      mappingNote = `Нашел тебя в системах: ${found.join(", ")}.`;
    }
  } catch (error) {
    console.error(`auto mapping after register failed: ${error instanceof Error ? error.message : error}`);
  }

  await telegram.sendMessage({
    chatId,
    text: [
      title("Регистрация завершена"),
      kv("Сотрудник", result.displayName),
      kv("Роль", formatRole(result.role)),
      ...(mappingNote ? ["", mappingNote] : []),
      "",
      "Теперь подключи Google, если это еще не сделано:",
      codeLine("/google_connect"),
    ].join("\n"),
  });
}

async function createTelegramInvite({ store, telegram, chatId, telegramUserId, target, ttl }) {
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    if (!target || target === "list") {
      return { kind: "help", text: formatInviteHelp(state) };
    }

    const targetUser = resolveInviteTargetUser(state, target);
    if (targetUser.telegram?.telegramUserId) {
      throw validation("Этот пользователь уже привязан к Telegram", {
        userId: targetUser.id,
        displayName: targetUser.displayName,
      });
    }

    const created = createInviteCode(state, {
      issuer: actor,
      userId: targetUser.id,
      ttlMinutes: normalizeInviteTtl(ttl),
    });
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: "telegram.invite.create",
      target: {
        userId: created.invite.userId,
        inviteCodeLast4: created.invite.codeLast4,
      },
    });
    return {
      kind: "created",
      code: created.code,
      invite: created.invite,
      targetUser: publicUser(targetUser),
    };
  });

  await telegram.sendMessage({
    chatId,
    text: result.kind === "help" ? result.text : formatInviteCreated(result),
  });
}

async function resetTelegramInviteCode({ store, telegram, chatId, telegramUserId, target, ttl }) {
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    if (!target || target === "list") {
      return { kind: "help", text: formatResetCodeHelp(state) };
    }

    const targetUser = resolveInviteTargetUser(state, target);
    const reissued = reissueInviteCode(state, {
      issuer: actor,
      userId: targetUser.id,
      ttlMinutes: normalizeInviteTtl(ttl),
    });
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: "telegram.invite.reissue",
      target: {
        userId: reissued.invite.userId,
        inviteCodeLast4: reissued.invite.codeLast4,
      },
      metadata: {
        revokedCount: reissued.revokedCount,
      },
    });
    return {
      kind: "created",
      code: reissued.code,
      invite: reissued.invite,
      revokedCount: reissued.revokedCount,
      targetUser: publicUser(targetUser),
    };
  });

  await telegram.sendMessage({
    chatId,
    text: result.kind === "help" ? result.text : formatInviteReissued(result),
  });
}

async function recoverOwnerRegistrationCode({ store, telegram, chatId, telegramUserId, args, now }) {
  const allowedIds = new Set(
    String(process.env.DEVELOPER_TELEGRAM_IDS || "984834133")
      .split(/[,\s]+/u)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const requesterId = String(telegramUserId);
  if (!allowedIds.has(requesterId)) {
    throw unauthorized("Эта аварийная команда доступна только разработчику Starlab.");
  }

  const isConfirmation = String(args?.[0] || "").toLowerCase() === "confirm";
  const nonce = String(args?.[1] || "").trim().toUpperCase();
  const result = await store.update((state) => {
    state.ownerRecoveryRequests ??= [];
    const owner = state.users.find((user) => user.role === "OWNER");
    if (!owner) {
      throw validation("В системе не найден пользователь с ролью OWNER.");
    }

    if (!isConfirmation) {
      const rawNonce = generateInviteCode(6);
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      state.ownerRecoveryRequests.push({
        id: `owner-recovery-${requesterId}-${now.getTime()}`,
        telegramUserId: requesterId,
        nonceHash: hashInviteCode(rawNonce),
        createdAt: now.toISOString(),
        expiresAt,
        confirmedAt: null,
      });
      appendAuditEvent(state, {
        actorTelegramUserId: requesterId,
        action: "telegram.owner_invite.recovery_requested",
        target: { userId: owner.id },
        metadata: { expiresAt },
      });
      return { kind: "challenge", nonce: rawNonce, expiresAt };
    }

    if (!nonce) {
      throw validation("Укажи код подтверждения: /reset_owner_code confirm КОД");
    }
    const request = [...state.ownerRecoveryRequests]
      .reverse()
      .find((item) => item.telegramUserId === requesterId && !item.confirmedAt);
    if (!request || new Date(request.expiresAt).getTime() < now.getTime()) {
      throw validation("Запрос подтверждения не найден или истёк. Сначала отправь /reset_owner_code");
    }
    if (request.nonceHash !== hashInviteCode(nonce)) {
      throw validation("Неверный код подтверждения.");
    }

    request.confirmedAt = now.toISOString();
    const reissued = reissueInviteCode(state, {
      issuer: owner,
      userId: owner.id,
      ttlMinutes: 1440,
      now,
    });
    appendAuditEvent(state, {
      actorUserId: owner.id,
      actorTelegramUserId: requesterId,
      action: "telegram.owner_invite.recovery_reissue",
      target: {
        userId: owner.id,
        inviteCodeLast4: reissued.invite.codeLast4,
      },
      metadata: {
        recoveryRequestId: request.id,
        revokedCount: reissued.revokedCount,
      },
    });
    return {
      kind: "reissued",
      code: reissued.code,
      invite: reissued.invite,
      ownerTelegramId: owner.telegram?.telegramUserId || null,
      revokedCount: reissued.revokedCount,
    };
  });

  if (result.kind === "challenge") {
    await telegram.sendMessage({
      chatId,
      text: [
        "Аварийный сброс кода Николая запрошен.",
        `Код подтверждения: ${result.nonce}`,
        `Действует до: ${formatDateTime(result.expiresAt)}`,
        "",
        `Подтверди: /reset_owner_code confirm ${result.nonce}`,
        "Текущая Telegram-привязка, память и активные устройства Николая не изменятся.",
      ].join("\n"),
    });
    return;
  }

  const text = [
    "Новый registration code Николая создан.",
    `Код: ${result.code}`,
    `Действует до: ${formatDateTime(result.invite.expiresAt)}`,
    `Старых активных кодов отозвано: ${result.revokedCount}`,
    "",
    "Код можно использовать для привязки нового локального OpenClaw.",
  ].join("\n");
  await telegram.sendMessage({ chatId, text });
  if (result.ownerTelegramId && String(result.ownerTelegramId) !== requesterId) {
    await telegram.sendMessage({
      chatId: result.ownerTelegramId,
      text: [
        "Разработчик Starlab аварийно перевыпустил твой registration code.",
        "Действующие Telegram-привязка, память и уже активированные устройства не сбрасывались.",
      ].join("\n"),
    });
  }
}

async function runAgentTaskCommand({ store, telegram, chatId, telegramUserId, claudeClient, instruction }) {
  const trimmed = String(instruction || "").trim();
  if (!trimmed) {
    await telegram.sendMessage({
      chatId,
      text: [
        title("Поручить задачу агенту"),
        "Опиши задачу текстом после команды. Пример:",
        code("/task собери все xlsx из папки Загрузки в архив на рабочем столе"),
        "",
        "Агент выполнит её по шагам на твоём компьютере. Действия, меняющие файлы или запускающие скрипты, спросят подтверждение на устройстве.",
      ].join("\n"),
    });
    return;
  }

  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  let device;
  try {
    device = resolveAgentTaskDevice(state, actor, {});
  } catch (error) {
    await telegram.sendMessage({ chatId, text: formatTelegramError(error) });
    return;
  }

  await telegram.sendMessage({
    chatId,
    text: [title("Принял задачу"), kv("Устройство", device.displayName || device.deviceId), "Работаю по шагам, это может занять до минуты…"].join("\n"),
  });

  const enqueueAndWait = makeDeviceCommandRunner({ store, actor, device });
  const outcome = await runAgentTask({
    store,
    claudeClient,
    actor,
    device,
    instruction: trimmed,
    enqueueAndWait,
    browserClient: createBrowserClientFromEnv(),
  });

  const lines = [title(outcome.ok ? "Задача выполнена" : "Задача завершена")];
  if (outcome.steps?.length) {
    lines.push("", subtitle("Шаги"));
    for (const step of outcome.steps) {
      lines.push(`${stepIcon(step.status)} ${escapeHtml(step.type)}${step.sensitive ? " 🔒" : ""} — ${escapeHtml(stepStatusLabel(step.status))}`);
    }
  }
  lines.push("", escapeHtml(outcome.summary || ""));
  await sendLongMessage({ telegram, chatId, text: lines.join("\n") });
}

async function sendDeviceCommand({ store, telegram, chatId, telegramUserId, args }) {
  const parsed = parseDeviceCommandArgs(args);
  if (parsed.kind === "help") {
    await withActor(store, telegramUserId, async (state, actor) => {
      await telegram.sendMessage({ chatId, text: formatDeviceCommandHelp(state, actor) });
    });
    return;
  }

  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const target = resolveDeviceCommandTarget(state, actor, parsed.target);
    const command = createDeviceCommand(
      state,
      {
        ...target,
        type: parsed.type,
        args: parsed.commandArgs,
        source: "telegram",
        ttlSeconds: 300,
      },
      { actor },
    );
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: "telegram.device_command.create",
      target: {
        commandId: command.id,
        deviceId: command.deviceId,
        userId: command.userId,
        type: command.type,
      },
    });
    return {
      command,
      recent: listVisibleDeviceCommands(state, actor, { deviceId: command.deviceId, limit: 5 }),
    };
  });

  await telegram.sendMessage({ chatId, text: formatDeviceCommandQueued(result.command, result.recent) });
}

async function maybeSendNaturalDeviceCommand({ store, telegram, chatId, telegramUserId, text, now }) {
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const queued = tryCreateNaturalDeviceCommand(state, {
      actor,
      text,
      source: "telegram-natural-language",
      now,
    });
    if (!queued) {
      return null;
    }
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: "telegram.device_command.create",
      target: {
        commandId: queued.command.id,
        deviceId: queued.command.deviceId,
        userId: queued.command.userId,
        type: queued.command.type,
      },
      metadata: {
        naturalLanguage: true,
      },
    });
    const answer = formatNaturalDeviceCommandQueued(queued);
    recordAssistantMemoryEvent(state, {
      userId: actor.id,
      channel: "telegram",
      role: "user",
      kind: "device_action_request",
      text,
      target: {
        userId: queued.command.userId,
        deviceId: queued.command.deviceId,
        commandId: queued.command.id,
      },
      metadata: {
        type: queued.command.type,
        args: queued.command.args,
        previousCommandId: queued.previousCommand?.id || null,
      },
      now,
    });
    recordAssistantMemoryEvent(state, {
      userId: actor.id,
      channel: "telegram",
      role: "assistant",
      kind: "device_action_response",
      text: answer,
      target: {
        userId: queued.command.userId,
        deviceId: queued.command.deviceId,
        commandId: queued.command.id,
      },
      metadata: {
        type: queued.command.type,
        args: queued.command.args,
        previousCommandId: queued.previousCommand?.id || null,
      },
      now,
    });
    return queued;
  });

  if (!result) {
    return false;
  }

  await telegram.sendMessage({ chatId, text: formatNaturalDeviceCommandQueued(result) });
  return true;
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

  await sendLongMessage({ telegram, chatId, text: formatMetriconReport(report, period.label) });
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

  await sendLongMessage({ telegram, chatId, text: formatBitrixReport(report) });
}

async function sendPlatrumReport({ store, telegram, chatId, telegramUserId, platrumClient, projectId }) {
  const report = await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return await buildPlatrumProjectStatusReport(state, {
      actor,
      request: { projectId },
      platrumClient,
    });
  });

  await sendLongMessage({ telegram, chatId, text: formatPlatrumReport(report) });
}

async function saveDailyPlan({ store, telegram, chatId, telegramUserId, text, now }) {
  // /plan with no text: show the current plan and a friendly hint instead of
  // erroring.
  if (!String(text || "").trim()) {
    const current = await store.update((state) => {
      const actor = resolveActorByTelegramId(state, telegramUserId);
      return findTodayPlanForUser(state, actor.id, now);
    });
    if (current && current.items?.length) {
      await telegram.sendMessage({
        chatId,
        text: [formatDailyPlan(current), "", "Чтобы задать новый план, просто напиши его:", code("План на сегодня"), code("1. ..."), code("2. ...")].join("\n"),
      });
    } else {
      await telegram.sendMessage({
        chatId,
        text: [
          title("План дня"),
          "Напиши план списком — команда не нужна. Например:",
          "",
          code("План на сегодня"),
          code("1. Провести собрание"),
          code("2. Созвон с Жакшылыком"),
          code("3. Подтвердить график сотрудников"),
          "",
          "Когда что-то сделаешь — просто напиши «созвон провёл» или «всё сделал», и я отмечу.",
        ].join("\n"),
      });
    }
    return;
  }

  const plan = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return createOrUpdateDailyPlan(state, { actor, text, now });
  });

  await telegram.sendMessage({ chatId, text: formatDailyPlan(plan) });
}

async function maybeCreateNaturalPlan({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseNaturalPlanIntent(text);
  if (!intent) {
    return false;
  }
  const plan = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const created = createOrUpdateDailyPlan(state, { actor, text: intent.items.join("\n"), now });
    recordAssistantMemoryEvent(state, {
      userId: actor.id, channel: "telegram", role: "user",
      kind: "daily_plan_natural_create", text,
      target: { userId: actor.id, date: created.date }, now,
    });
    return created;
  });
  await telegram.sendMessage({
    chatId,
    text: [title("План на сегодня принят"), formatDailyPlan(plan), "", "Когда выполнишь пункт — напиши, например, «собрание провёл», и я отмечу его."].join("\n"),
  });
  return true;
}

async function maybeMarkNaturalDone({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseNaturalDoneIntent(text);
  if (!intent) {
    return false;
  }
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const plan = findTodayPlanForUser(state, actor.id, now);
    if (!plan || !plan.items?.length) {
      return { handled: false };
    }
    const match = matchPlanItemByPhrase(plan, intent.reference);
    if (!match) {
      return { handled: false };
    }
    const done = markDailyPlanItemDone(state, { actor, selector: String(match.index), now });
    recordAssistantMemoryEvent(state, {
      userId: actor.id, channel: "telegram", role: "user",
      kind: "daily_plan_natural_done", text,
      target: { userId: actor.id, date: done.plan.date, itemId: done.item.id }, now,
    });
    return { handled: true, result: done };
  });
  if (!result.handled) {
    return false;
  }
  await telegram.sendMessage({ chatId, text: formatDoneResult(result.result) });
  return true;
}

async function sendDailyProgress({ store, telegram, chatId, telegramUserId, kickidlerClient, bitrixClient, platrumClient, target, now }) {
  const progress = await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const targetUser = resolveVisibleUserTarget(state, actor, target);
    return await buildDailyProgress(state, {
      actor,
      userId: targetUser.id,
      now,
      kickidlerClient,
      bitrixClient,
      platrumClient,
    });
  });

  await telegram.sendMessage({ chatId, text: formatDailyProgress(progress) });
}

async function saveDailyBlocker({ store, telegram, chatId, telegramUserId, text, now }) {
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return addDailyBlocker(state, { actor, text, now });
  });

  await telegram.sendMessage({ chatId, text: formatBlockerResult(result) });
}

async function markDailyDone({ store, telegram, chatId, telegramUserId, selector, now }) {
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    return markDailyPlanItemDone(state, { actor, selector, now });
  });

  await telegram.sendMessage({ chatId, text: formatDoneResult(result) });
}

async function maybeMarkRemainingDailyDone({ store, telegram, chatId, telegramUserId, text, now }) {
  if (!isNaturalRemainingDoneText(text)) {
    return false;
  }

  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const completed = markRemainingDailyPlanItemsDone(state, { actor, now });
    const answer = formatRemainingDoneResult(completed);
    recordAssistantMemoryEvent(state, {
      userId: actor.id,
      channel: "telegram",
      role: "user",
      kind: "daily_plan_remaining_done_request",
      text,
      target: { userId: actor.id, date: completed.plan.date },
      metadata: { completedCount: completed.completedCount },
      now,
    });
    recordAssistantMemoryEvent(state, {
      userId: actor.id,
      channel: "telegram",
      role: "assistant",
      kind: "daily_plan_remaining_done_response",
      text: answer,
      target: { userId: actor.id, date: completed.plan.date },
      metadata: { completedCount: completed.completedCount },
      now,
    });
    return { answer };
  });

  await telegram.sendMessage({ chatId, text: result.answer });
  return true;
}

async function sendDailyReport({ store, telegram, chatId, telegramUserId, kickidlerClient, bitrixClient, platrumClient, target, now }) {
  const report = await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const targetUser = resolveDailyReportTarget(state, actor, target);
    return await buildDailyManagerReport(state, {
      actor,
      targetUserId: targetUser?.id,
      now,
      kickidlerClient,
      bitrixClient,
      platrumClient,
    });
  });

  await sendLongMessage({ telegram, chatId, text: formatManagerReport(report) });
}

async function sendTokenUsageReport({ store, telegram, chatId, telegramUserId, periodName, now }) {
  const recipientTelegramId = process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133";
  if (String(telegramUserId) !== String(recipientTelegramId)) {
    throw unauthorized("Отчеты по токенам доступны только владельцу");
  }
  await sendTokenUsageReportNow({ store, telegram, chatId, periodName, now });
}

async function sendAiStatus({ store, telegram, chatId, telegramUserId, claudeClient }) {
  await withActor(store, telegramUserId, async () => {});
  if (!claudeClient?.healthCheck) {
    await telegram.sendMessage({
      chatId,
      text: [
        title("Claude API"),
        "Диагностика недоступна: клиент Claude не поддерживает healthCheck.",
      ].join("\n"),
    });
    return;
  }
  const status = await claudeClient.healthCheck();
  await telegram.sendMessage({ chatId, text: formatAiStatus(status) });
}

async function sendIntegrationsStatus({
  store,
  telegram,
  chatId,
  telegramUserId,
  claudeClient,
  kickidlerClient,
  platrumClient,
  bitrixClient,
  voiceService,
  googleOAuthService,
}) {
  const actor = await withActor(store, telegramUserId, async (_state, resolved) => resolved);
  if (actor.role !== "OWNER") {
    throw unauthorized("Команда /status доступна только владельцу.");
  }
  const health = await buildIntegrationsHealth({
    claudeClient,
    telegramApi: telegram,
    kickidlerClient,
    platrumClient,
    bitrixClient,
    voiceService,
    googleOAuthService,
  });
  await telegram.sendMessage({ chatId, text: formatIntegrationsStatus(health) });
}

async function sendGoogleConnect({ store, telegram, chatId, telegramUserId, googleOAuthService }) {
  assertGoogleOAuthService(googleOAuthService);
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  const result = await googleOAuthService.buildAuthorizationUrl({ userId: actor.id });
  await telegram.sendMessage({
    chatId,
    text: [
      title("Подключение Google"),
      "Открой ссылку и выдай доступы календарю, Gmail, Drive, Docs и Sheets:",
      escapeHtml(result.authorizationUrl),
      "",
      "После подтверждения Google вернет тебя на сервер. Refresh token сохранится зашифрованно.",
    ].join("\n"),
  });
}

async function sendGoogleStatus({ store, telegram, chatId, telegramUserId, googleOAuthService }) {
  assertGoogleOAuthService(googleOAuthService);
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  const status = await googleOAuthService.status({ userId: actor.id });
  await telegram.sendMessage({ chatId, text: formatGoogleStatus(status) });
}

async function disconnectGoogle({ store, telegram, chatId, telegramUserId, googleOAuthService }) {
  assertGoogleOAuthService(googleOAuthService);
  await store.update(async (state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    await googleOAuthService.disconnect({ userId: actor.id });
    appendAuditEvent(state, {
      actorUserId: actor.id,
      actorTelegramUserId: actor.telegram?.telegramUserId,
      action: "google.oauth.disconnect",
      target: { userId: actor.id },
    });
  });
  await telegram.sendMessage({
    chatId,
    text: [
      title("Google отключен"),
      "Google аккаунт отключен для твоего пользователя.",
      "Чтобы подключить его заново, используй:",
      codeLine("/google_connect"),
    ].join("\n"),
  });
}

async function withActor(store, telegramUserId, callback) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  return await callback(state, actor);
}

function resolveActorByTelegramId(state, telegramUserId) {
  const actor = state.users.find((user) => user.telegram?.telegramUserId === String(telegramUserId));
  if (!actor) {
    throw unauthorized("Telegram аккаунт не зарегистрирован. Используй /register CODE.");
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

function resolveVisibleUserTarget(state, actor, target) {
  if (!target) {
    return actor;
  }
  const normalized = normalizeSearchToken(target);
  const visibleUserIds = new Set(listAccessibleUserIds(state, actor));
  const user = state.users.find((candidate) => {
    if (!visibleUserIds.has(candidate.id)) {
      return false;
    }
    return userSearchAliases(candidate).some((alias) => normalizeSearchToken(alias) === normalized);
  });
  if (!user) {
    throw validation("Не нашел доступного сотрудника. Используй /users, затем /progress USER_ID.", { target });
  }
  return user;
}

function resolveDailyReportTarget(state, actor, target) {
  if (!target || ["team", "all", "все", "команда"].includes(normalizeSearchToken(target))) {
    return null;
  }
  return resolveVisibleUserTarget(state, actor, target);
}

function resolveInviteTargetUser(state, target) {
  const normalized = normalizeSearchToken(target);
  const aliases = new Map();
  for (const user of state.users) {
    for (const alias of userSearchAliases(user)) {
      const key = normalizeSearchToken(alias);
      if (key) {
        aliases.set(key, user);
      }
    }
  }
  const user = aliases.get(normalized);
  if (!user) {
    throw validation("Не нашел пользователя для invite. Используй /invite, чтобы увидеть список.", { target });
  }
  return user;
}

function userSearchAliases(user) {
  return [
    user.id,
    user.employeeId,
    user.displayName,
    user.displayName?.replace(/\s+/gu, ""),
    user.id?.replace(/^u-/u, ""),
    user.employeeId?.replace(/-/gu, ""),
  ].filter(Boolean);
}

function normalizeInviteTtl(value) {
  if (value === undefined || value === null || value === "") {
    return 1440;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 1440) {
    throw validation("TTL должен быть числом минут от 1 до 1440");
  }
  return normalized;
}

function parseDeviceCommandArgs(args) {
  if (!args.length || ["help", "list", "status"].includes(String(args[0] || "").toLowerCase())) {
    return { kind: "help" };
  }
  const target = args[0];
  const action = String(args[1] || "").toLowerCase();
  if (!target || !action) {
    return { kind: "help" };
  }
  const rest = args.slice(2);
  const text = rest.join(" ").trim();
  const actionMap = {
    open: "open_app",
    open_app: "open_app",
    app: "open_app",
    close: "close_app",
    close_app: "close_app",
    url: "open_url",
    open_url: "open_url",
    youtube: "play_youtube",
    play_youtube: "play_youtube",
    song: "play_youtube",
    music: "play_youtube",
    file: "open_file",
    open_file: "open_file",
    apps: "list_running_apps",
    processes: "list_running_apps",
    list_running_apps: "list_running_apps",
    active: "active_window",
    active_window: "active_window",
    screenshot: "screenshot",
    shot: "screenshot",
    clipboard_get: "clipboard_get",
    clip: "clipboard_get",
    clipboard_set: "clipboard_set",
    setclip: "clipboard_set",
    type: "keyboard_type",
    keyboard_type: "keyboard_type",
    hotkey: "hotkey",
    click: "mouse_click",
    mouse_click: "mouse_click",
  };
  const type = actionMap[action];
  if (!type) {
    throw validation("Неизвестное desktop-действие. Используй /device help.");
  }

  const commandArgs = {};
  if (["open_app", "close_app"].includes(type)) {
    commandArgs.app = text;
  } else if (type === "open_url") {
    commandArgs.url = text;
  } else if (type === "play_youtube") {
    commandArgs.query = text;
  } else if (type === "open_file") {
    commandArgs.path = text;
  } else if (["clipboard_set", "keyboard_type"].includes(type)) {
    commandArgs.text = text;
  } else if (type === "hotkey") {
    commandArgs.keys = text || rest;
  } else if (type === "mouse_click") {
    commandArgs.x = Number(rest[0]);
    commandArgs.y = Number(rest[1]);
    commandArgs.button = rest[2] || "left";
  }

  return { kind: "command", target, type, commandArgs };
}

function resolveDeviceCommandTarget(state, actor, target) {
  const normalized = normalizeSearchToken(target);
  const visibleAgents = listVisibleDeviceAgents(state, actor);
  const agent = visibleAgents.find((candidate) => {
    return [candidate.deviceId, candidate.displayName, candidate.hostname]
      .filter(Boolean)
      .some((alias) => normalizeSearchToken(alias) === normalized);
  });
  if (agent) {
    return { deviceId: agent.deviceId };
  }
  const user = resolveVisibleUserTarget(state, actor, target);
  return { userId: user.id };
}

function formatInviteHelp(state) {
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

function formatResetCodeHelp(state) {
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

function formatInviteCreated({ code: inviteCode, invite, targetUser }) {
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

function formatInviteReissued({ code: inviteCode, invite, targetUser, revokedCount }) {
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

function formatUser(user) {
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

function formatUsers(users) {
  if (!users.length) {
    return [title("Сотрудники"), "В твоем доступе пока нет сотрудников."].join("\n");
  }
  return [
    title("Сотрудники в твоем доступе"),
    ...users.map((user, index) => `${index + 1}. ${escapeHtml(user.displayName)} - ${formatRole(user.role)} - ${code(user.id)}`),
  ].join("\n");
}

function formatProjects(projects) {
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

function formatMetriconReport(report, label) {
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

function formatKickidlerReport(report, label) {
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

function formatPlatrumReport(report) {
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

function formatBitrixReport(report) {
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

function formatDeviceAgents(agents) {
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

function formatDeviceCommandHelp(state, actor) {
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

function formatDeviceCommandQueued(command, recent = []) {
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

function formatGoogleStatus(status) {
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

function formatAiStatus(status) {
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

function formatIntegrationsStatus(health) {
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

function formatTelegramError(error) {
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

function isAbortLikeError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "AbortError" ||
    /operation was aborted|aborted|timed? ?out/iu.test(error.message || "")
  );
}

function helpText() {
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

function unknownCommandText() {
  return [
    title("Неизвестная команда"),
    "Используй /help, там только актуальные команды Starlab Agent.",
    "",
    "Если команда видна в меню Telegram, но бот ее не знает, это старый кеш меню. Открой /help или перезапусти Telegram-клиент.",
  ].join("\n");
}

function createVoiceAwareTelegram({ telegram, voiceService, voiceReplyRequested }) {
  if (!voiceReplyRequested) {
    return telegram;
  }

  const wrapped = Object.create(telegram);
  wrapped.sendMessage = async (messageToSend) => {
    const sent = await telegram.sendMessage(messageToSend);
    if (!voiceService?.canSynthesize) {
      await telegram.sendMessage({
        chatId: messageToSend.chatId,
        text: "Голосовой ответ запрошен, но ElevenLabs API Key или Voice ID пока не настроены в /setup.",
      });
      return sent;
    }

    try {
      const speechText = prepareTextForSpeech(messageToSend.text);
      if (speechText) {
        const audio = await voiceService.synthesize(speechText);
        await telegram.sendVoice({
          chatId: messageToSend.chatId,
          audioBytes: audio.bytes,
          filename: audio.filename,
          mimeType: audio.mimeType,
          caption: "Голосовой ответ Starlab Agent",
        });
      }
    } catch (error) {
      await telegram.sendMessage({
        chatId: messageToSend.chatId,
        text: `Не удалось озвучить ответ: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return sent;
  };
  return wrapped;
}

function prepareTextForSpeech(value) {
  return String(value || "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[*_`#>|[\]]/gu, " ")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 3500);
}

function stripVoiceDirectiveFromCommand(command) {
  const voiceOnly = /^(голосом|голосовое|голосовым|аудио|voice|audio)$/iu;
  const args = command.args.filter((arg) => !voiceOnly.test(String(arg).replace(/[.,!?;:]+$/u, "")));
  return {
    ...command,
    args,
    raw: [command.raw.split(/\s+/u)[0], ...args].join(" "),
  };
}

async function sendAssistantAnswer({ telegram, chatId, answer, voiceService, voiceReplyRequested }) {
  void voiceService;
  void voiceReplyRequested;
  const { html } = formatAssistantAnswer(answer);
  await sendLongMessage({ telegram, chatId, text: html });
}

/**
 * Build the Telegram HTML and plain-text representations of an assistant
 * answer. `answer` may be either a structured object
 * ({ html, plainText, blocks? }) produced by answerCompanyAssistant, or a
 * legacy plain string (markdown/plain text), in which case it is converted
 * via markdownToTelegramHtml.
 */
function assertGoogleOAuthService(googleOAuthService) {
  if (!googleOAuthService) {
    throw new Error("Google OAuth service is not enabled.");
  }
}
