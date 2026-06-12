import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildAssistantMemoryContextV2,
  drainEvictedMemoryEvents,
  recordAssistantMemoryEvent,
} from "../src/domain/assistant-memory.js";
import { upsertAssistantFact } from "../src/domain/assistant-facts.js";
import { openAssistantLoop } from "../src/domain/assistant-open-loops.js";
import { appendMemoryArchive } from "../src/infra/memory-archive.js";

test("per-user cap evicts oldest events and stages them for archive", () => {
  const state = {};
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  for (let i = 0; i < 2005; i += 1) {
    recordAssistantMemoryEvent(state, {
      userId: "u-a",
      role: "user",
      text: `event ${i}`,
      now: new Date(base + i * 1000),
    });
  }
  // Another user's events are unaffected by u-a's cap.
  recordAssistantMemoryEvent(state, { userId: "u-b", role: "user", text: "b1", now: new Date(base) });

  const userAEvents = state.assistantMemory.filter((event) => event.userId === "u-a");
  assert.equal(userAEvents.length, 2000);
  assert.ok(state.assistantMemory.some((event) => event.userId === "u-b"));

  const evicted = drainEvictedMemoryEvents(state);
  assert.equal(evicted.length, 5);
  assert.equal(evicted[0].text, "event 0");
  // Drain clears the buffer.
  assert.equal(drainEvictedMemoryEvents(state).length, 0);
});

test("V2 context aggregates facts, loops, recent and related events plus archive", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-v2-"));
  const dataFilePath = path.join(dir, "control-plane.json");

  const state = {};
  upsertAssistantFact(state, { userId: "u-a", category: "preference", text: "любит утренние созвоны" });
  openAssistantLoop(state, { userId: "u-a", kind: "promise", text: "прислать отчёт" });

  recordAssistantMemoryEvent(state, {
    userId: "u-a",
    role: "user",
    text: "обычное недавнее сообщение",
    now: new Date("2026-06-10T10:00:00Z"),
  });
  recordAssistantMemoryEvent(state, {
    userId: "u-a",
    role: "user",
    text: "вопрос про проект альфа дедлайн",
    now: new Date("2026-06-09T10:00:00Z"),
  });

  await appendMemoryArchive({
    dataFilePath,
    userId: "u-a",
    events: [
      {
        id: "arch-1",
        userId: "u-a",
        role: "user",
        kind: "assistant_question",
        text: "старое обсуждение проекта альфа",
        createdAt: "2026-05-01T10:00:00Z",
      },
    ],
  });

  const context = await buildAssistantMemoryContextV2(state, {
    actor: { id: "u-a" },
    targetUsers: [],
    question: "что там по проекту альфа?",
    dataFilePath,
    limits: { recentEvents: 1 },
  });

  assert.equal(context.facts.length, 1);
  assert.equal(context.openLoops.length, 1);
  assert.equal(context.recentEvents.length, 1);
  assert.equal(context.recentEvents[0].text, "обычное недавнее сообщение");
  assert.ok(context.relatedEvents.length >= 1);
  // Related includes the journal hit and may include the archived hit.
  assert.ok(context.relatedEvents.some((event) => event.source === "journal"));
  assert.ok(context.relatedEvents.some((event) => event.source === "archive"));
});
