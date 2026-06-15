// Pure validation / normalization logic for the browser service.
// IMPORTANT: this file MUST NOT import playwright or any heavy runtime.
// It is unit-tested on CI (Linux, no Chromium installed).

/** Default global task timeout in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 45_000;
/** Hard cap for a single task's global timeout. */
export const MAX_TIMEOUT_MS = 120_000;
/** Default per-step timeout in milliseconds. */
export const DEFAULT_STEP_TIMEOUT_MS = 15_000;
/** Max characters of extracted text returned to the caller (~20KB). */
export const MAX_TEXT_CHARS = 20_000;
/** Max base64 length of a screenshot returned to the caller (~3MB). */
export const MAX_SCREENSHOT_B64 = 3_000_000;
/** Max number of steps accepted in a single task. */
export const MAX_STEPS = 50;

/** Actions the service is allowed to perform. */
export const SUPPORTED_ACTIONS = Object.freeze([
  "goto",
  "click",
  "type",
  "press",
  "wait",
  "extract_text",
  "extract_links",
  "screenshot",
  "scroll",
  "select",
]);

/**
 * Returns true only for absolute http(s) URLs. Everything else
 * (file:, about:, data:, javascript:, relative, garbage) is rejected.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAllowedUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

function isPlainString(v) {
  return typeof v === "string" && v.length > 0;
}

function clampTimeout(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * Validate and normalize a single step. Throws Error with a clear message
 * if the step is malformed or uses an unsupported action.
 * @param {unknown} raw
 * @param {number} [index]
 * @returns {object} normalized step
 */
export function normalizeStep(raw, index = 0) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`step[${index}]: must be an object`);
  }
  const action = raw.action;
  if (!isPlainString(action)) {
    throw new Error(`step[${index}]: missing "action"`);
  }
  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new Error(`step[${index}]: unsupported action "${action}"`);
  }

  const step = { action };

  switch (action) {
    case "goto": {
      if (!isAllowedUrl(raw.url)) {
        throw new Error(
          `step[${index}]: goto requires an http(s) url, got "${raw.url}"`,
        );
      }
      step.url = String(raw.url).trim();
      break;
    }
    case "click": {
      // Either a CSS selector or visible text is required.
      if (isPlainString(raw.selector)) {
        step.selector = raw.selector;
      } else if (isPlainString(raw.text)) {
        step.text = raw.text;
      } else {
        throw new Error(`step[${index}]: click requires "selector" or "text"`);
      }
      break;
    }
    case "type": {
      if (!isPlainString(raw.selector)) {
        throw new Error(`step[${index}]: type requires "selector"`);
      }
      if (typeof raw.text !== "string") {
        throw new Error(`step[${index}]: type requires "text"`);
      }
      step.selector = raw.selector;
      step.text = raw.text;
      step.submit = raw.submit === true;
      break;
    }
    case "press": {
      if (!isPlainString(raw.key)) {
        throw new Error(`step[${index}]: press requires "key"`);
      }
      step.key = raw.key;
      break;
    }
    case "wait": {
      if (isPlainString(raw.selector)) {
        step.selector = raw.selector;
      } else if (raw.ms !== undefined) {
        const ms = Number(raw.ms);
        if (!Number.isFinite(ms) || ms < 0) {
          throw new Error(`step[${index}]: wait "ms" must be a non-negative number`);
        }
        step.ms = Math.min(Math.floor(ms), 30_000);
      } else {
        throw new Error(`step[${index}]: wait requires "ms" or "selector"`);
      }
      break;
    }
    case "extract_text": {
      if (raw.selector !== undefined) {
        if (!isPlainString(raw.selector)) {
          throw new Error(`step[${index}]: extract_text "selector" must be a non-empty string`);
        }
        step.selector = raw.selector;
      }
      break;
    }
    case "extract_links": {
      // no required args
      break;
    }
    case "screenshot": {
      step.fullPage = raw.fullPage === true;
      break;
    }
    case "scroll": {
      // direction: down | up | to (with selector)
      const dir = isPlainString(raw.direction) ? raw.direction : "down";
      if (!["down", "up", "to"].includes(dir)) {
        throw new Error(`step[${index}]: scroll "direction" must be down|up|to`);
      }
      step.direction = dir;
      if (dir === "to") {
        if (!isPlainString(raw.selector)) {
          throw new Error(`step[${index}]: scroll to requires "selector"`);
        }
        step.selector = raw.selector;
      } else if (raw.amount !== undefined) {
        const amt = Number(raw.amount);
        step.amount = Number.isFinite(amt) ? Math.floor(amt) : undefined;
      }
      break;
    }
    case "select": {
      if (!isPlainString(raw.selector)) {
        throw new Error(`step[${index}]: select requires "selector"`);
      }
      if (typeof raw.value !== "string") {
        throw new Error(`step[${index}]: select requires "value"`);
      }
      step.selector = raw.selector;
      step.value = raw.value;
      break;
    }
    default:
      // Should be unreachable due to the SUPPORTED_ACTIONS check above.
      throw new Error(`step[${index}]: unsupported action "${action}"`);
  }

  return step;
}

/**
 * Validate and normalize a full /browse/run request body.
 * Throws Error with a clear message if invalid.
 * @param {unknown} body
 * @returns {{url:(string|null), steps:object[], timeoutMs:number, stepTimeoutMs:number, returnText:boolean, screenshot:boolean}}
 */
export function validateBrowseRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be a JSON object");
  }

  // url is optional at the top level (you can also goto via a step),
  // but if provided it must be an http(s) url.
  let url = null;
  if (body.url !== undefined && body.url !== null && body.url !== "") {
    if (!isAllowedUrl(body.url)) {
      throw new Error(`"url" must be an http(s) url, got "${body.url}"`);
    }
    url = String(body.url).trim();
  }

  let rawSteps = body.steps;
  if (rawSteps === undefined || rawSteps === null) rawSteps = [];
  if (!Array.isArray(rawSteps)) {
    throw new Error('"steps" must be an array');
  }
  if (rawSteps.length > MAX_STEPS) {
    throw new Error(`too many steps (max ${MAX_STEPS})`);
  }

  const steps = rawSteps.map((s, i) => normalizeStep(s, i));

  if (url === null && steps.length === 0) {
    throw new Error('request needs a "url" or at least one step');
  }

  const timeoutMs = clampTimeout(body.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const stepTimeoutMs = clampTimeout(
    body.stepTimeoutMs,
    DEFAULT_STEP_TIMEOUT_MS,
    timeoutMs,
  );

  return {
    url,
    steps,
    timeoutMs,
    stepTimeoutMs,
    returnText: body.returnText === true,
    screenshot: body.screenshot === true,
  };
}

/**
 * Authentication check for incoming requests.
 *
 * - If BROWSER_SERVICE_TOKEN is configured (env), the X-Browser-Token header
 *   must match it exactly. Otherwise → unauthorized.
 * - If no token is configured, only loopback (127.0.0.1 / ::1) is allowed.
 *
 * @param {object} opts
 * @param {string|undefined} opts.token   configured token (env), may be empty/undefined
 * @param {string|undefined|null} opts.headerToken  value of X-Browser-Token header
 * @param {string|undefined|null} opts.remoteAddress  socket remote address
 * @returns {{ok:boolean, reason?:string}}
 */
export function checkBrowserAuth({ token, headerToken, remoteAddress }) {
  const configured = typeof token === "string" ? token.trim() : "";

  if (configured !== "") {
    if (typeof headerToken === "string" && safeEqual(headerToken, configured)) {
      return { ok: true };
    }
    return { ok: false, reason: "invalid or missing X-Browser-Token" };
  }

  // No token configured → only allow loopback.
  if (isLoopback(remoteAddress)) {
    return { ok: true };
  }
  return { ok: false, reason: "no token configured; non-loopback rejected" };
}

/** True if address is an IPv4/IPv6 loopback address. */
export function isLoopback(remoteAddress) {
  if (typeof remoteAddress !== "string" || remoteAddress === "") return false;
  // Node may report IPv4-mapped IPv6 like ::ffff:127.0.0.1
  const addr = remoteAddress.replace(/^::ffff:/, "");
  return addr === "127.0.0.1" || addr === "::1" || addr.startsWith("127.");
}

/** Constant-time-ish string comparison to avoid trivial timing leaks. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Truncate text to MAX_TEXT_CHARS, appending a marker if cut. */
export function truncateText(text, max = MAX_TEXT_CHARS) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n…[truncated]";
}
