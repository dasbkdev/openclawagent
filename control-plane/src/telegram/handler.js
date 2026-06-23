import { ClaudeApiError } from "../assistant/claude-client.js";
import { answerCompanyAssistant, isWebResearchQuery } from "../assistant/company-assistant.js";
import { buildBitrixProjectStatusReport } from "../domain/bitrix-reports.js";
import { buildPlatrumProjectStatusReport } from "../domain/platrum-reports.js";
import {
  addDailyBlocker,
  buildDailyManagerReport,
  buildWeeklyManagerReport,
  formatWeeklyManagerReport,
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
  removeDailyPlanItem,
  clearDailyPlan,
} from "../domain/daily-assistant.js";
import {
  parseNaturalPlanIntent,
  parseNaturalDoneIntent,
  matchPlanItemByPhrase,
  isGenericDoneReference,
  isReplacePlanIntent,
  parseAddToPlanIntent,
  parseDeletePlanIntent,
  parseAssignPlanIntent,
  stripAssignConnectors,
} from "../domain/natural-plan-actions.js";
import {
  parseRelayIntent,
  splitRecipientAndBody,
  isReferenceBody,
  leadsWithConfirm,
  cleanDraftForRelay,
  canBroadcast,
  listBroadcastRecipients,
  setPendingBroadcast,
  takePendingBroadcast,
  peekPendingBroadcast,
  setPendingRelay,
  peekPendingRelay,
  takePendingRelay,
  setPendingAssign,
  peekPendingAssign,
  takePendingAssign,
  isAffirmative,
  isNegative,
} from "../domain/user-messaging.js";
import {
  extractIncomingMedia,
  forwardMethodFor,
  isAnalyzableByVision,
  isExtractableText,
  isTranscribable,
  TELEGRAM_DOWNLOAD_LIMIT_BYTES,
} from "../domain/media-actions.js";
import { extractDocxText } from "../domain/docx-text.js";
import { extractXlsxText } from "../domain/xlsx-text.js";
import {
  recordVoiceActivity,
  listVoiceActivity,
  buildVoiceTimelineXlsx,
  localDateKey as voiceLocalDateKey,
} from "../domain/voice-timeline.js";
import { extractVoiceActivity } from "../assistant/voice-extract.js";
import { classifyIntent, intentClassifierEnabled } from "../domain/intent-classifier.js";
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
import { readLastAssistantAnswer, readLastUserQuestion, recordAssistantMemoryEvent } from "../domain/assistant-memory.js";
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
import {
  formatAiStatus,
  formatBitrixReport,
  formatDeviceAgents,
  formatDeviceCommandHelp,
  formatDeviceCommandQueued,
  formatGoogleStatus,
  formatIntegrationsStatus,
  formatInviteCreated,
  formatInviteHelp,
  formatInviteReissued,
  formatKickidlerReport,
  formatMetriconReport,
  formatPlatrumReport,
  formatProjects,
  formatResetCodeHelp,
  formatTelegramError,
  formatUser,
  formatUsers,
  helpText,
  unknownCommandText,
} from "./format-reports.js";

export async function handleTelegramMessage({
  store,
  telegram,
  kickidlerClient,
  bitrixClient,
  platrumClient,
  claudeClient,
  googleOAuthService,
  voiceService,
  voyageClient = null,
  embeddingStore = null,
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

      // Voice activity timeline: log EVERY voice from a linked employee.
      const captured = await captureVoiceActivity({
        store, telegram, claudeClient, chatId, telegramUserId, transcript: transcript.text, now,
      });
      if (captured && !captured.isQuestion) {
        return; // pure activity log — already acked, no assistant noise
      }
      command = parseTelegramCommand(transcript.text);
    }

    if (voiceReplyRequested && command.raw.startsWith("/")) {
      command = stripVoiceDirectiveFromCommand(command);
    }

    // Raw client (no voice wrapping) for delivering to OTHER users' chats —
    // a relay/broadcast recipient must not get the sender's TTS.
    const directTelegram = telegram;

    telegram = createVoiceAwareTelegram({
      telegram,
      voiceService,
      voiceReplyRequested,
    });

    // Photo / document / video: forward to colleagues ("отправь это Бегайым" /
    // "отправь всем") or analyze (image+PDF via vision, video/audio via STT).
    const incomingMedia = extractIncomingMedia(message);
    if (incomingMedia) {
      await handleIncomingMedia({
        store,
        telegram,
        directTelegram,
        claudeClient,
        voiceService,
        chatId,
        telegramUserId,
        media: incomingMedia,
        caption: message?.caption ? String(message.caption) : "",
        now,
      });
      return;
    }

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

      case "week_report":
        await sendWeeklyReport({ store, telegram, chatId, telegramUserId, now });
        return;

      case "timeline":
      case "voice_report":
        await sendVoiceTimelineReport({ store, telegram, directTelegram, chatId, telegramUserId, args: command.args || [], now });
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
          periodName: command.args[0] || "all",
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
          // "да"/"нет" answering a pending broadcast confirmation.
          const handledBroadcastConfirm = await maybePendingBroadcastConfirm({
            store, telegram, directTelegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledBroadcastConfirm) {
            return;
          }

          // "да"/"нет" answering a pending relay-draft confirmation ("отправь это Имя").
          const handledRelayConfirm = await maybePendingRelayConfirm({
            store, telegram, directTelegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledRelayConfirm) {
            return;
          }

          // "да"/"нет" answering a pending plan-assignment ("поставь Имя задачу …").
          const handledAssignConfirm = await maybePendingAssignConfirm({
            store, telegram, directTelegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledAssignConfirm) {
            return;
          }

          // "поставь Имя задачу …" — assign a plan item to a subordinate (confirm).
          const handledAssign = await maybeAssignPlan({
            store, telegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledAssign) {
            return;
          }

          // "Сообщи Бегайым …" / "Отправь всем …" — relay a message to colleagues.
          const handledRelay = await maybeRelayMessage({
            store, telegram, directTelegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledRelay) {
            return;
          }

          // "удали пункт … из плана" / "очисти план дня" — remove from the plan.
          const handledPlanDelete = await maybeDeletePlan({
            store, telegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledPlanDelete) {
            return;
          }

          // "добавь в план дня: …" — append items to today's plan.
          const handledPlanAdd = await maybeAddToPlan({
            store, telegram, chatId, telegramUserId, text: command.raw, now,
          });
          if (handledPlanAdd) {
            return;
          }

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

          // Safety net (off by default, INTENT_CLASSIFIER_ENABLED): nothing matched
          // — let the classifier normalize the phrase into a canonical command and
          // re-run the deterministic handlers before falling back to the assistant.
          if (intentClassifierEnabled()) {
            const cls = await classifyIntent({
              claudeClient,
              text: command.raw,
              users: (await store.load()).users,
            });
            if (cls?.canonical) {
              const reText = cls.canonical;
              const reHandlers = [
                () => maybeRelayMessage({ store, telegram, directTelegram, chatId, telegramUserId, text: reText, now }),
                () => maybeDeletePlan({ store, telegram, chatId, telegramUserId, text: reText, now }),
                () => maybeAddToPlan({ store, telegram, chatId, telegramUserId, text: reText, now }),
                () => maybeCreateNaturalPlan({ store, telegram, chatId, telegramUserId, text: reText, now }),
                () => maybeMarkNaturalDone({ store, telegram, chatId, telegramUserId, text: reText, now }),
              ];
              for (const run of reHandlers) {
                if (await run()) {
                  return;
                }
              }
            }
          }

          // "подробнее" — expand the previous concise answer in full.
          if (isMoreDetailRequest(command.raw)) {
            const prevQ = readLastUserQuestion(await store.load(), (resolveActorByTelegramId(await store.load(), telegramUserId) || {}).id);
            if (prevQ) {
              const detailed = await answerCompanyAssistant({
                store, telegramUserId, question: prevQ, claudeClient, kickidlerClient,
                bitrixClient, platrumClient, googleOAuthService, voyageClient, embeddingStore,
                detailed: true, now,
              });
              await sendAssistantAnswer({ telegram, chatId, answer: detailed, voiceService, voiceReplyRequested });
              return;
            }
            await telegram.sendMessage({ chatId, text: "Подробнее о чём? Задайте вопрос — отвечу, а потом смогу раскрыть детальнее." });
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
            voyageClient,
            embeddingStore,
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
    return createOrUpdateDailyPlan(state, { actor, text, replace: isReplacePlanIntent(text), now });
  });

  await telegram.sendMessage({ chatId, text: formatDailyPlan(plan) });
}

async function maybeAddToPlan({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseAddToPlanIntent(text);
  if (!intent) {
    return false;
  }
  if (!intent.items.length) {
    await telegram.sendMessage({
      chatId,
      text: "Какие пункты добавить в план? Напишите их списком, например: «добавь в план: позвонить клиенту; проверить отчёт».",
    });
    return true;
  }
  const plan = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const updated = createOrUpdateDailyPlan(state, { actor, text: intent.items.join("\n"), now });
    recordAssistantMemoryEvent(state, {
      userId: actor.id, channel: "telegram", role: "user",
      kind: "daily_plan_add", text,
      target: { userId: actor.id, date: updated.date }, now,
    });
    return updated;
  });
  await telegram.sendMessage({ chatId, text: [title("Добавил в план"), formatDailyPlan(plan)].join("\n") });
  return true;
}

async function maybeDeletePlan({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseDeletePlanIntent(text);
  if (!intent) {
    return false;
  }

  if (intent.kind === "clear_plan") {
    const result = await store.update((state) => {
      const actor = resolveActorByTelegramId(state, telegramUserId);
      return clearDailyPlan(state, { actor, now });
    });
    await telegram.sendMessage({
      chatId,
      text: result.existed
        ? `План на сегодня удалён (было пунктов: ${result.removedCount}).`
        : "Плана на сегодня нет — удалять нечего.",
    });
    return true;
  }

  const outcome = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const plan = findTodayPlanForUser(state, actor.id, now);
    if (!plan || !plan.items?.length) {
      return { status: "no_plan" };
    }
    let match = matchPlanItemByPhrase(plan, intent.reference);
    if (!match && /^\d+$/u.test(intent.reference)) {
      match = { index: Number(intent.reference) };
    }
    if (!match) {
      return { status: "not_found", open: plan.items.map((item) => item.title) };
    }
    const removed = removeDailyPlanItem(state, { actor, selector: String(match.index), now });
    return { status: "ok", item: removed.item, remaining: removed.plan.items.length };
  });

  if (outcome.status === "no_plan") {
    await telegram.sendMessage({ chatId, text: "Плана на сегодня нет — удалять нечего." });
    return true;
  }
  if (outcome.status === "not_found") {
    await telegram.sendMessage({
      chatId,
      text: [
        title("Какой пункт удалить?"),
        "Не нашёл такой пункт. Сейчас в плане:",
        ...outcome.open.map((titleText, idx) => `${idx + 1}. ${escapeHtml(titleText)}`),
        "",
        "Напишите ключевое слово пункта или его номер.",
      ].join("\n"),
    });
    return true;
  }
  await telegram.sendMessage({
    chatId,
    text: `Удалил пункт: «${escapeHtml(outcome.item.title)}». Осталось пунктов: ${outcome.remaining}.`,
  });
  return true;
}

async function maybeCreateNaturalPlan({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseNaturalPlanIntent(text);
  if (!intent) {
    return false;
  }
  const plan = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const created = createOrUpdateDailyPlan(state, { actor, text: intent.items.join("\n"), replace: isReplacePlanIntent(text), now });
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
  // A question that merely contains a done-verb ("ты сделал отчёт?") is not a
  // self-completion — let the assistant answer it instead of prompting.
  if (/\?\s*$/u.test(String(text || "").trim())) {
    return false;
  }
  const result = await store.update((state) => {
    const actor = resolveActorByTelegramId(state, telegramUserId);
    const plan = findTodayPlanForUser(state, actor.id, now);
    if (!plan || !plan.items?.length) {
      return { prompt: "no_plan" };
    }
    const open = plan.items.filter((item) => item.status !== "done");
    if (open.length === 0) {
      return { prompt: "all_done" };
    }
    let match = matchPlanItemByPhrase(plan, intent.reference);
    if (!match) {
      // Generic confirmation ("готово", "задачу закрыл") with exactly one open
      // item left — complete that one. A phrase that names something specific
      // is NOT generic, so we never silently complete the wrong item.
      if (open.length === 1 && isGenericDoneReference(intent.reference)) {
        match = { index: plan.items.indexOf(open[0]) + 1, item: open[0], score: 0 };
      }
    }
    if (!match) {
      // Could not tell which item — ask, listing the open ones.
      return { prompt: "ambiguous", openItems: open.map((item) => item.title) };
    }
    const done = markDailyPlanItemDone(state, { actor, selector: String(match.index), now });
    recordAssistantMemoryEvent(state, {
      userId: actor.id, channel: "telegram", role: "user",
      kind: "daily_plan_natural_done", text,
      target: { userId: actor.id, date: done.plan.date, itemId: done.item.id }, now,
    });
    return { handled: true, result: done };
  });

  if (result.handled) {
    await telegram.sendMessage({ chatId, text: formatDoneResult(result.result) });
    return true;
  }
  if (result.prompt === "no_plan") {
    await telegram.sendMessage({
      chatId,
      text: [
        title("Плана на сегодня пока нет"),
        "Я отмечаю выполненными пункты плана дня, но плана ещё нет — поэтому отмечать нечего.",
        "",
        "Создайте план одним сообщением, например:",
        "План на сегодня:",
        "1. Собрание с командой",
        "2. Протестировать ИИ-агента",
        "",
        "Потом просто напишите, что сделали — «собрание провёл», «готово» — и я отмечу пункт.",
      ].join("\n"),
    });
    return true;
  }
  if (result.prompt === "all_done") {
    await telegram.sendMessage({
      chatId,
      text: "Все пункты плана на сегодня уже отмечены выполненными ✅",
    });
    return true;
  }
  if (result.prompt === "ambiguous") {
    const lines = result.openItems.map((titleText, idx) => `${idx + 1}. ${escapeHtml(titleText)}`);
    await telegram.sendMessage({
      chatId,
      text: [
        title("Какой пункт завершить?"),
        "Не понял, какой именно пункт отметить. Открытые пункты:",
        ...lines,
        "",
        "Напишите ключевое слово пункта (например «собрание провёл») или /done с номером.",
      ].join("\n"),
    });
    return true;
  }
  return false;
}

async function maybeRelayMessage({ store, telegram, directTelegram, chatId, telegramUserId, text, now }) {
  const intent = parseRelayIntent(text);
  if (!intent) {
    return false;
  }
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!actor) {
    return false; // unregistered sender — let the normal flow respond
  }
  const senderName = actor.displayName || actor.telegram?.firstName || "Коллега";

  if (intent.kind === "broadcast") {
    if (!canBroadcast(actor)) {
      await telegram.sendMessage({
        chatId,
        text: "Рассылку всем сотрудникам может делать только руководитель (OWNER или SENIOR_PM). Личное сообщение доступно всем: «сообщи Имя Текст».",
      });
      return true;
    }
    const body = String(intent.body || "").trim();
    if (!body) {
      await telegram.sendMessage({ chatId, text: "Что отправить всем сотрудникам? Напишите: «отправь всем Текст»." });
      return true;
    }
    const recipients = listBroadcastRecipients(state, telegramUserId);
    if (recipients.length === 0) {
      await telegram.sendMessage({ chatId, text: "Пока некому отправлять: ни у кого из сотрудников не привязан Telegram-бот." });
      return true;
    }
    await store.update((s) => {
      setPendingBroadcast(s, telegramUserId, body, now);
    });
    await telegram.sendMessage({
      chatId,
      text: [
        title("Подтвердите рассылку"),
        `Отправить ВСЕМ сотрудникам (${recipients.length} чел.):`,
        "",
        escapeHtml(body),
        "",
        "Ответьте «да» — отправлю, «нет» — отменю.",
      ].join("\n"),
    });
    return true;
  }

  const { res, body } = splitRecipientAndBody(state, intent.remainder);
  if (res.status === "not_found" || res.status === "empty") {
    if (intent.weak) {
      return false; // "отправь/перешли …" without a known recipient — not a relay
    }
    await telegram.sendMessage({
      chatId,
      text: "Не нашёл, кому отправить. Укажите имя сотрудника: «сообщи Имя Текст». Список — /users.",
    });
    return true;
  }
  if (res.status === "ambiguous") {
    const names = res.users.map((u) => escapeHtml(u.displayName || u.id)).join(", ");
    await telegram.sendMessage({ chatId, text: `Несколько сотрудников подходят: ${names}. Уточните имя.` });
    return true;
  }
  if (res.status === "not_linked") {
    await telegram.sendMessage({
      chatId,
      text: `${escapeHtml(res.user.displayName || "Этот сотрудник")} ещё не привязал(а) Telegram-бота, поэтому отправить нельзя.`,
    });
    return true;
  }
  const recipient = res.user;

  if (!body || isReferenceBody(body)) {
    // "отправь это / свои вопросы Имя" — use the assistant's last answer as the
    // draft so the owner doesn't have to copy-paste it (cleaned of next-steps/footer).
    const draft = cleanDraftForRelay(readLastAssistantAnswer(state, actor.id) || "");
    if (!draft) {
      const name = escapeHtml(recipient.displayName || "Имя");
      await telegram.sendMessage({
        chatId,
        text: `Какой именно текст отправить ${escapeHtml(recipient.displayName || "сотруднику")}? Напишите его прямо, например: «отправь ${name}: текст сообщения».`,
      });
      return true;
    }
    // Explicit confirmation in the message itself ("Подтверждаю отправь Имя",
    // "да отправь Имя") → deliver immediately; otherwise ask for one "да".
    if (leadsWithConfirm(text)) {
      return deliverRelay({ store, telegram, directTelegram, chatId, telegramUserId, recipient, body: draft, senderName, sourceText: text, now });
    }
    await store.update((s) =>
      setPendingRelay(s, telegramUserId, { recipientId: recipient.id, recipientName: recipient.displayName, body: draft }, now),
    );
    await telegram.sendMessage({
      chatId,
      text: [
        title(`Отправить ${escapeHtml(recipient.displayName || "сотруднику")}?`),
        "",
        escapeHtml(draft.length > 1500 ? `${draft.slice(0, 1500)}…` : draft),
        "",
        "Ответь «да» — отправлю, «нет» — отменю. Или пришли свой текст: «отправь Имя: текст».",
      ].join("\n"),
    });
    return true;
  }

  return deliverRelay({ store, telegram, directTelegram, chatId, telegramUserId, recipient, body, senderName, sourceText: text, now });
}

async function deliverRelay({ store, telegram, directTelegram, chatId, telegramUserId, recipient, body, senderName, sourceText, now }) {
  try {
    await directTelegram.sendMessage({
      chatId: recipient.telegram.telegramUserId,
      text: [`📨 Сообщение от ${escapeHtml(senderName)}:`, "", escapeHtml(body)].join("\n"),
    });
  } catch {
    await telegram.sendMessage({
      chatId,
      text: `Не удалось доставить сообщение ${escapeHtml(recipient.displayName || "сотруднику")} — возможно, бот остановлен у получателя.`,
    });
    return true;
  }

  await store.update((s) => {
    const sender = resolveActorByTelegramId(s, telegramUserId);
    recordAssistantMemoryEvent(s, {
      userId: sender?.id,
      channel: "telegram",
      role: "user",
      kind: "user_message_relay",
      text: sourceText,
      target: { userId: recipient.id },
      metadata: { recipientId: recipient.id },
      now,
    });
  });

  const preview = body.length > 400 ? `${body.slice(0, 400)}…` : body;
  await telegram.sendMessage({ chatId, text: `Отправил ${escapeHtml(recipient.displayName || "сотруднику")}: «${escapeHtml(preview)}»` });
  return true;
}

async function maybeAssignPlan({ store, telegram, chatId, telegramUserId, text, now }) {
  const intent = parseAssignPlanIntent(text);
  if (!intent) {
    return false;
  }
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!actor) {
    return false;
  }
  // Only managers may assign work to others.
  if (actor.role !== "OWNER" && actor.role !== "SENIOR_PM") {
    return false; // let the normal flow handle (e.g. a PM editing own plan)
  }
  const { res, body } = splitRecipientAndBody(state, intent.remainder);
  if (res.status !== "ok") {
    return false; // unknown/unlinked recipient — fall through to assistant
  }
  if (res.user.id === actor.id) {
    return false; // assigning to self → let the normal add-to-plan flow handle
  }
  const items = String(stripAssignConnectors(body) || "")
    .split(/\r?\n|[;•]|,(?!\d)/u)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    await telegram.sendMessage({ chatId, text: `Что поставить ${escapeHtml(res.user.displayName || "сотруднику")} в план? Напишите: «поставь ${escapeHtml(res.user.displayName || "Имя")} задачу: текст».` });
    return true;
  }
  await store.update((s) => setPendingAssign(s, telegramUserId, { recipientId: res.user.id, recipientName: res.user.displayName, items }, now));
  await telegram.sendMessage({
    chatId,
    text: [
      title(`Поставить ${escapeHtml(res.user.displayName || "сотруднику")} в план дня?`),
      "",
      ...items.map((i) => `• ${escapeHtml(i)}`),
      "",
      "Ответь «да» — добавлю ей/ему в план и уведомлю, «нет» — отменю.",
    ].join("\n"),
  });
  return true;
}

async function maybePendingAssignConfirm({ store, telegram, directTelegram, chatId, telegramUserId, text, now }) {
  const peeked = await store.load();
  if (!peekPendingAssign(peeked, telegramUserId)) {
    return false;
  }
  if (isNegative(text)) {
    await store.update((s) => takePendingAssign(s, telegramUserId, now));
    await telegram.sendMessage({ chatId, text: "Отменил." });
    return true;
  }
  if (!isAffirmative(text)) {
    return false;
  }
  const pending = await store.update((s) => takePendingAssign(s, telegramUserId, now));
  if (!pending) {
    await telegram.sendMessage({ chatId, text: "Черновик истёк — повторите команду." });
    return true;
  }
  let recipient = null;
  let senderName = "Руководитель";
  try {
    await store.update((s) => {
      const actor = resolveActorByTelegramId(s, telegramUserId);
      senderName = actor?.displayName || senderName;
      recipient = (s.users || []).find((u) => u.id === pending.recipientId) || null;
      createOrUpdateDailyPlan(s, { actor, userId: pending.recipientId, text: pending.items.join("\n"), now });
    });
  } catch (error) {
    await telegram.sendMessage({ chatId, text: escapeHtml(`Не удалось поставить задачу: ${error instanceof Error ? error.message : String(error)}`) });
    return true;
  }
  // Notify the recipient.
  if (recipient?.telegram?.telegramUserId) {
    await directTelegram.sendMessage({
      chatId: recipient.telegram.telegramUserId,
      text: [`📋 ${escapeHtml(senderName)} добавил(а) тебе в план дня:`, "", ...pending.items.map((i) => `• ${escapeHtml(i)}`)].join("\n"),
    }).catch(() => {});
  }
  await telegram.sendMessage({ chatId, text: `Готово: поставил ${escapeHtml(recipient?.displayName || "сотруднику")} ${pending.items.length} пункт(а/ов) в план и уведомил.` });
  return true;
}

async function maybePendingRelayConfirm({ store, telegram, directTelegram, chatId, telegramUserId, text, now }) {
  const peeked = await store.load();
  if (!peekPendingRelay(peeked, telegramUserId)) {
    return false;
  }
  if (isNegative(text)) {
    await store.update((s) => takePendingRelay(s, telegramUserId, now));
    await telegram.sendMessage({ chatId, text: "Отменил отправку." });
    return true;
  }
  if (!isAffirmative(text)) {
    return false; // not a yes/no — let the normal flow handle; pending expires by TTL
  }
  const pending = await store.update((s) => takePendingRelay(s, telegramUserId, now));
  if (!pending) {
    await telegram.sendMessage({ chatId, text: "Черновик отправки истёк — повторите команду." });
    return true;
  }
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  const recipient = (state.users || []).find((u) => u.id === pending.recipientId);
  if (!recipient?.telegram?.telegramUserId) {
    await telegram.sendMessage({ chatId, text: "Получатель сейчас недоступен — повторите команду." });
    return true;
  }
  const senderName = actor?.displayName || actor?.telegram?.firstName || "Коллега";
  return deliverRelay({ store, telegram, directTelegram, chatId, telegramUserId, recipient, body: pending.body, senderName, sourceText: text, now });
}

async function maybePendingBroadcastConfirm({ store, telegram, directTelegram, chatId, telegramUserId, text, now }) {
  const peeked = await store.load();
  if (!peekPendingBroadcast(peeked, telegramUserId)) {
    return false;
  }
  if (isNegative(text)) {
    await store.update((s) => takePendingBroadcast(s, telegramUserId, now));
    await telegram.sendMessage({ chatId, text: "Рассылка отменена." });
    return true;
  }
  if (!isAffirmative(text)) {
    return false; // not a yes/no — let normal flow handle; pending expires by TTL
  }

  const pending = await store.update((s) => takePendingBroadcast(s, telegramUserId, now));
  if (!pending) {
    await telegram.sendMessage({ chatId, text: "Запрос на рассылку истёк — повторите команду." });
    return true;
  }
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!canBroadcast(actor)) {
    await telegram.sendMessage({ chatId, text: "Рассылку всем может делать только руководитель." });
    return true;
  }
  const senderName = actor?.displayName || actor?.telegram?.firstName || "Руководитель";
  const recipients = listBroadcastRecipients(state, telegramUserId);
  let delivered = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      if (pending.media) {
        await sendMediaByKind({
          telegram: directTelegram,
          chatId: recipient.telegram.telegramUserId,
          media: pending.media,
          caption: [`📢 Всем сотрудникам от ${escapeHtml(senderName)}`, escapeHtml(pending.body)].filter(Boolean).join("\n"),
        });
      } else {
        await directTelegram.sendMessage({
          chatId: recipient.telegram.telegramUserId,
          text: [`📢 Сообщение всем сотрудникам от ${escapeHtml(senderName)}:`, "", escapeHtml(pending.body)].join("\n"),
        });
      }
      delivered += 1;
    } catch {
      failed += 1;
    }
  }
  await store.update((s) => {
    const sender = resolveActorByTelegramId(s, telegramUserId);
    recordAssistantMemoryEvent(s, {
      userId: sender?.id,
      channel: "telegram",
      role: "user",
      kind: "user_message_broadcast",
      text: pending.body,
      metadata: { delivered, failed },
      now,
    });
  });
  await telegram.sendMessage({
    chatId,
    text: `Разослал ${delivered} сотрудникам${failed ? `, не доставлено ${failed}` : ""}.`,
  });
  return true;
}

// Log EVERY voice from a linked employee into the activity timeline. Returns
// { isQuestion } so the caller can still route genuine questions to the
// assistant, or null when the sender is not a linked employee.
async function captureVoiceActivity({ store, telegram, claudeClient, chatId, telegramUserId, transcript, now }) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!actor) {
    return null; // unregistered — handled by the normal flow
  }
  const day = voiceLocalDateKey(now);
  const dayEntries = listVoiceActivity(state, { userIds: [actor.id] }).filter((e) => e.date === day);
  let extracted;
  try {
    extracted = await extractVoiceActivity({ claudeClient, transcript, dayEntries, now });
  } catch {
    extracted = { kind: "заметка", statedTime: null, activity: transcript.slice(0, 200), relatedPerson: null, cleanedText: transcript, isQuestion: false };
  }

  let saved;
  await store.update((s) => {
    saved = recordVoiceActivity(s, {
      userId: actor.id,
      arrivalAt: now,
      extracted,
      transcript: extracted.cleanedText || transcript,
      rawTranscript: transcript,
    });
    recordAssistantMemoryEvent(s, {
      userId: actor.id,
      channel: "telegram",
      role: "user",
      kind: "voice_activity",
      text: extracted.cleanedText || transcript,
      target: { userId: actor.id, date: saved.date },
      metadata: { statedTime: saved.statedTime, voiceKind: saved.kind, activity: saved.activity },
      now,
    });
  });

  const isQuestion = Boolean(extracted.isQuestion);
  // A question/request goes to the assistant (answered there) — no redundant ack.
  // A pure activity gets a short confirmation. Either way it is logged.
  if (!isQuestion) {
    await telegram.sendMessage({ chatId, text: formatVoiceAck(saved) }).catch(() => {});
  }
  return { isQuestion, entry: saved };
}

function formatVoiceAck(entry) {
  const parts = [`📝 Записал (${entry.kind})`];
  const when = entry.statedTime ? `🕒 ${entry.statedTime}` : null;
  if (when) {
    parts.push(when);
  }
  if (entry.activity) {
    parts.push(escapeHtml(entry.activity));
  }
  if (entry.kind === "конец" && typeof entry.durationMinutes === "number") {
    parts.push(`⏱ ${entry.durationMinutes} мин`);
  }
  return parts.join(" · ");
}

async function sendVoiceTimelineReport({ store, telegram, directTelegram, chatId, telegramUserId, args, now }) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  const devIds = new Set(String(process.env.DEVELOPER_TELEGRAM_IDS || "984834133").split(/[,\s]+/u).filter(Boolean));
  const allowed = actor && (actor.role === "OWNER" || actor.role === "SENIOR_PM") || devIds.has(String(telegramUserId));
  if (!allowed) {
    await telegram.sendMessage({ chatId, text: "Отчёт по голосовым доступен Николаю, Максату и разработчику." });
    return;
  }

  // Parse optional period + optional employee name from args.
  const { from, to, label } = resolveVoicePeriod(args, now);
  let userIds = null;
  let scopeLabel = "все сотрудники";
  const nameArg = args.filter((a) => !/^(сегодня|вчера|неделя|week|today|yesterday|\d{4}-\d{2}-\d{2})$/iu.test(a)).join(" ").trim();
  if (nameArg) {
    const match = (state.users || []).find((u) =>
      [u.displayName, u.telegram?.firstName, u.id, u.platrumUsername].filter(Boolean).some((n) => String(n).toLowerCase().includes(nameArg.toLowerCase())),
    );
    if (!match) {
      await telegram.sendMessage({ chatId, text: `Не нашёл сотрудника «${escapeHtml(nameArg)}». Список — /users.` });
      return;
    }
    userIds = [match.id];
    scopeLabel = match.displayName;
  }

  const entries = listVoiceActivity(state, { userIds, from, to });
  if (entries.length === 0) {
    await telegram.sendMessage({ chatId, text: `Голосовых записей за период (${label}, ${scopeLabel}) пока нет.` });
    return;
  }
  const buffer = buildVoiceTimelineXlsx(state, { userIds, from, to });
  const filename = `voice-timeline-${label}${userIds ? `-${scopeLabel}` : ""}.xlsx`.replace(/\s+/gu, "_");
  await directTelegram.sendDocument({
    chatId,
    document: { buffer, filename, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    caption: `Голосовой табель · ${label} · ${scopeLabel} · записей: ${entries.length}`,
  });
}

function resolveVoicePeriod(args, now) {
  const tz = "Asia/Bishkek";
  const day = voiceLocalDateKey(now);
  const lower = args.map((a) => a.toLowerCase());
  const isoArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/u.test(a));
  if (lower.includes("неделя") || lower.includes("week")) {
    return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to: now.toISOString(), label: "за неделю" };
  }
  if (lower.includes("вчера") || lower.includes("yesterday")) {
    const y = voiceLocalDateKey(new Date(now.getTime() - 86400000));
    return { from: `${y}T00:00:00+06:00`, to: `${y}T23:59:59+06:00`, label: y };
  }
  if (isoArg) {
    return { from: `${isoArg}T00:00:00+06:00`, to: `${isoArg}T23:59:59+06:00`, label: isoArg };
  }
  return { from: `${day}T00:00:00+06:00`, to: `${day}T23:59:59+06:00`, label: day };
}

// "подробнее" / "подробно" / "детальнее" / "раскрой" / "полный ответ" → expand.
function isMoreDetailRequest(text) {
  return /^\s*(подробн(?:ее|о|остей)?|детальн(?:ее|о)?|раскрой|развернуто|полный\s+ответ|поподробнее|деталей)\s*[.!?]*\s*$/iu.test(String(text || ""));
}

function mediaLabel(media) {
  switch (media?.kind) {
    case "image": return "изображение";
    case "pdf": return "PDF";
    case "docx": return "документ Word";
    case "xlsx": return "таблицу Excel";
    case "text": return "текстовый файл";
    case "video": return "видео";
    case "audio": return "аудио";
    default: return "файл";
  }
}

async function sendMediaByKind({ telegram, chatId, media, caption }) {
  const method = forwardMethodFor(media); // sendPhoto | sendVideo | sendDocument
  const key = method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video" : "document";
  return telegram[method]({ chatId, [key]: media.fileId, caption });
}

async function handleIncomingMedia({ store, telegram, directTelegram, claudeClient, voiceService, chatId, telegramUserId, media, caption, now }) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!actor) {
    await telegram.sendMessage({ chatId, text: "Сначала зарегистрируйтесь: /register КОД." });
    return;
  }
  const senderName = actor.displayName || actor.telegram?.firstName || "Коллега";
  const intent = caption ? parseRelayIntent(caption) : null;

  // 1) Forward the file to a colleague or everyone.
  if (intent && intent.kind === "broadcast") {
    if (!canBroadcast(actor)) {
      await telegram.sendMessage({ chatId, text: "Рассылку всем может делать только руководитель (OWNER/SENIOR_PM)." });
      return;
    }
    const recipients = listBroadcastRecipients(state, telegramUserId);
    if (recipients.length === 0) {
      await telegram.sendMessage({ chatId, text: "Некому отправлять: ни у кого не привязан Telegram-бот." });
      return;
    }
    await store.update((s) => {
      setPendingBroadcast(s, telegramUserId, String(intent.body || ""), now, {
        fileId: media.fileId, kind: media.kind, telegramType: media.telegramType,
      });
    });
    await telegram.sendMessage({
      chatId,
      text: [
        title("Подтвердите рассылку файла"),
        `Отправить этот ${mediaLabel(media)} ВСЕМ сотрудникам (${recipients.length} чел.)?`,
        intent.body ? `Подпись: ${escapeHtml(intent.body)}` : "",
        "",
        "Ответьте «да» — отправлю, «нет» — отменю.",
      ].filter(Boolean).join("\n"),
    });
    return;
  }

  if (intent && intent.kind === "relay") {
    const { res, body } = splitRecipientAndBody(state, intent.remainder);
    if (res.status === "ok") {
      try {
        await sendMediaByKind({
          telegram: directTelegram,
          chatId: res.user.telegram.telegramUserId,
          media,
          caption: body ? `${escapeHtml(body)}\n\n— от ${escapeHtml(senderName)}` : `📎 Файл от ${escapeHtml(senderName)}`,
        });
      } catch {
        await telegram.sendMessage({ chatId, text: `Не удалось отправить файл ${escapeHtml(res.user.displayName || "сотруднику")}.` });
        return;
      }
      await telegram.sendMessage({ chatId, text: `Отправил ${escapeHtml(res.user.displayName || "сотруднику")} ${mediaLabel(media)}.` });
      return;
    }
    if (res.status === "not_linked") {
      await telegram.sendMessage({ chatId, text: `${escapeHtml(res.user.displayName || "Сотрудник")} ещё не привязал(а) Telegram-бота.` });
      return;
    }
    if (res.status === "ambiguous") {
      await telegram.sendMessage({ chatId, text: `Несколько сотрудников подходят: ${res.users.map((u) => escapeHtml(u.displayName || u.id)).join(", ")}. Уточните имя.` });
      return;
    }
    // not_found — fall through to analysis below.
  }

  // 2) No forward target → analyze the media.
  await analyzeIncomingMedia({ telegram, directTelegram, claudeClient, voiceService, chatId, media, caption });
}

async function analyzeIncomingMedia({ telegram, directTelegram, claudeClient, voiceService, chatId, media, caption }) {
  if (media.fileSize && media.fileSize > TELEGRAM_DOWNLOAD_LIMIT_BYTES) {
    await telegram.sendMessage({
      chatId,
      text: `Файл слишком большой для обработки (> 20 МБ). Могу только переслать: «отправь это Имя» или «отправь всем».`,
    });
    return;
  }

  if (isAnalyzableByVision(media)) {
    if (!claudeClient?.analyzeMedia) {
      await telegram.sendMessage({ chatId, text: "Анализ изображений/документов пока недоступен." });
      return;
    }
    await telegram.sendMessage({ chatId, text: `🔍 Смотрю ${mediaLabel(media)}…` }).catch(() => {});
    try {
      const file = await directTelegram.getFile({ fileId: media.fileId });
      const bytes = await directTelegram.downloadFile({ filePath: file.file_path });
      const base64 = Buffer.from(bytes).toString("base64");
      const isDoc = media.kind === "pdf";
      const prompt = caption?.trim() || (isDoc
        ? "Кратко изложи содержание документа: о чём он, ключевые пункты, числа, выводы. По-русски."
        : "Опиши, что на изображении, и извлеки важную информацию (текст, числа, суть). По-русски.");
      const result = await claudeClient.analyzeMedia({
        system: "Ты ассистент Starlab. Отвечай кратко и по делу, на русском, без Markdown-разметки.",
        prompt,
        media: [{ kind: isDoc ? "document" : "image", mimeType: media.mimeType, base64 }],
        maxTokens: 1200,
      });
      await telegram.sendMessage({ chatId, text: [title(isDoc ? "Документ" : "Изображение"), escapeHtml(result.text)].join("\n") });
    } catch (error) {
      await telegram.sendMessage({ chatId, text: escapeHtml(`Не удалось обработать ${mediaLabel(media)}: ${error instanceof Error ? error.message : String(error)}`) });
    }
    return;
  }

  if (isTranscribable(media)) {
    if (!voiceService?.canTranscribe) {
      await telegram.sendMessage({ chatId, text: "Распознавание аудио/видео не настроено (STT в /setup). Могу переслать файл: «отправь это Имя»." });
      return;
    }
    await telegram.sendMessage({ chatId, text: `🎬 Распознаю речь из ${mediaLabel(media)}…` }).catch(() => {});
    try {
      const file = await directTelegram.getFile({ fileId: media.fileId });
      const bytes = await directTelegram.downloadFile({ filePath: file.file_path });
      const transcript = await voiceService.transcribeMedia({ bytes, filename: media.fileName, mimeType: media.mimeType });
      const text = String(transcript?.text || "").trim();
      if (!text) {
        await telegram.sendMessage({ chatId, text: "В этом файле не нашлось распознаваемой речи." });
        return;
      }
      let summary = "";
      if (claudeClient?.complete && text.length > 400) {
        try {
          const r = await claudeClient.complete({
            system: "Кратко суммируй на русском, без разметки.",
            user: `Сделай краткое содержание расшифровки:\n\n${text.slice(0, 6000)}`,
            maxTokens: 500,
          });
          summary = r.text;
        } catch {
          // summary is optional
        }
      }
      const out = [title("Расшифровка"), escapeHtml(text.slice(0, 3000))];
      if (summary) {
        out.push("", "Коротко:", escapeHtml(summary));
      }
      await telegram.sendMessage({ chatId, text: out.join("\n") });
    } catch (error) {
      await telegram.sendMessage({ chatId, text: escapeHtml(`Не удалось распознать ${mediaLabel(media)}: ${error instanceof Error ? error.message : String(error)}`) });
    }
    return;
  }

  if (isExtractableText(media)) {
    if (!claudeClient?.complete) {
      await telegram.sendMessage({ chatId, text: "Анализ документов пока недоступен (Claude не настроен)." });
      return;
    }
    await telegram.sendMessage({ chatId, text: `📄 Читаю ${mediaLabel(media)}…` }).catch(() => {});
    try {
      const file = await directTelegram.getFile({ fileId: media.fileId });
      const bytes = await directTelegram.downloadFile({ filePath: file.file_path });
      let text = media.kind === "docx"
        ? extractDocxText(Buffer.from(bytes))
        : media.kind === "xlsx"
          ? extractXlsxText(Buffer.from(bytes))
          : Buffer.from(bytes).toString("utf8");
      text = String(text || "").trim();
      if (!text) {
        await telegram.sendMessage({ chatId, text: `Не удалось извлечь текст из ${mediaLabel(media)}. Могу переслать файл: «отправь это Имя».` });
        return;
      }
      const limited = text.slice(0, 40000);
      const r = await claudeClient.complete({
        system: "Ты ассистент Starlab. Анализируй документ (включая таблицы — строки/колонки разделены табуляцией) и отвечай кратко и по делу, на русском, без Markdown-разметки.",
        user: `${caption?.trim() || "Сделай краткий анализ документа: о чём он, ключевые пункты, требования, числа, таблицы, выводы."}\n\nТекст документа:\n${limited}`,
        maxTokens: 1600,
      });
      const out = [title(`Документ${media.fileName ? `: ${escapeHtml(media.fileName)}` : ""}`), escapeHtml(r.text)];
      if (text.length > limited.length) {
        out.push("", escapeHtml("(документ очень длинный — анализ по первым ~40 000 символам)"));
      }
      await telegram.sendMessage({ chatId, text: out.join("\n") });
    } catch (error) {
      await telegram.sendMessage({ chatId, text: escapeHtml(`Не удалось обработать ${mediaLabel(media)}: ${error instanceof Error ? error.message : String(error)}`) });
    }
    return;
  }

  await telegram.sendMessage({
    chatId,
    text: [
      `Получил ${mediaLabel(media)}${media.fileName ? ` (${escapeHtml(media.fileName)})` : ""}.`,
      "Я анализирую изображения, PDF, документы Word (.docx), таблицы Excel (.xlsx), текстовые файлы, видео и аудио. Файл такого типа могу только переслать сотрудникам: «отправь это Имя» или «отправь всем».",
    ].join("\n"),
  });
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

async function sendWeeklyReport({ store, telegram, chatId, telegramUserId, now }) {
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  if (!actor || (actor.role !== "OWNER" && actor.role !== "SENIOR_PM")) {
    await telegram.sendMessage({ chatId, text: "Недельный отчёт доступен руководителю (OWNER/SENIOR_PM)." });
    return;
  }
  const report = buildWeeklyManagerReport(state, { actor, now });
  await sendLongMessage({ telegram, chatId, text: formatWeeklyManagerReport(report) });
}

async function sendTokenUsageReport({ store, telegram, chatId, telegramUserId, periodName, now }) {
  const recipientTelegramId = process.env.TOKEN_USAGE_REPORT_TELEGRAM_ID || "984834133";
  const state = await store.load();
  const actor = resolveActorByTelegramId(state, telegramUserId);
  const isOwner = actor?.role === "OWNER";
  if (!isOwner && String(telegramUserId) !== String(recipientTelegramId)) {
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
