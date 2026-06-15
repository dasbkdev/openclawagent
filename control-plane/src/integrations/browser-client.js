/**
 * Thin client for the Playwright browser-service (control-plane/browser-service).
 * Lets the assistant "use a browser like a human" — navigate, click, type,
 * read, screenshot — by POSTing a step sequence to the local service.
 *
 * Zero-dependency (built-in fetch). Fail-safe: returns a structured error
 * instead of throwing, so the agent loop degrades gracefully when the
 * browser service is down or disabled.
 */

export function createBrowserClientFromEnv(env = process.env) {
  const baseUrl = (env.BROWSER_SERVICE_URL || "http://127.0.0.1:3210").replace(/\/+$/u, "");
  const token = env.BROWSER_SERVICE_TOKEN || null;
  const enabled = env.BROWSER_SERVICE_ENABLED !== "false";
  return new BrowserServiceClient({ baseUrl, token, enabled });
}

export class BrowserServiceClient {
  constructor({ baseUrl, token = null, enabled = true, timeoutMs = 120000 } = {}) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.enabled = enabled;
    this.timeoutMs = timeoutMs;
    this.source = "browser-service";
  }

  get configured() {
    return Boolean(this.enabled && this.baseUrl);
  }

  async health() {
    if (!this.configured) {
      return { ok: false, configured: false, message: "Browser service disabled" };
    }
    try {
      const res = await this._fetch(`${this.baseUrl}/health`, { method: "GET" }, 8000);
      const body = await res.json();
      return { ok: Boolean(body?.ok), configured: true, message: body?.service || "ok" };
    } catch (error) {
      return { ok: false, configured: true, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Run a browser task: navigate to `url`, perform `steps`, return result.
   * Returns `{ ok, finalUrl, title, text, screenshot, steps, error }`.
   */
  async run({ url, steps = [], returnText = true, screenshot = false, timeoutMs, stepTimeoutMs } = {}) {
    if (!this.configured) {
      return { ok: false, error: "Browser service is disabled on this server" };
    }
    try {
      const res = await this._fetch(`${this.baseUrl}/api/v1/browse/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { "X-Browser-Token": this.token } : {}),
        },
        body: JSON.stringify({ url, steps, returnText, screenshot, timeoutMs, stepTimeoutMs }),
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok && body?.ok === undefined) {
        return { ok: false, error: `Browser service HTTP ${res.status}` };
      }
      return body;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async _fetch(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
