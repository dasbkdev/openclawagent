import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGoogleOAuthService } from "../src/integrations/google-oauth.js";
import { SecretStore } from "../src/setup/secret-store.js";
import { SetupService } from "../src/setup/setup-service.js";

test("GoogleOAuthService connects, stores encrypted per-user tokens, and disconnects", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccp-google-oauth-"));
  try {
    const service = new SetupService({
      configPath: path.join(dir, "runtime-config.json"),
      secretStore: new SecretStore({
        keyPath: path.join(dir, "secrets.key"),
        filePath: path.join(dir, "secrets.json"),
      }),
    });
    await service.saveSetup({
      googleOAuthClientJson: JSON.stringify({
        web: {
          client_id: "google-client-id",
          client_secret: "google-client-secret",
          redirect_uris: ["https://starlabagent.pp.ua/api/v1/google/oauth/callback"],
        },
      }),
    });

    const calls = [];
    const google = createGoogleOAuthService({
      setupService: service,
      publicBaseUrl: "https://starlabagent.pp.ua",
      now: () => new Date("2026-06-04T10:00:00.000Z"),
      fetchImpl: async (url, options = {}) => {
        const requestUrl = String(url);
        calls.push({ url: requestUrl, options });
        if (requestUrl.includes("/token")) {
          const body = options.body;
          assert.equal(body.get("code"), "oauth-code");
          assert.equal(body.get("client_id"), "google-client-id");
          assert.equal(body.get("client_secret"), "google-client-secret");
          assert.equal(body.get("redirect_uri"), "https://starlabagent.pp.ua/api/v1/google/oauth/callback");
          return jsonResponse({
            access_token: "access-token-secret",
            refresh_token: "refresh-token-secret",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
          });
        }
        if (requestUrl.includes("/calendar/v3/calendars/primary/events")) {
          return jsonResponse({
            items: [{
              id: "event-1",
              summary: "Daily sync",
              status: "confirmed",
              start: { dateTime: "2026-06-04T10:00:00Z" },
              end: { dateTime: "2026-06-04T10:30:00Z" },
              attendees: [{ email: "pm@example.com" }],
            }],
          });
        }
        if (requestUrl.includes("/calendar/v3/users/me/calendarList")) {
          return jsonResponse({
            items: [
              {
                id: "primary",
                summary: "PM Example",
                primary: true,
                accessRole: "owner",
                selected: true,
              },
              {
                id: "begayym-calendar",
                summary: "b.niiazbekova@gmail.com",
                summaryOverride: "Бегайым PM",
                accessRole: "reader",
                selected: true,
                timeZone: "Asia/Bishkek",
              },
              {
                id: "daniel-calendar",
                summary: "daniel@example.com",
                summaryOverride: "Даниэл UX/UI",
                accessRole: "reader",
                selected: true,
                timeZone: "Asia/Bishkek",
              },
            ],
          });
        }
        if (requestUrl.includes("/calendar/v3/calendars/begayym-calendar/events")) {
          return jsonResponse({
            items: [{
              id: "begayym-shift-1",
              summary: "Рабочий график Бегайым",
              status: "confirmed",
              start: { dateTime: "2026-06-04T09:00:00+06:00" },
              end: { dateTime: "2026-06-04T18:00:00+06:00" },
            }],
          });
        }
        if (requestUrl.includes("/calendar/v3/calendars/daniel-calendar/events")) {
          return jsonResponse({
            items: [{
              id: "daniel-shift-1",
              summary: "Daniel UX/UI work",
              status: "confirmed",
              start: { dateTime: "2026-06-04T11:00:00+06:00" },
              end: { dateTime: "2026-06-04T17:00:00+06:00" },
            }],
          });
        }
        if (requestUrl.includes("/gmail/v1/users/me/messages/msg-1")) {
          return jsonResponse({
            id: "msg-1",
            threadId: "thread-1",
            snippet: "Status update",
            payload: {
              headers: [
                { name: "Subject", value: "Project status" },
                { name: "From", value: "lead@example.com" },
                { name: "Date", value: "Thu, 04 Jun 2026 10:00:00 +0000" },
              ],
            },
          });
        }
        if (requestUrl.includes("/gmail/v1/users/me/messages")) {
          return jsonResponse({
            resultSizeEstimate: 1,
            messages: [{ id: "msg-1", threadId: "thread-1" }],
          });
        }
        if (requestUrl.includes("/docs.googleapis.com/v1/documents/file-doc-1")) {
          return jsonResponse({
            title: "PM daily notes",
            body: {
              content: [{
                paragraph: {
                  elements: [
                    { textRun: { content: "Today I checked the kanban board.\n" } },
                    { textRun: { content: "Blocked task: payment integration.\n" } },
                  ],
                },
              }],
            },
          });
        }
        if (requestUrl.includes("/sheets.googleapis.com/v4/spreadsheets/file-sheet-1/values")) {
          return jsonResponse({
            range: "'Sprint plan'!A1:H20",
            values: [
              ["Task", "Status"],
              ["API integration", "Done"],
              ["QA checklist", "In progress"],
            ],
          });
        }
        if (requestUrl.includes("/sheets.googleapis.com/v4/spreadsheets/file-sheet-1")) {
          return jsonResponse({
            properties: { title: "Sprint plan" },
            sheets: [{ properties: { title: "Sprint plan" } }],
          });
        }
        if (requestUrl.includes("/drive/v3/files")) {
          return jsonResponse({
            files: [
              {
                id: "file-doc-1",
                name: "PM daily notes",
                mimeType: "application/vnd.google-apps.document",
                modifiedTime: "2026-06-04T09:00:00Z",
                owners: [{ displayName: "PM Example" }],
                webViewLink: "https://docs.google.com/document/d/file-doc-1",
              },
              {
                id: "file-sheet-1",
                name: "Sprint plan",
                mimeType: "application/vnd.google-apps.spreadsheet",
                modifiedTime: "2026-06-04T09:30:00Z",
                owners: [{ displayName: "PM Example" }],
                webViewLink: "https://docs.google.com/spreadsheets/d/file-sheet-1",
              },
            ],
          });
        }
        return jsonResponse({
          email: "pm@example.com",
          name: "PM Example",
        });
      },
    });

    const start = await google.buildAuthorizationUrl({ userId: "u-pm-1" });
    const url = new URL(start.authorizationUrl);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "google-client-id");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.match(url.searchParams.get("scope"), /calendar\.readonly/u);

    const status = await google.handleCallback({
      code: "oauth-code",
      state: url.searchParams.get("state"),
    });
    assert.equal(status.connected, true);
    assert.equal(status.userId, "u-pm-1");
    assert.equal(status.googleAccountEmail, "pm@example.com");
    assert.equal("refreshToken" in status, false);
    assert.equal("accessToken" in status, false);

    const rawSecrets = await fs.readFile(path.join(dir, "secrets.json"), "utf8");
    assert.equal(rawSecrets.includes("refresh-token-secret"), false);
    assert.equal(rawSecrets.includes("access-token-secret"), false);
    assert.equal(calls.length, 2);

    const current = await google.status({ userId: "u-pm-1" });
    assert.equal(current.connected, true);
    assert.equal(current.googleAccountName, "PM Example");

    const workspace = await google.readWorkspaceSnapshot({
      userId: "u-pm-1",
      period: {
        label: "today",
        from: "2026-06-04T00:00:00.000Z",
        to: "2026-06-04T23:59:59.999Z",
      },
      limits: {
        calendarSearchTerms: ["Бегайым PM", "Daniel UX UI"],
      },
    });
    assert.equal(workspace.connected, true);
    assert.equal(workspace.calendar.data.events[0].title, "Daily sync");
    assert.equal(workspace.calendarList.data.count, 3);
    assert.equal(workspace.sharedCalendars.data.matchedCalendars, 2);
    assert.equal(workspace.sharedCalendars.data.calendars[0].calendar.name, "Бегайым PM");
    assert.equal(workspace.sharedCalendars.data.calendars[0].events.events[0].title, "Рабочий график Бегайым");
    assert.equal(workspace.sharedCalendars.data.calendars[1].calendar.name, "Даниэл UX/UI");
    assert.equal(workspace.sharedCalendars.data.calendars[1].events.events[0].title, "Daniel UX/UI work");
    assert.equal(workspace.gmail.data.messages[0].subject, "Project status");
    assert.equal(workspace.drive.data.files[1].name, "Sprint plan");
    assert.match(workspace.documents.data.documents[0].text, /kanban board/u);
    assert.equal(workspace.documents.data.sheets[0].rows[1][0], "API integration");

    const disconnected = await google.disconnect({ userId: "u-pm-1" });
    assert.equal(disconnected.connected, false);
    assert.equal((await google.status({ userId: "u-pm-1" })).connected, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
