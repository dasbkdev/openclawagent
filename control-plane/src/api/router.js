import { appendAuditEvent } from "../infra/audit.js";
import fs from "node:fs";
import path from "node:path";
import { answerCompanyAssistant } from "../assistant/company-assistant.js";
import { buildBitrixProjectStatusReport, buildBitrixUserStatusReport } from "../domain/bitrix-reports.js";
import { buildPlatrumProjectStatusReport, buildPlatrumUserStatusReport } from "../domain/platrum-reports.js";
import {
  formatRemainingDoneResult,
  markRemainingDailyPlanItemsDone,
} from "../domain/daily-assistant.js";
import {
  activateDeviceAgent,
  claimDeviceCommands,
  completeDeviceCommand,
  createDeviceCommand,
  DEVICE_ACTION_TYPES,
  isValidDeviceAgentToken,
  listVisibleDeviceCommands,
  listVisibleDeviceAgents,
  upsertDeviceAgentHeartbeat,
} from "../domain/device-agents.js";
import { createInviteCode, redeemInviteCode, reissueInviteCode } from "../domain/invite-codes.js";
import {
  formatNaturalDeviceCommandQueued,
  tryCreateNaturalDeviceCommand,
} from "../domain/natural-device-actions.js";
import { recordAssistantMemoryEvent } from "../domain/assistant-memory.js";
import {
  findOpenLoopBySource,
  openAssistantLoop,
  resolveAssistantLoop,
} from "../domain/assistant-open-loops.js";
import { buildKickidlerActivitySummary } from "../domain/reports.js";
import { runAgentTask, makeDeviceCommandRunner, resolveAgentTaskDevice } from "../assistant/agent-loop.js";
import { appendTimelineEvent } from "../domain/work-timeline.js";
import { createBrowserClientFromEnv } from "../integrations/browser-client.js";
import {
  buildTokenUsageSummary,
  recordTokenUsageEvents,
  resolveTokenUsagePeriod,
} from "../domain/token-usage.js";
import {
  assertCanIssueInvite,
  assertCanAccessUser,
  getUserById,
  listAccessibleUserIds,
  publicProject,
  publicUser,
} from "../domain/policy.js";
import { forbidden, notFound, unauthorized, validation } from "../domain/errors.js";
import { buildIntegrationsHealth } from "../domain/integration-health.js";
import { renderSetupPage } from "../setup/setup-page.js";
import { renderDownloadPage, renderPrivacyPage, renderTermsPage } from "../setup/download-page.js";
import { sendDueDailyAssistantMessages } from "../telegram/daily-assistant-reporter.js";
import { actorTelegramIdFromHeaders, readJsonBody, sendError, sendHtml, sendJson } from "./http-utils.js";

export function createRouter({
  store,
  kickidlerClient,
  bitrixClient,
  getKickidlerClient,
  getBitrixClient,
  getPlatrumClient,
  getTelegramApi,
  getVoiceService,
  getClaudeClient,
  getVoyageClient,
  embeddingStore = null,
  googleOAuthService,
  setupService,
}) {
  const resolveKickidlerClient = async () =>
    getKickidlerClient ? await getKickidlerClient() : kickidlerClient;
  const resolveBitrixClient = () => (getBitrixClient ? getBitrixClient() : bitrixClient);
  const resolvePlatrumClient = () => getPlatrumClient?.();
  const resolveTelegramApi = () => getTelegramApi?.();
  const resolveVoiceService = () => getVoiceService?.();
  const resolveClaudeClient = () => getClaudeClient?.();
  const resolveVoyageClient = () => getVoyageClient?.() ?? null;

  return async function route(request, response) {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      assertInternalApiToken(request, url);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "company-control-plane" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/setup") {
        sendHtml(response, 200, renderSetupPage());
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/download") {
        sendHtml(response, 200, renderDownloadPage({ baseUrl: readPublicBaseUrl(request) }));
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/privacy") {
        sendHtml(response, 200, renderPrivacyPage({ baseUrl: readPublicBaseUrl(request) }));
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/terms") {
        sendHtml(response, 200, renderTermsPage({ baseUrl: readPublicBaseUrl(request) }));
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/downloads/")) {
        await sendDownloadFile(response, url.pathname, { headOnly: request.method === "HEAD" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/setup/status") {
        const data = setupService ? await setupService.status() : { configured: false };
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/setup/model-policy") {
        const data = setupService
          ? (await setupService.status()).modelPolicy
          : { enforced: false };
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/automation/daily-assistant/run") {
        assertAutomationToken(request);
        const telegram = resolveTelegramApi();
        if (!telegram) {
          throw validation("Telegram API is not configured");
        }
        const data = await sendDueDailyAssistantMessages({
          store,
          telegram,
          kickidlerClient: await resolveKickidlerClient(),
          bitrixClient: resolveBitrixClient(),
          platrumClient: resolvePlatrumClient(),
          googleOAuthService,
        });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/setup/services") {
        if (!setupService) {
          throw notFound("Setup service is not enabled");
        }
        const body = await readJsonBody(request);
        const data = await setupService.saveSetup(body);
        if (body.bootstrapOwnerTelegramId) {
          await syncOwnerTelegramId(store, body.bootstrapOwnerTelegramId);
        }
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/google/oauth/start") {
        assertGoogleOAuthEnabled(googleOAuthService);
        const state = await store.load();
        const actor = requireActor(state, request);
        const data = await googleOAuthService.buildAuthorizationUrl({
          userId: actor.id,
          redirectBaseUrl: readPublicBaseUrl(request),
        });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/google/oauth/callback") {
        assertGoogleOAuthEnabled(googleOAuthService);
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          sendHtml(response, 400, renderGoogleOAuthResultPage({
            ok: false,
            message: `Google authorization failed: ${escapeHtml(oauthError)}`,
          }));
          return;
        }
        try {
          const status = await googleOAuthService.handleCallback({
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
            redirectBaseUrl: readPublicBaseUrl(request),
          });
          await store.update((state) => {
            appendAuditEvent(state, {
              actorUserId: status.userId,
              actorTelegramUserId: null,
              action: "google.oauth.connect",
              target: {
                userId: status.userId,
                googleAccountEmail: status.googleAccountEmail,
              },
              metadata: {
                scopes: status.scopes,
              },
            });
          });
          sendHtml(response, 200, renderGoogleOAuthResultPage({
            ok: true,
            message: "Google account connected successfully. You can close this tab and return to Telegram.",
            status,
          }));
          return;
        } catch (error) {
          sendHtml(response, 400, renderGoogleOAuthResultPage({
            ok: false,
            message: error instanceof Error ? error.message : "Google OAuth callback failed",
          }));
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/api/v1/google/status") {
        assertGoogleOAuthEnabled(googleOAuthService);
        const state = await store.load();
        const actor = requireActor(state, request);
        const data = await googleOAuthService.status({ userId: actor.id });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/google/workspace-snapshot") {
        assertGoogleOAuthEnabled(googleOAuthService);
        const state = await store.load();
        const actor = requireActor(state, request);
        const targetUserId = url.searchParams.get("userId") || actor.id;
        assertCanAccessUser(state, actor, targetUserId);
        const data = await googleOAuthService.readWorkspaceSnapshot({
          userId: targetUserId,
          period: readGoogleWorkspacePeriod(url),
          limits: readGoogleWorkspaceLimits(url),
        });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/google/oauth/disconnect") {
        assertGoogleOAuthEnabled(googleOAuthService);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          const data = await googleOAuthService.disconnect({ userId: actor.id });
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "google.oauth.disconnect",
            target: { userId: actor.id },
          });
          return data;
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/voice/status") {
        const state = await store.load();
        requireActor(state, request);
        const voiceService = resolveVoiceService();
        sendJson(response, 200, {
          ok: true,
          data: {
            enabled: Boolean(voiceService?.enabled),
            canTranscribe: Boolean(voiceService?.canTranscribe),
            canSynthesize: Boolean(voiceService?.canSynthesize),
            replyMode: voiceService?.replyMode || null,
          },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/voice/transcribe-telegram") {
        const state = await store.load();
        requireActor(state, request);
        const body = await readJsonBody(request);
        const telegram = resolveTelegramApi();
        const voiceService = resolveVoiceService();
        if (!telegram || !voiceService) {
          throw validation("Voice service is not enabled on this server");
        }
        const transcript = await voiceService.transcribeTelegramVoice({
          telegram,
          voice: {
            file_id: requireString(body.fileId, "fileId"),
            mime_type: body.mimeType || "audio/ogg",
          },
        });
        sendJson(response, 200, {
          ok: true,
          data: {
            ...transcript,
            wantsVoiceReply: voiceService.wantsVoiceReply(transcript.text),
          },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/voice/send-telegram") {
        const state = await store.load();
        requireActor(state, request);
        const body = await readJsonBody(request);
        const telegram = resolveTelegramApi();
        const voiceService = resolveVoiceService();
        if (!telegram || !voiceService) {
          throw validation("Voice service is not enabled on this server");
        }
        if (!voiceService.canSynthesize) {
          await telegram.sendMessage({
            chatId: requireString(body.chatId, "chatId"),
            text: [
              "Голосовой ответ пока не настроен.",
              "",
              "В /setup нужно указать ElevenLabs API Key и ElevenLabs Voice ID.",
              "",
              requireString(body.text, "text"),
            ].join("\n"),
          });
          sendJson(response, 200, {
            ok: true,
            data: {
              sentAsTextFallback: true,
              reason: "ElevenLabs TTS is not configured",
            },
          });
          return;
        }
        const audio = await voiceService.synthesize(requireString(body.text, "text"));
        const sent = await telegram.sendVoice({
          chatId: requireString(body.chatId, "chatId"),
          audioBytes: audio.bytes,
          filename: audio.filename,
          mimeType: audio.mimeType,
          caption: body.caption || "Ответ голосом",
        });
        sendJson(response, 200, {
          ok: true,
          data: {
            sent,
            provider: audio.provider,
            model: audio.model,
            mimeType: audio.mimeType,
          },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/token-usage/events") {
        assertUsageIngestAllowed(request);
        const body = await readJsonBody(request);
        const result = await store.update((state) => {
          const events = recordTokenUsageEvents(state, body);
          appendAuditEvent(state, {
            actorUserId: "system",
            actorTelegramUserId: null,
            action: "token_usage.record",
            target: { eventCount: events.length },
          });
          return { events };
        });
        sendJson(response, 201, { ok: true, data: result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/device-agents/heartbeat") {
        const body = await readJsonBody(request);
        const state = await store.load();
        assertDeviceAgentIngestAllowed(request, state, body);
        const remoteAddress = readRemoteAddress(request);
        const result = await store.update((state) => {
          const heartbeat = upsertDeviceAgentHeartbeat(state, body, { remoteAddress });
          if (heartbeat.created) {
            appendAuditEvent(state, {
              actorUserId: heartbeat.agent.userId,
              actorTelegramUserId: null,
              action: "device_agent.first_seen",
              target: {
                userId: heartbeat.agent.userId,
                deviceId: heartbeat.agent.deviceId,
                hostname: heartbeat.agent.hostname,
              },
            });
          }
          return heartbeat;
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/device-agents/activate") {
        const body = await readJsonBody(request);
        const remoteAddress = readRemoteAddress(request);
        const result = await store.update((state) => {
          const activation = activateDeviceAgent(state, body, { remoteAddress });
          appendAuditEvent(state, {
            actorUserId: activation.user.id,
            actorTelegramUserId: null,
            action: "device_agent.activate",
            target: {
              userId: activation.user.id,
              deviceId: activation.agent.deviceId,
              inviteCodeLast4: activation.agent.inviteCodeLast4,
            },
          });
          return activation;
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/local-agent/chat") {
        const body = await readJsonBody(request);
        const localAction = await store.update((state) => {
          assertDeviceAgentIngestAllowed(request, state, body);
          const agent = (state.deviceAgents || []).find(
            (item) => item.deviceId === String(body.deviceId || "").trim(),
          );
          if (!agent) {
            throw unauthorized("Local agent is not registered");
          }
          const actor = getUserById(state, agent.userId);
          if (isNaturalRemainingDoneText(body.text)) {
            const completed = markRemainingDailyPlanItemsDone(state, { actor });
            const answer = formatRemainingDoneResult(completed);
            recordAssistantMemoryEvent(state, {
              userId: actor.id,
              channel: "local-agent",
              role: "user",
              kind: "daily_plan_remaining_done_request",
              text: body.text,
              target: { userId: actor.id, date: completed.plan.date },
              metadata: { completedCount: completed.completedCount },
            });
            recordAssistantMemoryEvent(state, {
              userId: actor.id,
              channel: "local-agent",
              role: "assistant",
              kind: "daily_plan_remaining_done_response",
              text: answer,
              target: { userId: actor.id, date: completed.plan.date },
              metadata: { completedCount: completed.completedCount },
            });
            return { kind: "daily_plan", answer };
          }
          const queued = tryCreateNaturalDeviceCommand(state, {
            actor,
            text: body.text,
            currentDeviceId: agent.deviceId,
            source: "local-agent-chat",
          });
          if (!queued) {
            return { kind: "assistant", agent };
          }
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "local_agent.device_command.create",
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
            channel: "local-agent",
            role: "user",
            kind: "device_action_request",
            text: body.text,
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
          });
          recordAssistantMemoryEvent(state, {
            userId: actor.id,
            channel: "local-agent",
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
          });
          return { kind: "device_command", queued };
        });

        if (localAction.kind === "daily_plan") {
          sendJson(response, 200, {
            ok: true,
            data: { answer: localAction.answer },
          });
          return;
        }

        if (localAction.kind === "device_command") {
          sendJson(response, 200, {
            ok: true,
            data: { answer: formatNaturalDeviceCommandQueued(localAction.queued) },
          });
          return;
        }

        const claudeClient = resolveClaudeClient();
        if (!claudeClient) {
          throw validation("Claude client is not enabled on this server");
        }
        const answer = await answerCompanyAssistant({
          store,
          actorUserId: localAction.agent.userId,
          question: body.text,
          claudeClient,
          kickidlerClient: await resolveKickidlerClient(),
          bitrixClient: resolveBitrixClient(),
          platrumClient: resolvePlatrumClient(),
          googleOAuthService,
          voyageClient: resolveVoyageClient(),
          embeddingStore,
        });
        sendJson(response, 200, {
          ok: true,
          data: {
            answer: typeof answer === "string" ? answer : answer.plainText,
            answerHtml: typeof answer === "string" ? null : answer.html,
          },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/device-agents/commands") {
        const deviceId = url.searchParams.get("deviceId");
        const result = await store.update((state) => {
          assertDeviceAgentIngestAllowed(request, state, { deviceId });
          return claimDeviceCommands(state, {
            deviceId,
            limit: url.searchParams.get("limit"),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      const deviceCommandResultMatch = url.pathname.match(
        /^\/api\/v1\/device-agents\/commands\/([^/]+)\/result$/,
      );
      if (request.method === "POST" && deviceCommandResultMatch) {
        const body = await readJsonBody(request);
        const commandId = decodeURIComponent(deviceCommandResultMatch[1]);
        const deviceId = body.deviceId || url.searchParams.get("deviceId");
        const result = await store.update((state) => {
          assertDeviceAgentIngestAllowed(request, state, { deviceId });
          const command = completeDeviceCommand(state, {
            ...body,
            commandId,
            deviceId,
          });
          appendAuditEvent(state, {
            actorUserId: command.userId,
            actorTelegramUserId: null,
            action: "device_command.complete",
            target: {
              commandId: command.id,
              deviceId: command.deviceId,
              userId: command.userId,
              status: command.status,
              type: command.type,
            },
          });
          syncDeviceCommandOpenLoop(state, command);
          return { command };
        });
        void appendTimelineEvent({
          dataFilePath: store.filePath || null,
          userId: result.command.userId,
          event: {
            kind: "device_action",
            actorUserId: result.command.actorUserId,
            title: `${result.command.type} — ${result.command.status}`,
            detail: JSON.stringify(result.command.args || {}).slice(0, 500),
            links: { userIds: [result.command.userId, result.command.actorUserId].filter(Boolean) },
            source: result.command.source || "device",
            metadata: { type: result.command.type, status: result.command.status },
          },
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/token-usage/summary") {
        const period = readTokenUsageSummaryPeriod(url);
        const data = await store.update((state) => {
          const actor = requireActor(state, request);
          assertCanIssueInvite(actor);
          const summary = buildTokenUsageSummary(state, period);
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "token_usage.summary.read",
            target: { period: period.key, from: period.from, to: period.to },
          });
          return { period, summary };
        });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/telegram/register") {
        const body = await readJsonBody(request);
        const result = await store.update((state) => {
          const redeemed = redeemInviteCode(state, body);
          appendAuditEvent(state, {
            actorUserId: redeemed.user.id,
            actorTelegramUserId: redeemed.user.telegram.telegramUserId,
            action: "telegram.register",
            target: { userId: redeemed.user.id, inviteCodeLast4: redeemed.invite.codeLast4 },
          });
          return { user: publicUser(redeemed.user) };
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/me") {
        const state = await store.load();
        const actor = requireActor(state, request);
        sendJson(response, 200, { ok: true, data: { user: publicUser(actor) } });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/users/accessible") {
        const state = await store.load();
        const actor = requireActor(state, request);
        const userIds = new Set(listAccessibleUserIds(state, actor));
        sendJson(response, 200, {
          ok: true,
          data: {
            users: state.users.filter((user) => userIds.has(user.id)).map(publicUser),
          },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/projects/accessible") {
        const state = await store.load();
        const actor = requireActor(state, request);
        const userIds = new Set(listAccessibleUserIds(state, actor));
        const projects = state.projects.filter((project) => {
          if (actor.role === "OWNER") {
            return true;
          }
          return project.managerUserId === actor.id || project.memberUserIds.some((id) => userIds.has(id));
        });
        sendJson(response, 200, { ok: true, data: { projects: projects.map(publicProject) } });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/device-actions") {
        const state = await store.load();
        requireActor(state, request);
        sendJson(response, 200, {
          ok: true,
          data: { actions: DEVICE_ACTION_TYPES },
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/device-agents") {
        const state = await store.load();
        const actor = requireActor(state, request);
        sendJson(response, 200, {
          ok: true,
          data: { agents: listVisibleDeviceAgents(state, actor) },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/agent/task") {
        const body = await readJsonBody(request);
        const state = await store.load();
        const actor = requireActor(state, request);
        const device = resolveAgentTaskDevice(state, actor, body);
        const claudeClient = resolveClaudeClient();
        if (!claudeClient) {
          throw validation("Claude client is not enabled on this server");
        }
        const enqueueAndWait = makeDeviceCommandRunner({ store, actor, device });
        const outcome = await runAgentTask({
          store,
          claudeClient,
          actor,
          device,
          instruction: body.instruction || body.text,
          enqueueAndWait,
          browserClient: createBrowserClientFromEnv(),
          maxSteps: Number(body.maxSteps) || undefined,
        });
        sendJson(response, 200, { ok: true, data: outcome });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/device-commands") {
        const body = await readJsonBody(request);
        const result = await store.update((state) => {
          const actor = requireActor(state, request);
          const command = createDeviceCommand(state, body, { actor });
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "device_command.create",
            target: {
              commandId: command.id,
              deviceId: command.deviceId,
              userId: command.userId,
              type: command.type,
            },
          });
          return { command };
        });
        sendJson(response, 201, { ok: true, data: result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/device-commands") {
        const state = await store.load();
        const actor = requireActor(state, request);
        const commands = listVisibleDeviceCommands(state, actor, {
          deviceId: url.searchParams.get("deviceId"),
          userId: url.searchParams.get("userId"),
          limit: url.searchParams.get("limit"),
        });
        sendJson(response, 200, { ok: true, data: { commands } });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/invite-codes") {
        const body = await readJsonBody(request);
        const result = await store.update((state) => {
          const actor = requireActor(state, request);
          assertCanIssueInvite(actor);
          const created = createInviteCode(state, {
            issuer: actor,
            userId: body.userId,
            ttlMinutes: body.ttlMinutes,
            code: body.code,
          });
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "invite_code.create",
            target: { userId: created.invite.userId, inviteCodeLast4: created.invite.codeLast4 },
          });
          return {
            code: created.code,
            invite: {
              id: created.invite.id,
              userId: created.invite.userId,
              role: created.invite.role,
              displayName: created.invite.displayName,
              expiresAt: created.invite.expiresAt,
              codeLast4: created.invite.codeLast4,
            },
          };
        });
        sendJson(response, 201, { ok: true, data: result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/invite-codes/reissue") {
        const body = await readJsonBody(request);
        const result = await store.update((state) => {
          const actor = requireActor(state, request);
          assertCanIssueInvite(actor);
          const reissued = reissueInviteCode(state, {
            issuer: actor,
            userId: body.userId,
            ttlMinutes: body.ttlMinutes,
            code: body.code,
          });
          appendAuditEvent(state, {
            actorUserId: actor.id,
            actorTelegramUserId: actor.telegram?.telegramUserId,
            action: "invite_code.reissue",
            target: { userId: reissued.invite.userId, inviteCodeLast4: reissued.invite.codeLast4 },
            metadata: { revokedCount: reissued.revokedCount },
          });
          return {
            code: reissued.code,
            revokedCount: reissued.revokedCount,
            invite: {
              id: reissued.invite.id,
              userId: reissued.invite.userId,
              role: reissued.invite.role,
              displayName: reissued.invite.displayName,
              expiresAt: reissued.invite.expiresAt,
              codeLast4: reissued.invite.codeLast4,
            },
          };
        });
        sendJson(response, 201, { ok: true, data: result });
        return;
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/api/v1/reports/kickidler/activity-summary" ||
          url.pathname === "/api/v1/reports/metricon/activity-summary")
      ) {
        const body = await readJsonBody(request);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          return await buildKickidlerActivitySummary(state, {
            actor,
            request: body,
            kickidlerClient: await resolveKickidlerClient(),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/reports/platrum/project-status"
      ) {
        const body = await readJsonBody(request);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          return await buildPlatrumProjectStatusReport(state, {
            actor,
            request: body,
            platrumClient: resolvePlatrumClient(),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/reports/platrum/user-status"
      ) {
        const body = await readJsonBody(request);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          return await buildPlatrumUserStatusReport(state, {
            actor,
            request: body,
            platrumClient: resolvePlatrumClient(),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/reports/bitrix/project-status"
      ) {
        const body = await readJsonBody(request);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          return await buildBitrixProjectStatusReport(state, {
            actor,
            request: body,
            bitrixClient: resolveBitrixClient(),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/v1/reports/bitrix/user-status"
      ) {
        const body = await readJsonBody(request);
        const result = await store.update(async (state) => {
          const actor = requireActor(state, request);
          return await buildBitrixUserStatusReport(state, {
            actor,
            request: body,
            bitrixClient: resolveBitrixClient(),
          });
        });
        sendJson(response, 200, { ok: true, data: result });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/health/integrations") {
        const state = await store.load();
        try {
          assertAutomationToken(request);
        } catch {
          const actor = requireActor(state, request);
          if (actor.role !== "OWNER") {
            throw forbidden("Only OWNER can read integrations health");
          }
        }
        const data = await buildIntegrationsHealth({
          claudeClient: resolveClaudeClient(),
          telegramApi: resolveTelegramApi(),
          kickidlerClient: await resolveKickidlerClient(),
          platrumClient: resolvePlatrumClient(),
          bitrixClient: resolveBitrixClient(),
          voiceService: resolveVoiceService(),
          googleOAuthService,
        });
        sendJson(response, 200, { ok: true, data });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/audit-log") {
        const state = await store.load();
        const actor = requireActor(state, request);
        assertCanIssueInvite(actor);
        const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
        sendJson(response, 200, {
          ok: true,
          data: {
            events: state.auditLog.slice(-limit).reverse(),
          },
        });
        return;
      }

      throw notFound(`Route not found: ${request.method} ${url.pathname}`);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function assertUsageIngestAllowed(request, env = process.env) {
  const expected = env.TOKEN_USAGE_INGEST_TOKEN;
  if (!expected) {
    return;
  }
  const actual = request.headers["x-usage-ingest-token"];
  const value = Array.isArray(actual) ? actual[0] : actual;
  if (String(value || "") !== expected) {
    throw unauthorized("Invalid token usage ingest token");
  }
}

function assertDeviceAgentIngestAllowed(request, state = null, body = {}, env = process.env) {
  const expected = env.DEVICE_AGENT_INGEST_TOKEN || env.TOKEN_USAGE_INGEST_TOKEN;
  const actual =
    request.headers["x-device-agent-token"] || request.headers["x-usage-ingest-token"];
  const value = Array.isArray(actual) ? actual[0] : actual;

  if (expected && String(value || "") === expected) {
    return;
  }
  if (state && isValidDeviceAgentToken(state, { deviceId: body.deviceId, token: value })) {
    return;
  }
  if (!expected && !value) {
    return;
  }
  throw unauthorized("Invalid device agent ingest token");
}

function readRemoteAddress(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(value || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function readTokenUsageSummaryPeriod(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    return {
      key: "custom",
      label: "custom",
      from,
      to,
    };
  }
  return resolveTokenUsagePeriod(url.searchParams.get("period") || "day");
}

function readGoogleWorkspacePeriod(url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    return {
      label: "custom",
      from,
      to,
    };
  }
  return resolveTokenUsagePeriod(url.searchParams.get("period") || "day");
}

function readGoogleWorkspaceLimits(url) {
  return {
    calendarEvents: readIntQuery(url, "calendarEvents", 25, 1, 100),
    calendarList: readIntQuery(url, "calendarList", 200, 1, 250),
    sharedCalendarMatches: readIntQuery(url, "sharedCalendarMatches", 12, 1, 50),
    sharedCalendarEvents: readIntQuery(url, "sharedCalendarEvents", 25, 1, 100),
    gmailMessages: readIntQuery(url, "gmailMessages", 15, 1, 50),
    driveFiles: readIntQuery(url, "driveFiles", 20, 1, 100),
    documentFiles: readIntQuery(url, "documentFiles", 6, 0, 20),
    docCharLimit: readIntQuery(url, "docCharLimit", 3500, 500, 20000),
    sheetRows: readIntQuery(url, "sheetRows", 30, 1, 200),
    sheetColumns: readIntQuery(url, "sheetColumns", 10, 1, 50),
    calendarSearchTerms: url.searchParams.getAll("calendarSearchTerm")
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function requireString(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw validation(`${field} is required`);
  }
  return normalized;
}

function readIntQuery(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

async function syncOwnerTelegramId(store, telegramUserId) {
  const normalized = String(telegramUserId || "").trim();
  if (!normalized) {
    return;
  }
  await store.update((state) => {
    const owner = state.users.find((user) => user.id === "u-nikolay");
    if (!owner) {
      return;
    }
    owner.telegram = {
      telegramUserId: normalized,
      username: owner.telegram?.username || "nikolay",
      linkedAt: owner.telegram?.linkedAt || new Date().toISOString(),
    };
    appendAuditEvent(state, {
      actorUserId: "system",
      actorTelegramUserId: null,
      action: "setup.owner_telegram.update",
      target: { userId: owner.id, telegramUserId: normalized },
    });
  });
}

function assertGoogleOAuthEnabled(googleOAuthService) {
  if (!googleOAuthService) {
    throw notFound("Google OAuth service is not enabled");
  }
}

function readPublicBaseUrl(request, env = process.env) {
  const configured = env.CONTROL_PLANE_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/u, "");
  }
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const proto = forwardedProto || "https";
  const host = forwardedHost || firstHeader(request.headers.host) || "starlabagent.pp.ua";
  return `${proto}://${host}`.replace(/\/+$/u, "");
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

const INTERNAL_API_TOKEN_EXEMPT_PREFIXES = [
  "/api/v1/google/oauth/callback",
  "/api/v1/google/oauth/start",
  "/api/v1/device-agents/",
  "/api/v1/automation/",
  "/api/v1/setup/",
  "/api/v1/health/integrations",
  // Publicly proxied through nginx for desktop agents; authenticates with
  // its own device token inside the handler.
  "/api/v1/local-agent/",
];

/**
 * If INTERNAL_API_TOKEN is configured, all /api/v1/* requests must carry a
 * matching X-Internal-Token header, except for routes that already have
 * their own authentication (device token, automation token, OAuth public
 * flow, local setup wizard) or are public health checks.
 *
 * When INTERNAL_API_TOKEN is not set, this is a no-op (existing behavior).
 */
function assertInternalApiToken(request, url, env = process.env) {
  const expected = env.INTERNAL_API_TOKEN;
  if (!expected) {
    return;
  }
  if (!url.pathname.startsWith("/api/v1/")) {
    return;
  }
  if (INTERNAL_API_TOKEN_EXEMPT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }
  const supplied = firstHeader(request.headers["x-internal-token"]);
  if (!supplied || supplied !== expected) {
    throw unauthorized("Invalid internal API token");
  }
}

function assertAutomationToken(request, env = process.env) {
  const expected = env.AUTOMATION_API_TOKEN || env.TOKEN_USAGE_INGEST_TOKEN;
  if (!expected) {
    throw unauthorized("Automation API token is not configured");
  }
  const supplied = firstHeader(request.headers["x-automation-token"]);
  if (!supplied || supplied !== expected) {
    throw unauthorized("Invalid automation API token");
  }
}

async function sendDownloadFile(response, pathname, { headOnly = false } = {}) {
  const downloadsRoot = path.resolve(process.env.DOWNLOADS_DIR || path.join(process.cwd(), "public", "downloads"));
  const relative = decodeURIComponent(pathname.replace(/^\/downloads\//u, ""));
  const filePath = path.resolve(downloadsRoot, relative);
  if (!filePath.startsWith(`${downloadsRoot}${path.sep}`)) {
    throw notFound("Download not found");
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw notFound("Download not found");
  }
  if (!stat.isFile()) {
    throw notFound("Download not found");
  }
  response.writeHead(200, {
    "Content-Type": contentTypeForDownload(filePath),
    "Content-Length": stat.size,
    "Content-Disposition": `attachment; filename="${path.basename(filePath).replaceAll('"', "")}"`,
  });
  if (headOnly) {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}

function contentTypeForDownload(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".exe") {
    return "application/vnd.microsoft.portable-executable";
  }
  if (ext === ".pkg") {
    return "application/octet-stream";
  }
  if (ext === ".dmg") {
    return "application/x-apple-diskimage";
  }
  if (ext === ".deb") {
    return "application/vnd.debian.binary-package";
  }
  if (ext === ".sh") {
    return "text/x-shellscript; charset=utf-8";
  }
  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

function isNaturalRemainingDoneText(value) {
  const text = String(value || "").toLowerCase().replace(/ё/gu, "е");
  const hasDoneVerb = /(сделал|сделала|сделали|выполнил|выполнила|выполнили|закрыл|закрыла|закрыли|готово|done)/iu.test(text);
  const hasRemaining = /(оставш|остальн|оставшиеся|оставшиеся задачи|все задачи|все пункты|все остальное|все остальные)/iu.test(text);
  return hasDoneVerb && hasRemaining;
}

function renderGoogleOAuthResultPage({ ok, message, status }) {
  const title = ok ? "Google connected" : "Google connection failed";
  const email = status?.googleAccountEmail
    ? `<p><strong>Account:</strong> ${escapeHtml(status.googleAccountEmail)}</p>`
    : "";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; background: #f4f6f8; color: #18202a; margin: 0; }
    main { max-width: 680px; margin: 72px auto; background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.5; }
    .ok { color: #0e7c66; }
    .error { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1 class="${ok ? "ok" : "error"}">${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${email}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function deviceCommandSignature(command) {
  return `${command.type}:${JSON.stringify(command.args || {})}`;
}

/**
 * Records the success/failure of a device command as an assistant open loop so the
 * memory layer can surface unresolved follow-ups. This is additive: the retry logic
 * itself lives in natural-device-actions.js and is not duplicated here.
 */
export function syncDeviceCommandOpenLoop(state, command) {
  if (!command?.userId) {
    return;
  }
  const signature = deviceCommandSignature(command);
  const failed = ["failed", "rejected", "unsupported"].includes(command.status);
  if (failed) {
    const existing = findOpenLoopBySource(state, {
      userId: command.userId,
      type: "device_command",
      id: signature,
    });
    if (!existing) {
      openAssistantLoop(state, {
        userId: command.userId,
        kind: "command_follow_up",
        text: `Команда ${command.type} не выполнилась: ${command.error || command.status}`,
        source: { type: "device_command", id: signature },
        metadata: { commandId: command.id, type: command.type, status: command.status },
      });
    }
    return;
  }
  if (command.status === "succeeded") {
    const existing = findOpenLoopBySource(state, {
      userId: command.userId,
      type: "device_command",
      id: signature,
    });
    if (existing) {
      resolveAssistantLoop(state, {
        id: existing.id,
        userId: command.userId,
        resolution: `Команда ${command.type} выполнена при повторе (${command.id}).`,
      });
    }
  }
}

/**
 * Optional defense-in-depth for the actor-header management endpoints. When
 * CONTROL_PLANE_INTERNAL_TOKEN is configured, callers must also present a
 * matching X-Internal-Token (constant-time compared). Unset by default, so this
 * is fully backward compatible: enable it once the management client sends the
 * token. The unsigned X-Actor-Telegram-Id remains usable on its own otherwise —
 * acceptable because these endpoints are loopback-only (not in the nginx
 * external allowlist) and the SSRF path to loopback is now closed.
 */
function assertInternalToken(request, env) {
  const configured = String(env.CONTROL_PLANE_INTERNAL_TOKEN || "").trim();
  if (!configured) {
    return;
  }
  const provided = request.headers["x-internal-token"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (typeof value !== "string" || !constantTimeEqual(value, configured)) {
    throw unauthorized("X-Internal-Token is required");
  }
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function requireActor(state, request, env = process.env) {
  assertInternalToken(request, env);
  const telegramUserId = actorTelegramIdFromHeaders(request);
  if (!telegramUserId) {
    throw unauthorized("X-Actor-Telegram-Id header is required");
  }
  const actor = state.users.find(
    (user) => user.telegram?.telegramUserId === String(telegramUserId).trim(),
  );
  if (!actor) {
    throw unauthorized("Telegram account is not registered");
  }
  return actor;
}

