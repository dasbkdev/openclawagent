import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, parseIntent, intentClassifierEnabled } from "../src/domain/intent-classifier.js";

test("intentClassifierEnabled is off unless explicitly enabled", () => {
  assert.equal(intentClassifierEnabled({}), false);
  assert.equal(intentClassifierEnabled({ INTENT_CLASSIFIER_ENABLED: "false" }), false);
  assert.equal(intentClassifierEnabled({ INTENT_CLASSIFIER_ENABLED: "true" }), true);
});

test("parseIntent extracts {intent, canonical}; question/other have empty canonical", () => {
  assert.deepEqual(
    parseIntent('{"intent":"relay","canonical":"сообщи Бегайым я опоздаю"}'),
    { intent: "relay", canonical: "сообщи Бегайым я опоздаю" },
  );
  assert.deepEqual(parseIntent('текст {"intent":"question","canonical":"x"} хвост'), { intent: "question", canonical: "" });
  assert.deepEqual(parseIntent('{"intent":"weird"}'), { intent: "other", canonical: "" });
  assert.equal(parseIntent("no json"), null);
});

test("classifyIntent returns null when disabled or claude not configured", async () => {
  const claude = { configured: true, async complete() { return { text: '{"intent":"relay","canonical":"сообщи A b"}' }; } };
  assert.equal(await classifyIntent({ claudeClient: claude, text: "x", env: {} }), null); // disabled
  assert.equal(
    await classifyIntent({ claudeClient: { configured: false }, text: "x", env: { INTENT_CLASSIFIER_ENABLED: "true" } }),
    null,
  );
});

test("classifyIntent normalizes a messy relay phrase when enabled", async () => {
  const claude = {
    configured: true,
    async complete() {
      return { text: '{"intent":"relay","canonical":"сообщи Бегайым что я опоздаю"}' };
    },
  };
  const result = await classifyIntent({
    claudeClient: claude,
    text: "слушай скинь-ка бегайым что опаздываю",
    users: [{ displayName: "Бегайым", telegram: { telegramUserId: "200" } }],
    env: { INTENT_CLASSIFIER_ENABLED: "true" },
  });
  assert.equal(result.intent, "relay");
  assert.match(result.canonical, /^сообщи Бегайым/u);
});
