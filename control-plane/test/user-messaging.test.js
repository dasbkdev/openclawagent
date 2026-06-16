import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRelayIntent,
  resolveMessageRecipient,
  splitRecipientAndBody,
  canBroadcast,
  listBroadcastRecipients,
  setPendingBroadcast,
  takePendingBroadcast,
  isAffirmative,
  isNegative,
} from "../src/domain/user-messaging.js";

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
