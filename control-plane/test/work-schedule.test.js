import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDueScheduledAssistantMessages,
  deriveGoogleSchedule,
  findPlatrumSchedule,
} from "../src/domain/work-schedule.js";
import { getUserById } from "../src/domain/policy.js";
import { createInitialState } from "../src/infra/seed.js";

test("Platrum approved plan resolves an individual weekday schedule", () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const maksat = getUserById(state, "u-maksat");
  const schedule = findPlatrumSchedule(
    [
      {
        userId: 23,
        username: "max",
        status: "approved",
        updatedAt: "2026-06-10T10:00:00Z",
        days: [
          {
            date: "2026-06-11",
            startTime: "12:00",
            endTime: "21:00",
            mode: "office",
            segments: [],
          },
        ],
      },
    ],
    maksat,
    "2026-06-11",
  );

  assert.equal(schedule.startTime, "12:00");
  assert.equal(schedule.endTime, "21:00");
  assert.equal(schedule.source, "platrum");
  assert.equal(schedule.confidence, "high");
});

test("Google work schedule is derived from a matching shared calendar", () => {
  const schedule = deriveGoogleSchedule(
    {
      connected: true,
      calendar: { ok: true, data: { events: [] } },
      sharedCalendars: {
        ok: true,
        data: {
          calendars: [
            {
              events: {
                events: [
                  {
                    title: "Рабочая смена",
                    start: "2026-06-11T09:30:00+06:00",
                    end: "2026-06-11T18:30:00+06:00",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    { includePrimary: false, date: "2026-06-11" },
  );

  assert.equal(schedule.startTime, "09:30");
  assert.equal(schedule.endTime, "18:30");
  assert.equal(schedule.source, "google_calendar");
});

test("Morning prompt is sent ten minutes after the Platrum shift starts", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const client = {
    async getAdminWeeklyPlans() {
      return {
        configured: true,
        plans: [
          {
            userId: 25,
            username: "maslov",
            status: "approved",
            days: [
              {
                date: "2026-06-11",
                startTime: "09:00",
                endTime: "18:00",
                mode: "office",
                segments: [],
              },
            ],
          },
        ],
      };
    },
  };

  const first = await collectDueScheduledAssistantMessages(state, {
    now: new Date("2026-06-11T03:10:00.000Z"),
    platrumClient: client,
    googleOAuthService: null,
  });
  const second = await collectDueScheduledAssistantMessages(state, {
    now: new Date("2026-06-11T03:20:00.000Z"),
    platrumClient: client,
    googleOAuthService: null,
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].kind, "morning_prompt");
  assert.match(first[0].text, /09:00-18:00/u);
  assert.match(first[0].text, /черновик/u);
  assert.equal(second.length, 0);
});

test("Missing Platrum and Google schedule alerts only the developer once", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const platrumClient = {
    async getAdminWeeklyPlans() {
      return { configured: true, plans: [] };
    },
  };
  const googleOAuthService = {
    async readWorkspaceSnapshot() {
      return { connected: false };
    },
  };

  const first = await collectDueScheduledAssistantMessages(state, {
    now: new Date("2026-06-13T02:00:00.000Z"),
    platrumClient,
    googleOAuthService,
    developerTelegramId: "984834133",
  });
  const second = await collectDueScheduledAssistantMessages(state, {
    now: new Date("2026-06-13T02:10:00.000Z"),
    platrumClient,
    googleOAuthService,
    developerTelegramId: "984834133",
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].chatId, "984834133");
  assert.equal(first[0].kind, "schedule_missing_alert");
  assert.equal(second.length, 0);
});

test("Sunday never sends work prompts or missing schedule alerts", async () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const messages = await collectDueScheduledAssistantMessages(state, {
    now: new Date("2026-06-14T04:00:00.000Z"),
    platrumClient: null,
    googleOAuthService: null,
  });
  assert.deepEqual(messages, []);
});
