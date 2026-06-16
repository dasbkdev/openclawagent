import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpPlatrumClient,
  MockPlatrumClient,
  assertReadOnlyPlatrumRequest,
  normalizePlatrumScheduleTemplate,
  normalizePlatrumWeeklyPlan,
  weekdayNameFromISO,
} from "../src/connectors/platrum-client.js";

test("weekdayNameFromISO returns the correct weekday (15 Jun 2026 is Monday)", () => {
  assert.equal(weekdayNameFromISO("2026-06-15"), "Пн");
  assert.equal(weekdayNameFromISO("2026-06-16"), "Вт");
  assert.equal(weekdayNameFromISO("2026-06-21"), "Вс");
  assert.equal(weekdayNameFromISO(""), null);
});

test("admin schedule-template endpoint is in the read-only allowlist", () => {
  const r = assertReadOnlyPlatrumRequest("GET", "/api/v1/work-schedules/admin/templates/");
  assert.equal(r.path, "/api/v1/work-schedules/admin/templates/");
  // write/delete on the schedule must stay blocked
  assert.throws(() => assertReadOnlyPlatrumRequest("POST", "/api/v1/work-schedules/admin/templates/"));
});

test("normalizePlatrumWeeklyPlan reads the dated days[] with mode and hours", () => {
  const plan = normalizePlatrumWeeklyPlan({
    id: 20,
    user: 26,
    username: "dasbkdev",
    user_name: "Мукумжанов Жакшылык",
    week_start: "2026-06-15",
    office_hours: 40,
    online_hours: 0,
    status: "approved",
    status_label: "Утверждён",
    admin_comment: "ok",
    days: [
      { date: "2026-06-15", start_time: "09:00", end_time: "18:00", mode: "office", lunch_start: "13:00", lunch_end: "14:00", segments: [{ mode: "office", start: "09:00", end: "18:00" }] },
      { date: "2026-06-21", mode: "off", is_off: true, start_time: "", end_time: "" },
    ],
    days_plan: [{ date: "should-be-ignored" }],
  });
  assert.equal(plan.userName, "Мукумжанов Жакшылык");
  assert.equal(plan.weekStart, "2026-06-15");
  assert.equal(plan.officeHours, 40);
  assert.equal(plan.statusLabel, "Утверждён");
  assert.equal(plan.days.length, 2);
  assert.equal(plan.days[0].dayName, "Пн");
  assert.equal(plan.days[1].dayName, "Вс");
  assert.equal(plan.days[0].mode, "office");
  assert.equal(plan.days[0].startTime, "09:00");
  assert.equal(plan.days[0].endTime, "18:00");
  assert.equal(plan.days[0].segments[0].endTime, "18:00");
  assert.equal(plan.days[1].isOff, true);
});

test("normalizePlatrumScheduleTemplate maps day_of_week to weekday plan", () => {
  const template = normalizePlatrumScheduleTemplate({
    id: 1,
    name: "Auto schedule aisyy",
    is_default: true,
    is_active: true,
    users_count: 3,
    days_plan: [
      { day_of_week: 1, mode: "office", is_off: false, start: "09:00", end: "21:00" },
      { day_of_week: 6, mode: "off", is_off: true, start: "", end: "" },
    ],
  });
  assert.equal(template.name, "Auto schedule aisyy");
  assert.equal(template.isDefault, true);
  assert.equal(template.usersCount, 3);
  assert.equal(template.days[0].dayOfWeek, 1);
  assert.equal(template.days[0].dayName, "Пн");
  assert.equal(template.days[0].startTime, "09:00");
  assert.equal(template.days[0].endTime, "21:00");
  assert.equal(template.days[1].dayName, "Сб");
  assert.equal(template.days[1].isOff, true);
});

test("getScheduleTemplates hits the admin templates endpoint and normalizes", async () => {
  const client = new HttpPlatrumClient({ baseUrl: "https://example.test", username: "u", password: "p" });
  client.requestJson = async (path) => {
    assert.equal(path, "/api/v1/work-schedules/admin/templates/");
    return [{ id: 1, name: "T", is_active: true, days_plan: [{ day_of_week: 3, mode: "online", start: "10:00", end: "19:00" }] }];
  };
  const result = await client.getScheduleTemplates();
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].days[0].dayName, "Ср");
  assert.equal(result.templates[0].days[0].mode, "online");
});

test("MockPlatrumClient schedule methods are safe no-ops", async () => {
  const mock = new MockPlatrumClient();
  assert.deepEqual((await mock.getScheduleTemplates()).templates, []);
  assert.deepEqual((await mock.getAdminWeeklyPlans()).plans, []);
});
