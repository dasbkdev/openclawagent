import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRouter } from "../src/api/router.js";
import { createInitialState } from "../src/infra/seed.js";

function createMemoryStore() {
  let state = createInitialState();
  return {
    async load() {
      return state;
    },
    async update(mutator) {
      const result = await mutator(state);
      return result;
    },
  };
}

async function startServer(router) {
  const server = http.createServer(router);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function withEnv(overrides, callback) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const key of Object.keys(previous)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
    });
}

test("without INTERNAL_API_TOKEN, /api/v1/* works without X-Internal-Token", async () => {
  await withEnv({ INTERNAL_API_TOKEN: undefined }, async () => {
    const store = createMemoryStore();
    const router = createRouter({ store });
    const { baseUrl, close } = await startServer(router);
    try {
      const response = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { "X-Actor-Telegram-Id": "dev-nikolay" },
      });
      assert.equal(response.status, 200);
    } finally {
      await close();
    }
  });
});

test("with INTERNAL_API_TOKEN set, /api/v1/* requires X-Internal-Token", async () => {
  await withEnv({ INTERNAL_API_TOKEN: "secret-internal-token" }, async () => {
    const store = createMemoryStore();
    const router = createRouter({ store });
    const { baseUrl, close } = await startServer(router);
    try {
      const unauthorized = await fetch(`${baseUrl}/api/v1/me`, {
        headers: { "X-Actor-Telegram-Id": "dev-nikolay" },
      });
      assert.equal(unauthorized.status, 401);

      const wrongToken = await fetch(`${baseUrl}/api/v1/me`, {
        headers: {
          "X-Actor-Telegram-Id": "dev-nikolay",
          "X-Internal-Token": "wrong",
        },
      });
      assert.equal(wrongToken.status, 401);

      const authorized = await fetch(`${baseUrl}/api/v1/me`, {
        headers: {
          "X-Actor-Telegram-Id": "dev-nikolay",
          "X-Internal-Token": "secret-internal-token",
        },
      });
      assert.equal(authorized.status, 200);
    } finally {
      await close();
    }
  });
});

test("with INTERNAL_API_TOKEN set, exempt routes work without X-Internal-Token", async () => {
  await withEnv(
    {
      INTERNAL_API_TOKEN: "secret-internal-token",
      AUTOMATION_API_TOKEN: "automation-secret",
      DEVICE_AGENT_INGEST_TOKEN: "device-secret",
    },
    async () => {
      const store = createMemoryStore();
      const router = createRouter({ store });
      const { baseUrl, close } = await startServer(router);
      try {
        // /api/v1/setup/status - local setup wizard, no internal token required.
        const setupStatus = await fetch(`${baseUrl}/api/v1/setup/status`);
        assert.equal(setupStatus.status, 200);

        // /api/v1/automation/* - protected by automation token, not internal token.
        const automationNoToken = await fetch(`${baseUrl}/api/v1/automation/daily-assistant/run`, {
          method: "POST",
        });
        assert.equal(automationNoToken.status, 401);

        const automationWithToken = await fetch(`${baseUrl}/api/v1/automation/daily-assistant/run`, {
          method: "POST",
          headers: { "X-Automation-Token": "automation-secret" },
        });
        // Telegram API is not configured in this test setup, so this resolves
        // with a validation error (400) rather than 401 - the important part
        // is that it is NOT rejected for missing X-Internal-Token (401 with
        // "internal" message would indicate that).
        assert.notEqual(automationWithToken.status, 401);

        // /api/v1/device-agents/* - device token auth, no internal token required.
        const heartbeat = await fetch(`${baseUrl}/api/v1/device-agents/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Device-Agent-Token": "device-secret",
          },
          body: JSON.stringify({ deviceId: "device-1", userId: "u-nikolay", hostname: "test-host" }),
        });
        assert.notEqual(heartbeat.status, 401);

        // /api/v1/health/integrations - works with automation token, no internal token required.
        const health = await fetch(`${baseUrl}/api/v1/health/integrations`, {
          headers: { "X-Automation-Token": "automation-secret" },
        });
        assert.equal(health.status, 200);
        const healthBody = await health.json();
        assert.ok(healthBody.data.integrations);

        // A non-exempt route without internal token is still rejected.
        const me = await fetch(`${baseUrl}/api/v1/me`, {
          headers: { "X-Actor-Telegram-Id": "dev-nikolay" },
        });
        assert.equal(me.status, 401);
      } finally {
        await close();
      }
    },
  );
});

test("health endpoint allows OWNER actor without automation token", async () => {
  await withEnv({ INTERNAL_API_TOKEN: undefined, AUTOMATION_API_TOKEN: undefined, TOKEN_USAGE_INGEST_TOKEN: undefined }, async () => {
    const store = createMemoryStore();
    const router = createRouter({ store });
    const { baseUrl, close } = await startServer(router);
    try {
      const asOwner = await fetch(`${baseUrl}/api/v1/health/integrations`, {
        headers: { "X-Actor-Telegram-Id": "dev-nikolay" },
      });
      assert.equal(asOwner.status, 200);

      const noAuth = await fetch(`${baseUrl}/api/v1/health/integrations`);
      assert.equal(noAuth.status, 401);
    } finally {
      await close();
    }
  });
});
