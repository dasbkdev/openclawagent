import assert from "node:assert/strict";
import test from "node:test";
import { recordTokenUsageEvent } from "../src/domain/token-usage.js";
import { createInitialState } from "../src/infra/seed.js";
import { sendDueTokenUsageReports } from "../src/telegram/token-usage-reporter.js";

test("token usage reporter sends due daily report only to configured Telegram id", async () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const state = createInitialState({ TOKEN_USAGE_REPORT_TELEGRAM_ID: "984834133" });
  state.tokenReportSchedule.startedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

  recordTokenUsageEvent(state, {
    occurredAt: "2026-06-02T10:00:00Z",
    userId: "u-nikolay",
    action: "coding",
    model: "anthropic/claude-sonnet-4-6",
    inputTokens: 500,
    outputTokens: 100,
  });

  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const sent = await sendDueTokenUsageReports({
    store,
    telegram,
    recipientTelegramId: "984834133",
    now,
  });

  assert.deepEqual(sent, [{ key: "daily", recipientTelegramId: "984834133" }]);
  assert.equal(telegram.messages.length, 1);
  assert.equal(telegram.messages[0].chatId, "984834133");
  assert.match(telegram.messages[0].text, /Token usage report/);
  assert.match(telegram.messages[0].text, /coding/);
  assert.equal(state.tokenReportSchedule.daily.lastSentAt, now.toISOString());
});

function createMemoryStore(state) {
  return {
    async update(mutator) {
      return await mutator(state);
    },
  };
}

function createFakeTelegram() {
  return {
    messages: [],
    async sendMessage(messageToSend) {
      this.messages.push(messageToSend);
    },
  };
}
