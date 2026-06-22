import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNaturalPlanIntent,
  parseNaturalDoneIntent,
  matchPlanItemByPhrase,
  isGenericDoneReference,
  isReplacePlanIntent,
  parseAddToPlanIntent,
  parseDeletePlanIntent,
  parseAssignPlanIntent,
  stripAssignConnectors,
} from "../src/domain/natural-plan-actions.js";

test("parseAddToPlanIntent extracts items after the plan keyword", () => {
  assert.deepEqual(parseAddToPlanIntent("добавь в план дня: позвонить клиенту; проверить отчёт").items, ["позвонить клиенту", "проверить отчёт"]);
  assert.deepEqual(parseAddToPlanIntent("добавь к плану созвон с командой, написать письмо").items, ["созвон с командой", "написать письмо"]);
  // referenced earlier items, none inline -> empty (handler will ask)
  assert.deepEqual(parseAddToPlanIntent("добавь эти два пункта к плану дня").items, []);
  assert.equal(parseAddToPlanIntent("какой план"), null);
  assert.equal(parseAddToPlanIntent("добавь воды в чайник"), null); // no "план"
});

test("parseDeletePlanIntent: whole plan vs one item vs ignore", () => {
  assert.deepEqual(parseDeletePlanIntent("очисти план дня"), { kind: "clear_plan" });
  assert.deepEqual(parseDeletePlanIntent("удали весь план"), { kind: "clear_plan" });
  assert.deepEqual(parseDeletePlanIntent("удали план"), { kind: "clear_plan" });
  assert.equal(parseDeletePlanIntent("удали пункт собрание из плана").kind, "remove_item");
  assert.equal(parseDeletePlanIntent("убери собрание из плана дня").reference, "собрание");
  assert.equal(parseDeletePlanIntent("удали файл"), null); // not about the plan
});

test("isReplacePlanIntent: replace vs merge wording", () => {
  assert.ok(isReplacePlanIntent("новый план на сегодня: A; B"));
  assert.ok(isReplacePlanIntent("очисти план"));
  assert.ok(isReplacePlanIntent("план заново: X"));
  assert.equal(isReplacePlanIntent("план на сегодня: A; B"), false);
  assert.equal(isReplacePlanIntent("добавь C к плану"), false);
});

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

test("parseAssignPlanIntent detects assigning a plan item to someone", () => {
  assert.equal(parseAssignPlanIntent("поставь Бегайым задачу позвонить клиенту").kind, "assign_plan");
  assert.match(parseAssignPlanIntent("назначь Айзирек в план: проверить отчёт").remainder, /Айзирек/u);
  assert.equal(parseAssignPlanIntent("поставь чайник"), null); // no plan/task word
  assert.equal(parseAssignPlanIntent("какой план"), null);
});

test("stripAssignConnectors removes plan/task connector words", () => {
  assert.equal(stripAssignConnectors("задачу позвонить клиенту"), "позвонить клиенту");
  assert.equal(stripAssignConnectors("в план дня: проверить отчёт"), "проверить отчёт");
});
