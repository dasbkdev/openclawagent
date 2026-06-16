import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNaturalPlanIntent,
  parseNaturalDoneIntent,
  matchPlanItemByPhrase,
  isGenericDoneReference,
} from "../src/domain/natural-plan-actions.js";

test("parseNaturalPlanIntent reads a numbered plan", () => {
  const intent = parseNaturalPlanIntent("План на сегодня\n1. Провести собрание\n2. Созвон с Жакшылыком\n3. Подтвердить график");
  assert.ok(intent);
  assert.equal(intent.kind, "create_plan");
  assert.deepEqual(intent.items, ["Провести собрание", "Созвон с Жакшылыком", "Подтвердить график"]);
});

test("parseNaturalPlanIntent reads inline plan after colon", () => {
  const intent = parseNaturalPlanIntent("мой план: закрыть отчёт; проверить канбан; написать клиенту");
  assert.ok(intent);
  assert.equal(intent.items.length, 3);
});

test("parseNaturalPlanIntent ignores a question about the plan", () => {
  assert.equal(parseNaturalPlanIntent("какой у меня план на сегодня?"), null);
  assert.equal(parseNaturalPlanIntent("покажи план"), null);
});

test("parseNaturalDoneIntent detects completion, not remaining", () => {
  assert.ok(parseNaturalDoneIntent("переговоры на 17:00 провели"));
  assert.ok(parseNaturalDoneIntent("я выполнил отчёт"));
  assert.equal(parseNaturalDoneIntent("всё сделал"), null); // remaining path
  assert.equal(parseNaturalDoneIntent("какой план"), null);
});

test("parseNaturalDoneIntent understands more completion words", () => {
  for (const phrase of [
    "собрание с командой завершена",
    "отчёт закрыт",
    "задачу сдал",
    "созвон провели",
    "доделал макет",
    "meeting done",
    "task closed",
  ]) {
    assert.ok(parseNaturalDoneIntent(phrase), `should detect: ${phrase}`);
  }
});

test("isGenericDoneReference: generic confirmations vs named subjects", () => {
  assert.equal(isGenericDoneReference("готово"), true);
  assert.equal(isGenericDoneReference("задачу закрыл"), true);
  assert.equal(isGenericDoneReference("сделал"), true);
  // names a subject -> not generic, must match a specific item
  assert.equal(isGenericDoneReference("собрание завершено"), false);
  assert.equal(isGenericDoneReference("отчёт сдал"), false);
});

test("matchPlanItemByPhrase matches by keyword and time", () => {
  const plan = {
    items: [
      { title: "Переговоры с клиентом на 17:00" },
      { title: "Созвон с Жакшылыком" },
      { title: "Подтвердить график сотрудников" },
    ],
  };
  const m1 = matchPlanItemByPhrase(plan, "переговоры на 17:00 провели");
  assert.equal(m1.index, 1);

  const m2 = matchPlanItemByPhrase(plan, "созвон с жакшылыком сделал");
  assert.equal(m2.index, 2);

  const m3 = matchPlanItemByPhrase(plan, "подтвердил график");
  assert.equal(m3.index, 3);

  assert.equal(matchPlanItemByPhrase(plan, "купил молоко"), null);
});
