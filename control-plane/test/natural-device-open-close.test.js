import test from "node:test";
import assert from "node:assert/strict";
import { parseNaturalDeviceAction } from "../src/domain/natural-device-actions.js";

test("opens any website by bare domain", () => {
  const a = parseNaturalDeviceAction("открой example.com");
  assert.equal(a.type, "open_url");
  assert.equal(a.args.url, "https://example.com");
  const b = parseNaturalDeviceAction("зайди на starlabit.com");
  assert.equal(b.type, "open_url");
  assert.match(b.args.url, /starlabit\.com/u);
});

test("opens known sites by name", () => {
  assert.equal(parseNaturalDeviceAction("открой фейсбук").args.url, "https://www.facebook.com");
  assert.equal(parseNaturalDeviceAction("открой инстаграм").args.url, "https://www.instagram.com");
  assert.match(parseNaturalDeviceAction("открой гмайл").args.url, /mail\.google/u);
});

test("opens 'сайт X' as a domain guess", () => {
  const a = parseNaturalDeviceAction("открой сайт wikipedia");
  assert.equal(a.type, "open_url");
  assert.match(a.args.url, /wikipedia/u);
});

test("closes any app by free-form name", () => {
  const a = parseNaturalDeviceAction("закрой Spotify");
  assert.equal(a.type, "close_app");
  assert.match(a.args.app, /spotify/iu);
  const b = parseNaturalDeviceAction("закрой приложение Postman");
  assert.equal(b.type, "close_app");
  assert.match(b.args.app, /postman/iu);
});

test("opens any app by free-form name", () => {
  const a = parseNaturalDeviceAction("открой Discord");
  assert.equal(a.type, "open_app");
  assert.match(a.args.app, /discord/iu);
});

test("known app alias still wins (Chrome)", () => {
  const a = parseNaturalDeviceAction("закрой хром");
  assert.equal(a.type, "close_app");
  assert.equal(a.args.app, "Google Chrome");
});

test("closes a browser tab via Ctrl+W", () => {
  const a = parseNaturalDeviceAction("закрой вкладку");
  assert.equal(a.type, "hotkey");
  assert.deepEqual(a.args.keys, ["ctrl", "w"]);
});

test("minimize active window and all windows", () => {
  assert.equal(parseNaturalDeviceAction("сверни окно").type, "minimize_window");
  assert.equal(parseNaturalDeviceAction("сверни все окна").type, "minimize_all");
  assert.equal(parseNaturalDeviceAction("сверни всё").type, "minimize_all");
});

test("does not hijack questions or chat", () => {
  assert.equal(parseNaturalDeviceAction("как дела"), null);
  assert.equal(parseNaturalDeviceAction("что ты умеешь?"), null);
  assert.equal(parseNaturalDeviceAction("расскажи про погоду"), null);
});
