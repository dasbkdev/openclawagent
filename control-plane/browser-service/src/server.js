// HTTP entrypoint for the Starlab browser service.
// Binds to 127.0.0.1 only. Auth via X-Browser-Token (or loopback-only).

import http from "node:http";
import { checkBrowserAuth, validateBrowseRequest } from "./validate.js";
import { runBrowserTask, closeBrowser } from "./browser.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BROWSER_SERVICE_PORT) || 3210;
const TOKEN = process.env.BROWSER_SERVICE_TOKEN;
const MAX_BODY_BYTES = 256 * 1024; // 256KB request bodies are plenty

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  try {
    // Health check is unauthenticated and cheap.
    if (method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true, service: "starlab-browser-service" });
      return;
    }

    // Auth for everything else.
    const auth = checkBrowserAuth({
      token: TOKEN,
      headerToken: req.headers["x-browser-token"],
      remoteAddress: req.socket.remoteAddress,
    });
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: `unauthorized: ${auth.reason}` });
      return;
    }

    if (method === "POST" && path === "/api/v1/browse/run") {
      let raw;
      try {
        raw = await readBody(req);
      } catch (err) {
        sendJson(res, 413, { ok: false, error: shortMsg(err) });
        return;
      }

      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }

      let task;
      try {
        task = validateBrowseRequest(body);
      } catch (err) {
        sendJson(res, 400, { ok: false, error: shortMsg(err) });
        return;
      }

      // runBrowserTask never throws — it returns {ok:false,error} on failure.
      const result = await runBrowserTask(task);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    // Catch-all: never leak a bare 500 without a structured body.
    console.error("[browser-service] unhandled error:", err);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: shortMsg(err) });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
});

function shortMsg(err) {
  const m = err && err.message ? String(err.message) : String(err);
  return m.split("\n")[0].slice(0, 500);
}

server.listen(PORT, HOST, () => {
  const mode = TOKEN ? "token-auth" : "loopback-only";
  console.log(
    `[browser-service] listening on http://${HOST}:${PORT} (${mode})`,
  );
});

async function shutdown(signal) {
  console.log(`[browser-service] ${signal} received, shutting down`);
  server.close();
  await closeBrowser();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
