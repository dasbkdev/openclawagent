import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { isWebResearchQuery, answerCompanyAssistant } from "../src/assistant/company-assistant.js";
import { extractWebSources } from "../src/assistant/claude-client.js";
import { createInitialState } from "../src/infra/seed.js";
import { JsonStore } from "../src/infra/json-store.js";

test("isWebResearchQuery detects internet-info intent", () => {
  assert.equal(isWebResearchQuery("найди в интернете курс доллара"), true);
  assert.equal(isWebResearchQuery("какая погода завтра в Бишкеке"), true);
  assert.equal(isWebResearchQuery("загугли последние новости про AI"), true);
  assert.equal(isWebResearchQuery("сколько стоит iphone 16"), true);
  assert.equal(isWebResearchQuery("как сегодня работала Бегайым"), false);
  assert.equal(isWebResearchQuery("открой хром"), false);
});

test("extractWebSources pulls urls from web tool result blocks", () => {
  const payload = {
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { url: "https://a.com/x", title: "A" },
          { url: "https://b.com", title: "B" },
          { url: "https://a.com/x", title: "dup" },
        ],
      },
      { type: "text", text: "answer", citations: [{ url: "https://c.com", title: "C" }] },
    ],
  };
  const sources = extractWebSources(payload);
  assert.deepEqual(sources.map((s) => s.url), ["https://a.com/x", "https://b.com", "https://c.com"]);
});

test("assistant runs web research for internet questions and grounds the answer", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "8859688650" };
  const file = path.join(os.tmpdir(), `web-research-${Date.now()}.json`);
  const store = new JsonStore(file, () => state);

  let researchCalled = false;
  const claudeClient = {
    configured: true,
    async researchWeb() {
      researchCalled = true;
      return { text: "Курс доллара ~89.5 KGS.", sources: [{ url: "https://nbkr.kg", title: "НБКР" }], configured: true };
    },
    async complete({ user }) {
      // The grounded answer should have webResearch in the user prompt.
      assert.match(user, /webResearch|Курс доллара/u);
      return {
        text: JSON.stringify({ title: "Курс доллара", sections: [{ heading: "Сейчас", lines: ["~89.5 KGS (НБКР)"] }], next_steps: [] }),
        model: "claude-sonnet-4-6",
        usage: null,
        configured: true,
        stopReason: "end_turn",
      };
    },
  };

  try {
    const answer = await answerCompanyAssistant({
      store,
      telegramUserId: "8859688650",
      question: "найди в интернете курс доллара",
      claudeClient,
      kickidlerClient: null,
      bitrixClient: null,
      platrumClient: null,
      googleOAuthService: null,
    });
    assert.equal(researchCalled, true);
    assert.match(answer.html, /Курс доллара/u);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test("no web research for non-internet questions", async () => {
  const state = createInitialState();
  const actor = state.users.find((u) => u.id === "u-nikolay");
  actor.telegram = { telegramUserId: "8859688650" };
  const file = path.join(os.tmpdir(), `web-research2-${Date.now()}.json`);
  const store = new JsonStore(file, () => state);

  let researchCalled = false;
  const claudeClient = {
    configured: true,
    async researchWeb() {
      researchCalled = true;
      return { text: "x", sources: [], configured: true };
    },
    async complete() {
      return { text: JSON.stringify({ title: "ok", sections: [], next_steps: [] }), usage: null, configured: true, stopReason: "end_turn" };
    },
  };

  try {
    await answerCompanyAssistant({
      store,
      telegramUserId: "8859688650",
      question: "привет, как дела",
      claudeClient,
      kickidlerClient: null,
      bitrixClient: null,
      platrumClient: null,
      googleOAuthService: null,
    });
    assert.equal(researchCalled, false);
  } finally {
    await fs.rm(file, { force: true });
  }
});
