import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createKickidlerClientFromEnv, HttpKickidlerClient } from "../src/connectors/kickidler-client.js";

test("HttpKickidlerClient refreshes an expired Metricon access token and retries", async (t) => {
  const requests = [];
  const { server, baseUrl } = await startServer(async (request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization || "",
    });

    if (request.method === "POST" && request.url === "/api/v1/auth/refresh") {
      const body = await readJson(request);
      assert.equal(body.refreshToken, "refresh-token");
      sendJson(response, 200, {
        success: true,
        data: {
          accessToken: "fresh-token",
          refreshToken: "rotated-refresh-token",
        },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/reports/activity") {
      if (request.headers.authorization === "Bearer expired-token") {
        sendJson(response, 401, { success: false, error: { code: "UNAUTHORIZED" } });
        return;
      }
      if (request.headers.authorization === "Bearer fresh-token") {
        const body = await readJson(request);
        assert.equal(body.employeeId, 7);
        sendJson(response, 200, {
          success: true,
          data: {
            employeeId: 7,
            employeeName: "Employee 7",
            totalActiveTime: 120,
            totalIdleTime: 15,
            topApplications: [{ name: "IDE", seconds: 60 }],
          },
        });
        return;
      }
      sendJson(response, 403, { success: false, error: { code: "FORBIDDEN" } });
      return;
    }

    sendJson(response, 404, { success: false, error: { code: "NOT_FOUND" } });
  });

  t.after(() => server.close());

  const client = new HttpKickidlerClient({
    baseUrl,
    accessToken: "expired-token",
    refreshToken: "refresh-token",
  });

  const summary = await client.getActivitySummary({
    employeeIds: [7],
    from: "2026-06-02T00:00:00Z",
    to: "2026-06-02T23:59:59Z",
  });

  assert.equal(summary.employees[0].activeSeconds, 120);
  assert.equal(summary.employees[0].idleSeconds, 15);
  assert.equal(summary.employees[0].employeeName, "Employee 7");
  assert.equal(client.refreshToken, "rotated-refresh-token");
  assert.deepEqual(
    requests
      .filter((request) => request.url === "/api/v1/reports/activity")
      .map((request) => request.authorization),
    ["Bearer expired-token", "Bearer fresh-token"],
  );
});

test("HttpKickidlerClient notifies caller when Metricon rotates tokens", async (t) => {
  const refreshedTokens = [];
  const { server, baseUrl } = await startServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/v1/auth/refresh") {
      sendJson(response, 200, {
        success: true,
        data: {
          accessToken: "fresh-token",
          refreshToken: "rotated-refresh-token",
          expiresIn: 3600,
          tokenType: "Bearer",
        },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/reports/activity") {
      sendJson(response, 200, {
        success: true,
        data: { employeeId: 7, totalActiveTime: 120, totalIdleTime: 15 },
      });
      return;
    }

    sendJson(response, 404, { success: false, error: { code: "NOT_FOUND" } });
  });

  t.after(() => server.close());

  const client = new HttpKickidlerClient({
    baseUrl,
    refreshToken: "refresh-token",
    onTokenRefresh: async (tokens) => refreshedTokens.push(tokens),
  });

  await client.getActivitySummary({
    employeeIds: [7],
    from: "2026-06-02T00:00:00Z",
    to: "2026-06-02T23:59:59Z",
  });

  assert.deepEqual(refreshedTokens, [
    {
      accessToken: "fresh-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
      tokenType: "Bearer",
    },
  ]);
});

test("HttpKickidlerClient does not refresh Metricon access token on forbidden response", async (t) => {
  const requests = [];
  const { server, baseUrl } = await startServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url });

    if (request.method === "POST" && request.url === "/api/v1/reports/activity") {
      sendJson(response, 403, { success: false, error: { code: "FORBIDDEN" } });
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/auth/refresh") {
      sendJson(response, 200, {
        success: true,
        data: {
          accessToken: "fresh-token",
          refreshToken: "rotated-refresh-token",
        },
      });
      return;
    }

    sendJson(response, 404, { success: false, error: { code: "NOT_FOUND" } });
  });

  t.after(() => server.close());

  const client = new HttpKickidlerClient({
    baseUrl,
    accessToken: "valid-but-forbidden-token",
    refreshToken: "refresh-token",
  });

  const summary = await client.getActivitySummary({
    employeeIds: [7],
    from: "2026-06-02T00:00:00Z",
    to: "2026-06-02T23:59:59Z",
  });

  assert.equal(summary.employees[0].activeSeconds, null);
  assert.equal(summary.employees[0].error.message, "Metricon API request failed");
  assert.equal(summary.employees[0].error.status, 403);

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url.split("?")[0]}`),
    ["POST /api/v1/reports/activity"],
  );
});

test("HttpKickidlerClient logs in when refresh token was rejected by Metricon", async (t) => {
  const requests = [];
  const refreshedTokens = [];
  const { server, baseUrl } = await startServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization || "" });

    if (request.method === "POST" && request.url === "/api/v1/auth/refresh") {
      sendJson(response, 400, {
        success: false,
        error: { code: "REFRESH_TOKEN_REUSE_DETECTED", message: "Refresh token reuse detected" },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/auth/login") {
      const body = await readJson(request);
      assert.equal(body.email, "metricon@example.test");
      assert.equal(body.password, "secret");
      sendJson(response, 200, {
        success: true,
        data: {
          accessToken: "login-access-token",
          refreshToken: "login-refresh-token",
        },
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/reports/activity") {
      if (request.headers.authorization === "Bearer login-access-token") {
        sendJson(response, 200, {
          success: true,
          data: { employeeId: 32, totalActiveTime: 5019, totalIdleTime: 4430 },
        });
        return;
      }
      sendJson(response, 401, { success: false, error: { code: "UNAUTHORIZED" } });
      return;
    }

    sendJson(response, 404, { success: false, error: { code: "NOT_FOUND" } });
  });

  t.after(() => server.close());

  const client = new HttpKickidlerClient({
    baseUrl,
    refreshToken: "reused-refresh-token",
    username: "metricon@example.test",
    password: "secret",
    onTokenRefresh: async (tokens) => refreshedTokens.push(tokens),
  });

  const summary = await client.getActivitySummary({
    employeeIds: [32],
    from: "2026-06-10T00:00:00Z",
    to: "2026-06-11T23:59:59Z",
  });

  assert.equal(summary.employees[0].activeSeconds, 5019);
  assert.equal(summary.employees[0].idleSeconds, 4430);
  assert.equal(client.refreshToken, "login-refresh-token");
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url}`),
    ["POST /api/v1/auth/refresh", "POST /api/v1/auth/login", "POST /api/v1/reports/activity"],
  );
  assert.equal(refreshedTokens.at(-1).refreshToken, "login-refresh-token");
});

test("createKickidlerClientFromEnv accepts refresh-token-only Metricon config", () => {
  const client = createKickidlerClientFromEnv({
    METRICON_BASE_URL: "https://metricon.example.test/api/v1",
    METRICON_REFRESH_TOKEN: "refresh-token",
  });

  assert.equal(client.configured, true);
  assert.equal(client.source, "metricon");
  assert.equal(client.buildApiUrl("auth/refresh").toString(), "https://metricon.example.test/api/v1/auth/refresh");
});

test("createKickidlerClientFromEnv accepts Metricon login credentials", () => {
  const client = createKickidlerClientFromEnv({
    METRICON_BASE_URL: "https://metricon.example.test",
    METRICON_USERNAME: "metricon@example.test",
    METRICON_PASSWORD: "secret",
  });

  assert.equal(client.configured, true);
  assert.equal(client.source, "metricon");
});

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch((error) => {
        response.statusCode = 500;
        response.end(error.stack || String(error));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}
