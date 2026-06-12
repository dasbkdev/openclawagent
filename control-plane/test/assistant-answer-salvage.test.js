import test from "node:test";
import assert from "node:assert/strict";
import { renderAssistantCompletion } from "../src/assistant/company-assistant.js";

const FULL_ANSWER = JSON.stringify({
  title: "Сводка по Бегайым",
  sections: [
    { heading: "Коротко", lines: ["Все в порядке", "Блокеров нет"] },
    { heading: "Задачи", lines: ["Всего: 3", "Просрочено: 0"] },
  ],
  next_steps: ["Проверить отчет вечером"],
});

test("valid structured JSON renders to HTML blocks", () => {
  const result = renderAssistantCompletion(FULL_ANSWER);
  assert.ok(result.html.includes("<b>Сводка по Бегайым</b>"));
  assert.ok(result.html.includes("Блокеров нет"));
  assert.ok(result.html.includes("Следующие шаги"));
  assert.ok(!result.plainText.includes("{"));
  assert.ok(!result.html.includes("&quot;title&quot;"));
});

test("JSON truncated mid-string is repaired and rendered", () => {
  const truncated = FULL_ANSWER.slice(0, FULL_ANSWER.indexOf("Просрочено") + 6);
  const result = renderAssistantCompletion(truncated, { truncated: true });
  assert.ok(result.html.includes("<b>Сводка по Бегайым</b>"), `html was: ${result.html}`);
  assert.ok(result.html.includes("Все в порядке"));
  assert.ok(!result.html.includes("&quot;title&quot;"));
  assert.ok(!result.plainText.trim().startsWith("{"));
  assert.ok(result.plainText.includes("сокращён"));
});

test("JSON truncated after a key separator is repaired", () => {
  const cut = FULL_ANSWER.indexOf('"lines"', FULL_ANSWER.indexOf("Задачи")) + '"lines"'.length + 1;
  const truncated = FULL_ANSWER.slice(0, cut);
  const result = renderAssistantCompletion(truncated);
  assert.ok(result.html.includes("<b>Сводка по Бегайым</b>"), `html was: ${result.html}`);
  assert.ok(!result.html.includes("&quot;"));
});

test("unrepairable JSON-looking text never reaches the user raw", () => {
  const garbage = '{"title": "Отчет", "sections": [{"heading": невалидно сразу {{{';
  const result = renderAssistantCompletion(garbage);
  assert.ok(!result.plainText.trim().startsWith("{"), `plainText was: ${result.plainText}`);
  assert.ok(!result.html.includes("&quot;title&quot;"), `html was: ${result.html}`);
  assert.ok(result.plainText.length > 0);
});

test("plain prose still falls back to markdown conversion", () => {
  const prose = "Все хорошо.\n\n**Важно**: завтра отчет.";
  const result = renderAssistantCompletion(prose);
  assert.ok(result.html.includes("<b>Важно</b>"));
  assert.equal(result.plainText, prose);
});

test("truncation note is appended to prose answers", () => {
  const result = renderAssistantCompletion("Короткий ответ", { truncated: true });
  assert.ok(result.plainText.includes("сокращён"));
  assert.ok(result.html.includes("сокращён"));
});
