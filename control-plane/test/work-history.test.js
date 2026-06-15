import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { buildWorkHistoryReport, parseHistoryPeriod, isWorkHistoryRequest } from "../src/domain/work-history.js";
import { appendTimelineEvent } from "../src/domain/work-timeline.js";

async function tmpDataFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-"));
  return path.join(dir, "control-plane.json");
}

test("parseHistoryPeriod understands month, week, today, explicit month", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  assert.equal(parseHistoryPeriod("что делала за месяц", now).label, "за месяц");
  assert.equal(parseHistoryPeriod("история за неделю", now).label, "за неделю");
  assert.equal(parseHistoryPeriod("что сегодня делал", now).label, "сегодня");
  const june = parseHistoryPeriod("отчет за июнь", now);
  assert.equal(june.label, "июнь");
  assert.ok(june.from.startsWith("2026-06-01"));
});

test("isWorkHistoryRequest detects history questions", () => {
  assert.equal(isWorkHistoryRequest("что Бегайым делала за месяц"), true);
  assert.equal(isWorkHistoryRequest("дай историю работы"), true);
  assert.equal(isWorkHistoryRequest("открой хром"), false);
});

test("buildWorkHistoryReport aggregates timeline into report", async () => {
  const dataFilePath = await tmpDataFile();
  const user = { id: "u-pm-1", displayName: "Бегайым", role: "PM" };
  await appendTimelineEvent({ dataFilePath, userId: user.id, event: { ts: "2026-06-10T09:00:00Z", kind: "task_completed", title: "Закрыла лендинг", links: { projectIds: ["p1"] } } });
  await appendTimelineEvent({ dataFilePath, userId: user.id, event: { ts: "2026-06-10T15:00:00Z", kind: "dialog_question", title: "вопрос" } });
  await appendTimelineEvent({ dataFilePath, userId: user.id, event: { ts: "2026-06-12T10:00:00Z", kind: "task_assigned", title: "Поставила задачу Дани", links: { userIds: ["u-dani"] } } });
  await appendTimelineEvent({ dataFilePath, userId: user.id, event: { ts: "2026-05-01T10:00:00Z", kind: "note", title: "вне периода" } });

  const report = await buildWorkHistoryReport({
    dataFilePath,
    user,
    from: "2026-06-01T00:00:00Z",
    to: "2026-06-30T23:59:59Z",
  });

  assert.equal(report.totals.tasksCompleted, 1);
  assert.equal(report.totals.tasksAssigned, 1);
  assert.equal(report.totals.activeDays, 2);
  assert.equal(report.totals.events, 3); // May event excluded
  assert.ok(report.projectIds.includes("p1"));
  assert.equal(report.days.length, 2);
});
