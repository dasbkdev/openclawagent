import test from "node:test";
import assert from "node:assert/strict";
import { buildXlsxBuffer } from "../src/domain/xlsx-write.js";
import { extractXlsxText } from "../src/domain/xlsx-text.js";
import {
  recordVoiceActivity,
  listVoiceActivity,
  buildVoiceTimelineRows,
  buildVoiceTimelineXlsx,
} from "../src/domain/voice-timeline.js";
import { parseExtraction, extractVoiceActivity } from "../src/assistant/voice-extract.js";
import { createInitialState } from "../src/infra/seed.js";
import { getUserById } from "../src/domain/policy.js";

test("xlsx writer round-trips through the reader (Cyrillic ok)", () => {
  const buf = buildXlsxBuffer({ sheets: [{ name: "Отчёт", rows: [["Имя", "Время"], ["Максат", "12:05"]] }] });
  const text = extractXlsxText(buf);
  assert.match(text, /Имя\tВремя/u);
  assert.match(text, /Максат\t12:05/u);
});

test("voice timeline records and pairs start/end into an interval", () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  const u = "u-maksat";
  const start = recordVoiceActivity(state, {
    userId: u,
    arrivalAt: new Date("2026-06-23T06:00:00Z"), // 12:00 Bishkek
    extracted: { statedTime: "12:00", kind: "начало", activity: "встреча с Бегайым", relatedPerson: "Бегайым" },
    transcript: "12:00 начинаю встречу с Бегайым",
  });
  // a task received in between
  recordVoiceActivity(state, {
    userId: u,
    arrivalAt: new Date("2026-06-23T06:10:00Z"),
    extracted: { statedTime: "12:10", kind: "задание", activity: "купить технику для офиса", relatedPerson: "Николай" },
    transcript: "Николай поручил купить технику",
  });
  const end = recordVoiceActivity(state, {
    userId: u,
    arrivalAt: new Date("2026-06-23T06:30:00Z"), // 12:30 Bishkek
    extracted: { statedTime: "12:30", kind: "конец", activity: "встреча с Бегайым", relatedPerson: "Бегайым" },
    transcript: "12:30 закончил встречу с Бегайым",
  });

  assert.equal(end.linkedStartId, start.id);
  assert.equal(end.durationMinutes, 30);
  assert.equal(start.durationMinutes, 30);
  assert.equal(listVoiceActivity(state, { userIds: [u] }).length, 3);
});

test("report rows include name, both times, kind, duration, full text", () => {
  const state = createInitialState({ BOOTSTRAP_OWNER_TELEGRAM_ID: "999" });
  recordVoiceActivity(state, {
    userId: "u-maksat",
    arrivalAt: new Date("2026-06-23T06:06:00Z"),
    extracted: { statedTime: "12:05", kind: "начало", activity: "встреча с Бегайым" },
    transcript: "12:05 начинаю встречу с Бегайым",
  });
  const rows = buildVoiceTimelineRows(state, listVoiceActivity(state, {}));
  assert.deepEqual(rows[0].slice(0, 5), ["Сотрудник", "Дата", "Названное время", "Факт. время записи", "Тип"]);
  const r = rows[1];
  assert.equal(r[0], getUserById(state, "u-maksat").displayName);
  assert.equal(r[2], "12:05");          // stated
  assert.equal(r[3], "12:06");          // actual arrival (Bishkek)
  assert.equal(r[4], "начало");
  assert.match(r[8], /Бегайым/u);       // full transcript

  // and the whole xlsx builds + reads back
  const buf = buildVoiceTimelineXlsx(state, {});
  assert.match(extractXlsxText(buf), /12:05/u);
});

test("parseExtraction reads structured JSON; fallback when no model", () => {
  const p = parseExtraction('тут {"statedTime":"12:05","kind":"начало","activity":"встреча","relatedPerson":"Бегайым","isQuestion":false} конец');
  assert.equal(p.statedTime, "12:05");
  assert.equal(p.kind, "начало");
  assert.equal(p.relatedPerson, "Бегайым");
});

test("extractVoiceActivity falls back without a model (keyword + leading time)", async () => {
  const res = await extractVoiceActivity({ claudeClient: null, transcript: "12:30 закончил встречу с Бегайым" });
  assert.equal(res.kind, "конец");
  assert.equal(res.statedTime, "12:30");
});
