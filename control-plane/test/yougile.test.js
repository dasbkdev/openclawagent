import assert from "node:assert/strict";
import test from "node:test";
import {
  createYouGileClientFromEnv,
  DisabledYouGileClient,
  HttpYouGileClient,
} from "../src/connectors/yougile-client.js";

test("YouGile is disabled by default even when code is deployed", async () => {
  const client = createYouGileClientFromEnv({});
  assert.ok(client instanceof DisabledYouGileClient);
  const result = await client.getTasks();
  assert.equal(result.enabled, false);
  assert.deepEqual(result.tasks, []);
});

test("YouGile write requires explicit confirmation and blocks delete", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ id: "task-1" }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpYouGileClient({
    baseUrl: "https://yougile.example/api-v2",
    apiKey: "secret",
  });
  await assert.rejects(
    () => client.createTask({ task: { title: "Draft task" } }),
    /explicit user confirmation/u,
  );
  await assert.rejects(
    () => client.updateTask({ taskId: "task-1", changes: { deleted: true }, confirmed: true }),
    /delete operations are permanently blocked/u,
  );
  assert.equal(fetchCalls, 0);
});

test("YouGile connector uses official task-list and bearer authentication", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ content: [{ id: "task-1", title: "Test" }] }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new HttpYouGileClient({
    baseUrl: "https://yougile.example/api-v2",
    apiKey: "secret",
  });
  const result = await client.getTasks({ assignedTo: ["user-1"], limit: 20 });

  assert.equal(result.tasks.length, 1);
  assert.match(calls[0].url, /\/api-v2\/task-list/u);
  assert.match(calls[0].url, /assignedTo=user-1/u);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
});
