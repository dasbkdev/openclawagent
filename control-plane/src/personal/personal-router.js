/**
 * HTTP router for the personal-assistant process. Self-contained (no work code).
 * Endpoints:
 *   GET  /health
 *   GET  /v1/models
 *   POST /v1/chat/completions              (Bearer personal token → that user only)
 *   POST /api/v1/personal/activate         ({ code } → { token, userId })
 *   POST /api/v1/personal/issue-code       (admin → { code })   X-Actor-Telegram-Id
 *   POST /api/v1/personal/profile          (Bearer token → set assistantName)
 */

export function createPersonalRouter({
  store,
  identity,
  getClaudeClient,
  getVoyageClient,
  answerPersonalAssistant,
  adminTelegramIds = "",
}) {
  const admins = new Set(String(adminTelegramIds).split(/[,\s]+/u).map((s) => s.trim()).filter(Boolean));

  return async function router(request, response) {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, service: "company-personal-assistant" });
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(response, 200, {
          object: "list",
          data: [{ id: "starlab-personal", object: "model", created: 0, owned_by: "starlab" }],
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const token = bearer(request);
        const who = token ? await identity.resolveToken(token) : null;
        if (!who) {
          return sendJson(response, 401, { error: { message: "Invalid or missing personal key", type: "invalid_request_error" } });
        }
        const body = await readJson(request);
        const question = lastUserText(body?.messages);
        if (!question) {
          return sendJson(response, 400, { error: { message: "messages must include a user message", type: "invalid_request_error" } });
        }
        const claudeClient = getClaudeClient();
        if (!claudeClient || claudeClient.configured === false) {
          return sendJson(response, 503, { error: { message: "Assistant is not enabled", type: "server_error" } });
        }
        const answer = await answerPersonalAssistant({
          store,
          userId: who.userId,
          displayName: who.displayName,
          question,
          claudeClient,
          voyageClient: getVoyageClient(),
        });
        return sendJson(response, 200, {
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: typeof body?.model === "string" && body.model ? body.model : "starlab-personal",
          choices: [{ index: 0, message: { role: "assistant", content: answer.plainText }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/personal/activate") {
        const body = await readJson(request);
        const redeemed = await identity.redeemCode(body?.code);
        if (!redeemed) {
          return sendJson(response, 400, { ok: false, error: "Invalid or expired code" });
        }
        return sendJson(response, 200, { ok: true, data: { token: redeemed.token, userId: redeemed.userId, displayName: redeemed.displayName } });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/personal/issue-code") {
        const actor = actorTelegramId(request);
        if (!actor || !admins.has(actor)) {
          return sendJson(response, 403, { ok: false, error: "Only an admin can issue personal codes" });
        }
        const body = await readJson(request);
        if (!body?.userId) {
          return sendJson(response, 400, { ok: false, error: "userId is required" });
        }
        const issued = await identity.issueCode({ userId: String(body.userId), displayName: body.displayName || null, code: body.code });
        return sendJson(response, 200, { ok: true, data: issued });
      }

      if (request.method === "POST" && url.pathname === "/api/v1/personal/profile") {
        const token = bearer(request);
        const who = token ? await identity.resolveToken(token) : null;
        if (!who) {
          return sendJson(response, 401, { ok: false, error: "Invalid personal key" });
        }
        const body = await readJson(request);
        const name = String(body?.assistantName || "").trim().slice(0, 60);
        await store.updateUser(who.userId, (s) => {
          s.profile ||= {};
          if (name) {
            s.profile.assistantName = name;
          }
        });
        return sendJson(response, 200, { ok: true, data: { assistantName: name || null } });
      }

      return sendJson(response, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    } catch (error) {
      return sendJson(response, 500, { error: { message: error instanceof Error ? error.message : "Internal error", type: "server_error" } });
    }
  };
}

function bearer(request) {
  const auth = request.headers["authorization"];
  const m = /^Bearer\s+(.+)$/iu.exec(String(Array.isArray(auth) ? auth[0] : auth || "").trim());
  if (m) {
    return m[1].trim();
  }
  const alt = request.headers["x-api-key"] || request.headers["x-personal-token"];
  return alt ? String(Array.isArray(alt) ? alt[0] : alt).trim() : null;
}

function actorTelegramId(request) {
  const v = request.headers["x-actor-telegram-id"];
  return v ? String(Array.isArray(v) ? v[0] : v).trim() : null;
}

function lastUserText(messages) {
  if (!Array.isArray(messages)) {
    return "";
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") {
      continue;
    }
    if (typeof msg.content === "string") {
      return msg.content.trim();
    }
    if (Array.isArray(msg.content)) {
      const t = msg.content.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text : "")).filter(Boolean).join("\n").trim();
      if (t) {
        return t;
      }
    }
  }
  return "";
}

function readJson(request) {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    request.on("error", () => resolve({}));
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}
