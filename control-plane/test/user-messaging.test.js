import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRelayIntent,
  resolveMessageRecipient,
  splitRecipientAndBody,
  isReferenceBody,
  leadsWithConfirm,
  setPendingRelay,
  peekPendingRelay,
  takePendingRelay,
  canBroadcast,
  listBroadcastRecipients,
  setPendingBroadcast,
  takePendingBroadcast,
  isAffirmative,
  isNegative,
} from "../src/domain/user-messaging.js";
import { readLastAssistantAnswer, readLastUserQuestion } from "../src/domain/assistant-memory.js";

test("readLastUserQuestion returns the most recent real question", () => {
  const state = {
    assistantMemory: [
      { userId: "u-nikolay", role: "user", kind: "assistant_question", text: "старый вопрос", createdAt: "2026-06-18T10:00:00Z" },
      { userId: "u-nikolay", role: "assistant", kind: "assistant_answer", text: "ответ", createdAt: "2026-06-18T10:01:00Z" },
      { userId: "u-nikolay", role: "user", kind: "assistant_question", text: "как дела у Бегайым?", createdAt: "2026-06-18T10:55:00Z" },
      { userId: "u-nikolay", role: "user", kind: "user_message_relay", text: "отправь X", createdAt: "2026-06-18T11:00:00Z" },
    ],
  };
  assert.equal(readLastUserQuestion(state, "u-nikolay"), "как дела у Бегайым?");
  assert.equal(readLastUserQuestion({ assistantMemory: [] }, "u-nikolay"), null);
});

test("cleanDraftForRelay strips next-steps tail and 'подробнее' footer", async () => {
  const { cleanDraftForRelay } = await import("../src/domain/user-messaging.js");
  const draft = "Вопросы Бегайым\n\nВопрос 1\nВопрос 2\n\nСледующие шаги\n- уточни X\n\n💬 Если нужен подробный ответ — напишите «подробнее».";
  assert.equal(cleanDraftForRelay(draft), "Вопросы Бегайым\n\nВопрос 1\nВопрос 2");
});

test("pending assign is staged, consumed once, and expires", async () => {
  const { setPendingAssign, peekPendingAssign, takePendingAssign } = await import("../src/domain/user-messaging.js");
  const state = {};
  const now = new Date("2026-06-22T10:00:00Z");
  setPendingAssign(state, "100", { recipientId: "u-pm-1", recipientName: "Бегайым", items: ["позвонить клиенту"] }, now);
  assert.equal(peekPendingAssign(state, "100").recipientId, "u-pm-1");
  assert.deepEqual(takePendingAssign(state, "100", now).items, ["позвонить клиенту"]);
  assert.equal(peekPendingAssign(state, "100"), null);
  setPendingAssign(state, "100", { recipientId: "u-pm-1", items: ["x"] }, now);
  assert.equal(takePendingAssign(state, "100", new Date(now.getTime() + 6 * 60 * 1000)), null);
});

test("leadsWithConfirm detects an explicit leading confirmation", () => {
  assert.equal(leadsWithConfirm("Подтверждаю отправь бегайым"), true);
  assert.equal(leadsWithConfirm("да отправь Бегайым"), true);
  assert.equal(leadsWithConfirm("отправь это Бегайым"), false);
});

test("parseRelayIntent treats 'Подтверждаю отправь Имя' as a relay (lead-in stripped)", () => {
  const intent = parseRelayIntent("Подтверждаю отправь бегайым");
  assert.equal(intent?.kind, "relay");
  assert.match(intent.remainder, /бегайым/iu);
});

test("pending relay draft is staged, consumed once, and expires", () => {
  const state = {};
  const now = new Date("2026-06-18T12:00:00Z");
  setPendingRelay(state, "100", { recipientId: "u-begaiym", recipientName: "Бегайым", body: "вопросы по проекту" }, now);
  assert.equal(peekPendingRelay(state, "100").recipientId, "u-begaiym");
  const taken = takePendingRelay(state, "100", now);
  assert.equal(taken.body, "вопросы по проекту");
  assert.equal(peekPendingRelay(state, "100"), null); // consumed
  // expiry
  setPendingRelay(state, "100", { recipientId: "u-begaiym", body: "x" }, now);
  assert.equal(takePendingRelay(state, "100", new Date(now.getTime() + 6 * 60 * 1000)), null);
});

test("readLastAssistantAnswer returns the most recent assistant text", () => {
  const state = {
    assistantMemory: [
      { userId: "u-nikolay", role: "assistant", text: "старый ответ", createdAt: "2026-06-18T10:00:00Z" },
      { userId: "u-nikolay", role: "user", text: "вопрос", createdAt: "2026-06-18T10:30:00Z" },
      { userId: "u-nikolay", role: "assistant", text: "вопросы: 1, 2, 3", createdAt: "2026-06-18T10:55:00Z" },
      { userId: "u-maksat", role: "assistant", text: "чужое", createdAt: "2026-06-18T11:00:00Z" },
    ],
  };
  assert.equal(readLastAssistantAnswer(state, "u-nikolay"), "вопросы: 1, 2, 3");
  assert.equal(readLastAssistantAnswer({ assistantMemory: [] }, "u-nikolay"), null);
});

test("parseRelayIntent strips conversational lead-ins before the verb", () => {
  // "Молодец и теперь отправь …" — verb not at the very start
  const i1 = parseRelayIntent("Молодец и теперь отправь Бегайым привет");
  assert.equal(i1?.kind, "relay");
  assert.match(i1.remainder, /^Бегайым/u);
  const i2 = parseRelayIntent("ок, напиши Айзирек про отчёт");
  assert.equal(i2?.kind, "relay");
});

test("splitRecipientAndBody finds the recipient mid-sentence", () => {
  const state = sampleState();
  const intent = parseRelayIntent("отправь свои вопросы по проекту Бегайым и попроси чтобы ответила");
  const { res } = splitRecipientAndBody(state, intent.remainder);
  assert.equal(res.status, "ok");
  assert.equal(res.user.id, "u-begaiym");
});

test("splitRecipientAndBody handles the 'Имя: текст' form (with punctuation)", () => {
  const state = sampleState();
  const a = splitRecipientAndBody(state, "Бегайым: завтра собрание в 13:00");
  assert.equal(a.res.status, "ok");
  assert.equal(a.body, "завтра собрание в 13:00");
  const b = splitRecipientAndBody(state, "Бегайым, привет"); // trailing punctuation on name
  assert.equal(b.res.status, "ok");
});

test("isReferenceBody flags pointer-only bodies, keeps literal text", () => {
  assert.equal(isReferenceBody(""), true);
  assert.equal(isReferenceBody("это сообщение"), true);
  assert.equal(isReferenceBody("свои вопросы по проекту и попроси ответить"), true);
  assert.equal(isReferenceBody("все задачи завершены"), false);
  assert.equal(isReferenceBody("завтра собрание в 13:00"), false);
  assert.equal(isReferenceBody("Это важно: приходи к 10"), false); // colon = literal
});

function sampleState() {
  return {
    users: [
      { id: "u-nikolay", displayName: "Николай", role: "OWNER", telegram: { telegramUserId: "100", firstName: "Николай" } },
      { id: "u-begaiym", displayName: "Бегайым", role: "PM", platrumUsername: "begaiym", telegram: { telegramUserId: "200", firstName: "Бегайым", lastName: "Ниязбекова" } },
      { id: "u-maksat", displayName: "Максат", role: "SENIOR_PM", telegram: { telegramUserId: "300", firstName: "Максат" } },
      { id: "u-nur", displayName: "Нур", role: "PM", telegram: null }, // not linked
    ],
  };
}

test("parseRelayIntent detects a relay and strips the verb", () => {
  const intent = parseRelayIntent("Сообщи Бегайым что будет собрание в 14:00");
  assert.equal(intent.kind, "relay");
  assert.equal(intent.remainder, "Бегайым что будет собрание в 14:00");
});

test("parseRelayIntent detects a broadcast", () => {
  assert.deepEqual(parseRelayIntent("Отправь всем что завтра выходной"), { kind: "broadcast", body: "завтра выходной" });
  assert.deepEqual(parseRelayIntent("сообщи всем сотрудникам собрание в 15:00"), { kind: "broadcast", body: "собрание в 15:00" });
  assert.equal(parseRelayIntent("какой план на сегодня"), null);
  assert.equal(parseRelayIntent("/start"), null);
});

test("parseRelayIntent strips a leading object for forwards", () => {
  const intent = parseRelayIntent("отправь это Бегайым");
  assert.equal(intent.kind, "relay");
  assert.equal(intent.remainder, "Бегайым");
});

test("splitRecipientAndBody resolves the name and keeps the body", () => {
  const state = sampleState();
  const { res, body } = splitRecipientAndBody(state, "Бегайым что будет собрание в 14:00");
  assert.equal(res.status, "ok");
  assert.equal(res.user.id, "u-begaiym");
  assert.equal(body, "будет собрание в 14:00");
});

test("parseRelayIntent strips filler words and supports more verbs", () => {
  assert.equal(
    parseRelayIntent("отправь сообщение агенту Бегайым о том что завтра собрание в 13:00").remainder,
    "Бегайым о том что завтра собрание в 13:00",
  );
  assert.equal(parseRelayIntent("уведоми Бегайым что завтра собрание").kind, "relay");
  assert.equal(parseRelayIntent("напомни Айзирек про отчёт").kind, "relay");
  assert.equal(parseRelayIntent("напиши сотруднику Перизат привет").remainder.startsWith("Перизат"), true);
});

test("full meeting relay: filler + connector stripped, body is clean", () => {
  const state = sampleState();
  const intent = parseRelayIntent("отправь сообщение агенту Бегайым о том что завтра собрание в 13:00");
  const { res, body } = splitRecipientAndBody(state, intent.remainder);
  assert.equal(res.status, "ok");
  assert.equal(res.user.id, "u-begaiym");
  assert.equal(body, "завтра собрание в 13:00");
});

test("resolveMessageRecipient reports not linked and not found", () => {
  const state = sampleState();
  assert.equal(resolveMessageRecipient(state, "Нур").status, "not_linked");
  assert.equal(resolveMessageRecipient(state, "Кто-то").status, "not_found");
  assert.equal(resolveMessageRecipient(state, "begaiym").status, "ok"); // by platrum username
});

test("broadcast permission and recipient list", () => {
  const state = sampleState();
  assert.equal(canBroadcast({ role: "OWNER" }), true);
  assert.equal(canBroadcast({ role: "SENIOR_PM" }), true);
  assert.equal(canBroadcast({ role: "PM" }), false);
  // excludes the sender and unlinked users
  const recipients = listBroadcastRecipients(state, "100");
  assert.deepEqual(recipients.map((u) => u.id).sort(), ["u-begaiym", "u-maksat"]);
});

test("pending broadcast is consumed once and expires", () => {
  const state = {};
  const now = new Date("2026-06-16T10:00:00Z");
  setPendingBroadcast(state, "100", "привет всем", now);
  // expired after TTL
  const late = new Date("2026-06-16T10:10:00Z");
  assert.equal(takePendingBroadcast(state, "100", late), null);

  setPendingBroadcast(state, "100", "привет всем", now);
  const taken = takePendingBroadcast(state, "100", new Date("2026-06-16T10:01:00Z"));
  assert.equal(taken.body, "привет всем");
  // already consumed
  assert.equal(takePendingBroadcast(state, "100", new Date("2026-06-16T10:01:30Z")), null);
});

test("affirmative / negative detection", () => {
  assert.ok(isAffirmative("да"));
  assert.ok(isAffirmative("Отправляй"));
  assert.ok(isNegative("нет"));
  assert.ok(isNegative("отмена"));
  assert.equal(isAffirmative("да и ещё кое-что"), false); // not a bare yes
});
