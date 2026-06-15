// Playwright (Chromium) controller for the browser service.
// This module imports playwright and therefore is NOT loaded by unit tests.

import { chromium } from "playwright";
import {
  MAX_SCREENSHOT_B64,
  truncateText,
} from "./validate.js";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VIEWPORT = { width: 1366, height: 900 };

/** Singleton browser, lazily launched and reused across tasks. */
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
        ],
      })
      .catch((err) => {
        // Reset so a later request can retry the launch.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/** Gracefully close the shared browser (used on process shutdown). */
export async function closeBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      /* ignore */
    } finally {
      browserPromise = null;
    }
  }
}

/** Sleep helper that rejects if the signal aborts. */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Execute a sequence of steps in a single browser session.
 * Never throws for "task-level" problems — returns a structured result.
 *
 * @param {{url:(string|null), steps:object[], timeoutMs:number, stepTimeoutMs:number, returnText:boolean, screenshot:boolean}} task
 * @returns {Promise<object>}
 */
export async function runBrowserTask(task) {
  const {
    url,
    steps,
    timeoutMs,
    stepTimeoutMs,
    returnText,
    screenshot,
  } = task;

  const started = Date.now();
  const stepResults = [];
  let context = null;
  let page = null;

  // Global task abort.
  const ac = new AbortController();
  const globalTimer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: VIEWPORT,
      acceptDownloads: false, // block file downloads
      bypassCSP: false,
    });
    context.setDefaultTimeout(stepTimeoutMs);
    context.setDefaultNavigationTimeout(stepTimeoutMs);

    page = await context.newPage();

    // Hard block downloads at the page level too.
    page.on("download", (d) => {
      d.cancel().catch(() => {});
    });

    // Initial navigation if a top-level url is provided.
    if (url) {
      await guardAbort(ac.signal);
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    for (let i = 0; i < steps.length; i += 1) {
      await guardAbort(ac.signal);
      const step = steps[i];
      try {
        const value = await runStep(page, step, stepTimeoutMs, ac.signal);
        const entry = { action: step.action, status: "ok" };
        if (value !== undefined) entry.value = value;
        stepResults.push(entry);
      } catch (err) {
        stepResults.push({
          action: step.action,
          status: "error",
          error: shortError(err),
        });
        // Stop the sequence on first failing step.
        break;
      }
    }

    let title = "";
    let finalUrl = "";
    try {
      title = await page.title();
    } catch {
      /* ignore */
    }
    try {
      finalUrl = page.url();
    } catch {
      /* ignore */
    }

    const result = {
      ok: true,
      finalUrl,
      title,
      steps: stepResults,
      elapsedMs: Date.now() - started,
    };

    if (returnText) {
      try {
        const bodyText = await page.evaluate(
          () => document.body?.innerText || "",
        );
        result.text = truncateText(bodyText);
      } catch (err) {
        result.text = "";
        result.textError = shortError(err);
      }
    }

    if (screenshot) {
      const shot = await captureScreenshot(page);
      if (shot) result.screenshot = shot;
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      error: shortError(err),
      steps: stepResults,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(globalTimer);
    // Close page+context (NOT the shared browser).
    if (page) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
    if (context) {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
  }
}

function guardAbort(signal) {
  if (signal.aborted) {
    return Promise.reject(new Error("task timeout exceeded"));
  }
  return Promise.resolve();
}

/**
 * Execute a single normalized step. Throws on failure (caller records it).
 * Returns an optional value (e.g. extracted text/links).
 */
async function runStep(page, step, stepTimeoutMs, signal) {
  const opts = { timeout: stepTimeoutMs };

  switch (step.action) {
    case "goto": {
      await page.goto(step.url, { waitUntil: "domcontentloaded", ...opts });
      return page.url();
    }

    case "click": {
      const locator = step.selector
        ? page.locator(step.selector)
        : page.getByText(step.text, { exact: false });
      await locator.first().click(opts);
      return undefined;
    }

    case "type": {
      const locator = page.locator(step.selector).first();
      await locator.fill(step.text, opts);
      if (step.submit) {
        await locator.press("Enter", opts);
        await page
          .waitForLoadState("domcontentloaded", opts)
          .catch(() => {});
      }
      return undefined;
    }

    case "press": {
      await page.keyboard.press(step.key);
      return undefined;
    }

    case "wait": {
      if (step.selector) {
        await page.locator(step.selector).first().waitFor({
          state: "visible",
          timeout: stepTimeoutMs,
        });
      } else {
        await delay(step.ms ?? 0, signal);
      }
      return undefined;
    }

    case "extract_text": {
      let text;
      if (step.selector) {
        text = await page
          .locator(step.selector)
          .first()
          .innerText(opts);
      } else {
        text = await page.evaluate(() => document.body?.innerText || "");
      }
      return truncateText(text);
    }

    case "extract_links": {
      const links = await page.evaluate(() => {
        const out = [];
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        for (const a of anchors) {
          const rect = a.getBoundingClientRect();
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            window.getComputedStyle(a).visibility !== "hidden";
          if (!visible) continue;
          const text = (a.innerText || a.textContent || "").trim();
          out.push({ text: text.slice(0, 200), href: a.href });
          if (out.length >= 200) break;
        }
        return out;
      });
      return links;
    }

    case "screenshot": {
      const shot = await captureScreenshot(page, step.fullPage === true);
      return shot ? { screenshot: shot } : undefined;
    }

    case "scroll": {
      if (step.direction === "to" && step.selector) {
        await page
          .locator(step.selector)
          .first()
          .scrollIntoViewIfNeeded(opts);
      } else {
        const amount =
          typeof step.amount === "number"
            ? step.amount
            : step.direction === "up"
              ? -800
              : 800;
        await page.evaluate(
          (dy) => window.scrollBy(0, dy),
          step.direction === "up" ? -Math.abs(amount) : Math.abs(amount),
        );
      }
      return undefined;
    }

    case "select": {
      await page
        .locator(step.selector)
        .first()
        .selectOption(step.value, opts);
      return undefined;
    }

    default:
      throw new Error(`unsupported action "${step.action}"`);
  }
}

async function captureScreenshot(page, fullPage = false) {
  try {
    const buf = await page.screenshot({
      type: "png",
      fullPage,
    });
    const b64 = buf.toString("base64");
    if (b64.length > MAX_SCREENSHOT_B64) {
      // Too large — return a viewport-only PNG instead, or drop it.
      if (fullPage) {
        return await captureScreenshot(page, false);
      }
      return null;
    }
    return b64;
  } catch {
    return null;
  }
}

function shortError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  // Playwright errors can be huge; keep the first line/portion.
  const firstLine = msg.split("\n")[0];
  return firstLine.slice(0, 500);
}
