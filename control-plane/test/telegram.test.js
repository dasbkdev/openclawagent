import assert from "node:assert/strict";
import test from "node:test";
import { MockBitrixClient } from "../src/connectors/bitrix-client.js";
import { MockKickidlerClient } from "../src/connectors/kickidler-client.js";
import { createInviteCode } from "../src/domain/invite-codes.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";
import { parseTelegramCommand, resolveReportPeriod } from "../src/telegram/commands.js";
import { handleTelegramMessage } from "../src/telegram/handler.js";

test("parseTelegramCommand strips bot username and args", () => {
  assert.deepEqual(parseTelegramCommand("/report@company_bot week"), {
    name: "report",
    args: ["week"],
    raw: "/report@company_bot week",
  });
});

test("resolveReportPeriod supports week", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const period = resolveReportPeriod("week", now);
  assert.equal(period.to, "2026-06-02T12:00:00.000Z");
  assert.equal(period.from, "2026-05-26T12:00:00.000Z");
});

test("Telegram handler registers user and answers project/bitrix commands", async () => {
  const state = createInitialState();
  const owner = getUserById(state, "u-nikolay");
  const { code } = createInviteCode(state, {
    issuer: owner,
    userId: "u-pm-1",
    code: "TGPM1111",
  });
  const store = createMemoryStore(state);
  const telegram = createFakeTelegram();
  const deps = {
    store,
    telegram,
    kickidlerClient: new MockKickidlerClient(),
    bitrixClient: new MockBitrixClient(),
  };

  await handleTelegramMessage({
    ...deps,
    message: message({ text: `/register ${code}`, telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    ...deps,
    message: message({ text: "/projects", telegramUserId: 777, chatId: 10 }),
  });
  await handleTelegramMessage({
    ...deps,
    message: message({ text: "/bitrix project-alpha", telegramUserId: 777, chatId: 10 }),
  });

  assert.match(telegram.messages[0].text, /Registered: Project Manager 1/);
  assert.match(telegram.messages[1].text, /project-alpha/);
  assert.match(telegram.messages[2].text, /Bitrix project: Project Alpha/);
});

function createMemoryStore(state) {
  return {
    async load() {
      return state;
    },
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

function message({ text, telegramUserId, chatId }) {
  return {
    text,
    from: { id: telegramUserId, username: `u${telegramUserId}` },
    chat: { id: chatId },
  };
}
