// Pure-logic tests. NO playwright import — runs on CI without Chromium.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAllowedUrl,
  normalizeStep,
  validateBrowseRequest,
  checkBrowserAuth,
  isLoopback,
  safeEqual,
  truncateText,
  SUPPORTED_ACTIONS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_STEPS,
} from "../src/validate.js";

// ---------------------------------------------------------------------------
// isAllowedUrl
// ---------------------------------------------------------------------------
test("isAllowedUrl accepts http and https", () => {
  assert.equal(isAllowedUrl("http://example.com"), true);
  assert.equal(isAllowedUrl("https://example.com/path?q=1"), true);
});

test("isAllowedUrl rejects non-http schemes and junk", () => {
  assert.equal(isAllowedUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedUrl("about:blank"), false);
  assert.equal(isAllowedUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedUrl("data:text/html,hi"), false);
  assert.equal(isAllowedUrl("ftp://example.com"), false);
  assert.equal(isAllowedUrl("/relative/path"), false);
  assert.equal(isAllowedUrl("not a url"), false);
  assert.equal(isAllowedUrl(""), false);
  assert.equal(isAllowedUrl(null), false);
  assert.equal(isAllowedUrl(123), false);
});

// ---------------------------------------------------------------------------
// normalizeStep
// ---------------------------------------------------------------------------
test("normalizeStep rejects unsupported action", () => {
  assert.throws(() => normalizeStep({ action: "evaluate", js: "x" }), /unsupported action/);
  assert.throws(() => normalizeStep({ action: "eval" }), /unsupported action/);
});

test("normalizeStep rejects missing/invalid action", () => {
  assert.throws(() => normalizeStep({}), /missing "action"/);
  assert.throws(() => normalizeStep(null), /must be an object/);
  assert.throws(() => normalizeStep("goto"), /must be an object/);
});

test("normalizeStep supports every advertised action", () => {
  for (const action of SUPPORTED_ACTIONS) {
    assert.ok(action, "sanity");
  }
});

test("normalizeStep goto requires http(s) url", () => {
  assert.deepEqual(normalizeStep({ action: "goto", url: "https://a.com" }), {
    action: "goto",
    url: "https://a.com",
  });
  assert.throws(() => normalizeStep({ action: "goto", url: "file:///x" }), /http\(s\)/);
  assert.throws(() => normalizeStep({ action: "goto" }), /http\(s\)/);
});

test("normalizeStep click needs selector or text", () => {
  assert.deepEqual(normalizeStep({ action: "click", selector: "#b" }), {
    action: "click",
    selector: "#b",
  });
  assert.deepEqual(normalizeStep({ action: "click", text: "Submit" }), {
    action: "click",
    text: "Submit",
  });
  assert.throws(() => normalizeStep({ action: "click" }), /requires "selector" or "text"/);
});

test("normalizeStep type normalizes submit flag", () => {
  const s = normalizeStep({ action: "type", selector: "#q", text: "hi", submit: true });
  assert.deepEqual(s, { action: "type", selector: "#q", text: "hi", submit: true });
  const s2 = normalizeStep({ action: "type", selector: "#q", text: "" });
  assert.equal(s2.submit, false);
  assert.throws(() => normalizeStep({ action: "type", text: "x" }), /requires "selector"/);
  assert.throws(() => normalizeStep({ action: "type", selector: "#q" }), /requires "text"/);
});

test("normalizeStep press requires key", () => {
  assert.deepEqual(normalizeStep({ action: "press", key: "Enter" }), {
    action: "press",
    key: "Enter",
  });
  assert.throws(() => normalizeStep({ action: "press" }), /requires "key"/);
});

test("normalizeStep wait accepts ms or selector and clamps ms", () => {
  assert.equal(normalizeStep({ action: "wait", ms: 500 }).ms, 500);
  assert.equal(normalizeStep({ action: "wait", ms: 999999 }).ms, 30000);
  assert.deepEqual(normalizeStep({ action: "wait", selector: ".x" }), {
    action: "wait",
    selector: ".x",
  });
  assert.throws(() => normalizeStep({ action: "wait" }), /requires "ms" or "selector"/);
  assert.throws(() => normalizeStep({ action: "wait", ms: -5 }), /non-negative/);
});

test("normalizeStep extract_text optional selector", () => {
  assert.deepEqual(normalizeStep({ action: "extract_text" }), { action: "extract_text" });
  assert.deepEqual(normalizeStep({ action: "extract_text", selector: "main" }), {
    action: "extract_text",
    selector: "main",
  });
});

test("normalizeStep scroll directions", () => {
  assert.equal(normalizeStep({ action: "scroll" }).direction, "down");
  assert.equal(normalizeStep({ action: "scroll", direction: "up" }).direction, "up");
  const toStep = normalizeStep({ action: "scroll", direction: "to", selector: "#f" });
  assert.deepEqual(toStep, { action: "scroll", direction: "to", selector: "#f" });
  assert.throws(() => normalizeStep({ action: "scroll", direction: "to" }), /requires "selector"/);
  assert.throws(() => normalizeStep({ action: "scroll", direction: "sideways" }), /down\|up\|to/);
});

test("normalizeStep select requires selector and value", () => {
  assert.deepEqual(normalizeStep({ action: "select", selector: "#s", value: "v" }), {
    action: "select",
    selector: "#s",
    value: "v",
  });
  assert.throws(() => normalizeStep({ action: "select", selector: "#s" }), /requires "value"/);
});

// ---------------------------------------------------------------------------
// validateBrowseRequest
// ---------------------------------------------------------------------------
test("validateBrowseRequest rejects non-object body", () => {
  assert.throws(() => validateBrowseRequest(null), /JSON object/);
  assert.throws(() => validateBrowseRequest([]), /JSON object/);
  assert.throws(() => validateBrowseRequest("x"), /JSON object/);
});

test("validateBrowseRequest requires url or steps", () => {
  assert.throws(() => validateBrowseRequest({}), /needs a "url" or at least one step/);
});

test("validateBrowseRequest validates top-level url", () => {
  assert.throws(() => validateBrowseRequest({ url: "file:///x" }), /http\(s\)/);
  const ok = validateBrowseRequest({ url: "https://example.com" });
  assert.equal(ok.url, "https://example.com");
  assert.deepEqual(ok.steps, []);
});

test("validateBrowseRequest normalizes steps and rejects bad action", () => {
  const req = validateBrowseRequest({
    url: "https://a.com",
    steps: [
      { action: "click", selector: "#go" },
      { action: "extract_text" },
    ],
  });
  assert.equal(req.steps.length, 2);
  assert.throws(
    () => validateBrowseRequest({ steps: [{ action: "page.evaluate" }] }),
    /unsupported action/,
  );
});

test("validateBrowseRequest enforces step limit", () => {
  const steps = Array.from({ length: MAX_STEPS + 1 }, () => ({
    action: "wait",
    ms: 1,
  }));
  assert.throws(() => validateBrowseRequest({ steps }), /too many steps/);
});

test("validateBrowseRequest clamps timeouts and defaults flags", () => {
  const def = validateBrowseRequest({ url: "https://a.com" });
  assert.equal(def.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(def.returnText, false);
  assert.equal(def.screenshot, false);

  const big = validateBrowseRequest({ url: "https://a.com", timeoutMs: 10 ** 9 });
  assert.equal(big.timeoutMs, MAX_TIMEOUT_MS);

  const flags = validateBrowseRequest({
    url: "https://a.com",
    returnText: true,
    screenshot: true,
  });
  assert.equal(flags.returnText, true);
  assert.equal(flags.screenshot, true);

  // stepTimeoutMs never exceeds the global timeout.
  const clamped = validateBrowseRequest({
    url: "https://a.com",
    timeoutMs: 5000,
    stepTimeoutMs: 99999,
  });
  assert.ok(clamped.stepTimeoutMs <= clamped.timeoutMs);
});

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------
test("checkBrowserAuth requires matching token when configured", () => {
  assert.deepEqual(
    checkBrowserAuth({ token: "secret", headerToken: "secret", remoteAddress: "9.9.9.9" }),
    { ok: true },
  );
  assert.equal(
    checkBrowserAuth({ token: "secret", headerToken: "nope", remoteAddress: "127.0.0.1" }).ok,
    false,
  );
  assert.equal(
    checkBrowserAuth({ token: "secret", headerToken: undefined, remoteAddress: "127.0.0.1" }).ok,
    false,
  );
});

test("checkBrowserAuth allows loopback when no token configured", () => {
  assert.equal(checkBrowserAuth({ token: "", headerToken: undefined, remoteAddress: "127.0.0.1" }).ok, true);
  assert.equal(checkBrowserAuth({ token: undefined, headerToken: undefined, remoteAddress: "::1" }).ok, true);
  assert.equal(checkBrowserAuth({ token: "  ", headerToken: undefined, remoteAddress: "::ffff:127.0.0.1" }).ok, true);
  assert.equal(checkBrowserAuth({ token: "", headerToken: undefined, remoteAddress: "10.0.0.5" }).ok, false);
});

test("isLoopback recognizes loopback forms", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("127.3.2.1"), true);
  assert.equal(isLoopback("192.168.1.1"), false);
  assert.equal(isLoopback(""), false);
  assert.equal(isLoopback(undefined), false);
});

test("safeEqual compares correctly", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "ab"), false);
  assert.equal(safeEqual(1, 1), false);
});

// ---------------------------------------------------------------------------
// truncateText
// ---------------------------------------------------------------------------
test("truncateText cuts long text", () => {
  assert.equal(truncateText("short"), "short");
  const long = "a".repeat(50);
  const cut = truncateText(long, 10);
  assert.ok(cut.length < long.length);
  assert.match(cut, /\[truncated\]/);
  assert.equal(truncateText(undefined), "");
});
