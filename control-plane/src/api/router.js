import { appendAuditEvent } from "../infra/audit.js";
import { buildBitrixProjectStatusReport } from "../domain/bitrix-reports.js";
import { createInviteCode, redeemInviteCode } from "../domain/invite-codes.js";
import { buildKickidlerActivitySummary } from "../domain/reports.js";
import {
  buildTokenUsageSummary,
  recordTokenUsageEvents,
  resolveTokenUsagePeriod,
} from "../domain/token-usage.js";
import {
  assertCanIssueInvite,
  listAccessibleUserIds,
  publicProject,
  publicUser,
} from "../domain/policy.js";
import { notFound, unauthorized } from "../domain/errors.js";
import { renderSetupPage } from "../setup/setup-page.js";
import { actorTelegramIdFromHeaders, readJsonBody, sendError, sendHtml, sendJson } from "./http-utils.js";

export function createRouter({
  store,
  kickidlerClient,
  bitrixClient,
  getKickidlerClient,
  getBitrixClient,
  setupService,
}) {
  const resolveKickidlerClient = () =>
    getKickidlerClient ? getKickidlerClient() : kickidlerClient;
  const resolveBitrixClient = () => (getBitrixClient ? getBitrixClient() : bitrixClient);

  return async function route(request, response) {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "company-control-plane" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/setup") {
        sendHtml(response, 200, renderSetupPage());
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
            kickidlerClient: resolveKickidlerClient(),
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

export function requireActor(state, request) {
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
