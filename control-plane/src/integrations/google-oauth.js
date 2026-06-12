import crypto from "node:crypto";
import { validation } from "../domain/errors.js";

const DEFAULT_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const CALENDAR_LIST_URL = `${CALENDAR_BASE_URL}/users/me/calendarList`;
const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DOCS_DOCUMENTS_URL = "https://docs.googleapis.com/v1/documents";
const SHEETS_SPREADSHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const STATE_SECRET_NAME = "googleOAuthStateSecret";
const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

export function createGoogleOAuthService({
  setupService,
  publicBaseUrl = process.env.CONTROL_PLANE_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "https://starlabagent.pp.ua",
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  return new GoogleOAuthService({ setupService, publicBaseUrl, fetchImpl, now });
}

export class GoogleOAuthService {
  constructor({ setupService, publicBaseUrl, fetchImpl = fetch, now = () => new Date() }) {
    this.setupService = setupService;
    this.publicBaseUrl = String(publicBaseUrl || "").replace(/\/+$/u, "");
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = 10000;
  }

  async buildAuthorizationUrl({ userId, redirectBaseUrl } = {}) {
    const normalizedUserId = requireString(userId, "userId");
    const client = await this.readClientConfig();
    const redirectUri = this.buildRedirectUri(redirectBaseUrl);
    const state = await this.signState({
      userId: normalizedUserId,
      nonce: crypto.randomBytes(12).toString("base64url"),
      iat: this.now().toISOString(),
    });
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      redirectUri,
      scopes: DEFAULT_SCOPES,
    };
  }

  async handleCallback({ code, state, redirectBaseUrl } = {}) {
    const authCode = requireString(code, "code");
    const payload = await this.verifyState(requireString(state, "state"));
    const client = await this.readClientConfig();
    const redirectUri = this.buildRedirectUri(redirectBaseUrl);
    const existing = await this.readUserTokens(payload.userId);
    const tokenResponse = await this.exchangeCodeForTokens({
      client,
      code: authCode,
      redirectUri,
    });
    const account = tokenResponse.access_token
      ? await this.readGoogleAccount(tokenResponse.access_token)
      : {};

    const expiresAt = tokenResponse.expires_in
      ? new Date(this.now().getTime() + Number(tokenResponse.expires_in) * 1000).toISOString()
      : null;
    const tokens = {
      connected: true,
      userId: payload.userId,
      googleAccountEmail: account.email || existing?.googleAccountEmail || null,
      googleAccountName: account.name || existing?.googleAccountName || null,
      accessToken: tokenResponse.access_token || existing?.accessToken || null,
      refreshToken: tokenResponse.refresh_token || existing?.refreshToken || null,
      tokenType: tokenResponse.token_type || existing?.tokenType || "Bearer",
      expiresAt,
      scopes: readScopes(tokenResponse.scope) || existing?.scopes || DEFAULT_SCOPES,
      connectedAt: existing?.connectedAt || this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };

    if (!tokens.refreshToken) {
      throw validation("Google did not return refresh_token. Revoke app access in Google account and reconnect.");
    }

    await this.writeUserTokens(payload.userId, tokens);
    return this.publicStatus(tokens);
  }

  async status({ userId } = {}) {
    const tokens = await this.readUserTokens(requireString(userId, "userId"));
    if (!tokens) {
      return { connected: false, userId };
    }
    return this.publicStatus(tokens);
  }

  async disconnect({ userId } = {}) {
    const normalizedUserId = requireString(userId, "userId");
    await this.setupService.secretStore.deleteSecret(userTokenSecretName(normalizedUserId));
    return { connected: false, userId: normalizedUserId };
  }

  async getAccessToken({ userId } = {}) {
    const normalizedUserId = requireString(userId, "userId");
    const tokens = await this.readUserTokens(normalizedUserId);
    if (!tokens?.refreshToken) {
      throw validation("Google account is not connected for this user");
    }
    if (tokens.accessToken && !isExpiringSoon(tokens.expiresAt, this.now())) {
      return tokens.accessToken;
    }
    const client = await this.readClientConfig();
    const refreshed = await this.refreshUserTokens({ userId: normalizedUserId, tokens, client });
    return refreshed.accessToken;
  }

  async readWorkspaceSnapshot({ userId, period, limits = {} } = {}) {
    const normalizedUserId = requireString(userId, "userId");
    const tokens = await this.readUserTokens(normalizedUserId);
    if (!tokens?.refreshToken) {
      return {
        source: "google",
        configured: true,
        connected: false,
        userId: normalizedUserId,
      };
    }

    const accessToken = await this.getAccessToken({ userId: normalizedUserId });
    const normalizedPeriod = normalizePeriod(period, this.now());
    const calendarSearchTerms = normalizeSearchTerms(limits.calendarSearchTerms);
    const [calendar, calendarList, gmail, drive] = await Promise.all([
      safeGoogleRead(() => this.readCalendarEvents({
        accessToken,
        period: normalizedPeriod,
        maxResults: limits.calendarEvents || 10,
      })),
      safeGoogleRead(() => this.readCalendarList({
        accessToken,
        maxResults: limits.calendarList || 80,
      })),
      safeGoogleRead(() => this.readGmailMessages({
        accessToken,
        period: normalizedPeriod,
        maxResults: limits.gmailMessages || 6,
      })),
      safeGoogleRead(() => this.readDriveFiles({
        accessToken,
        maxResults: limits.driveFiles || 10,
      })),
    ]);
    const documents = drive.ok
      ? await safeGoogleRead(() => this.readDriveFileContents({
        accessToken,
        files: drive.data.files,
        maxResults: limits.documentFiles || 4,
        docCharLimit: limits.docCharLimit || 2500,
        sheetRows: limits.sheetRows || 20,
        sheetColumns: limits.sheetColumns || 8,
      }))
      : {
          ok: false,
          error: "Drive files are unavailable, so Docs/Sheets content was not read.",
        };
    const sharedCalendars = calendarList.ok
      ? await safeGoogleRead(() => this.readSharedCalendarEvents({
        accessToken,
        calendars: calendarList.data.calendars,
        searchTerms: calendarSearchTerms,
        period: normalizedPeriod,
        maxCalendars: limits.sharedCalendarMatches || 6,
        maxEventsPerCalendar: limits.sharedCalendarEvents || limits.calendarEvents || 10,
      }))
      : {
          ok: false,
          error: "Calendar list is unavailable, so shared calendars were not read.",
        };

    return {
      source: "google",
      configured: true,
      connected: true,
      userId: normalizedUserId,
      account: {
        email: tokens.googleAccountEmail || null,
        name: tokens.googleAccountName || null,
      },
      period: normalizedPeriod,
      calendar,
      calendarList,
      sharedCalendars,
      gmail,
      drive,
      documents,
      updatedAt: this.now().toISOString(),
    };
  }

  async readClientConfig() {
    const raw = await this.setupService.secretStore.readSecret("googleOAuthClientJson");
    if (!raw) {
      throw validation("Google OAuth client JSON is not configured in setup wizard");
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw validation("Google OAuth client JSON is invalid");
    }

    const client = parsed.web || parsed.installed || parsed;
    const clientId = client.client_id;
    const clientSecret = client.client_secret;
    if (!clientId || !clientSecret) {
      throw validation("Google OAuth client JSON must include client_id and client_secret");
    }
    return { clientId, clientSecret };
  }

  buildRedirectUri(redirectBaseUrl = this.publicBaseUrl) {
    const baseUrl = String(redirectBaseUrl || this.publicBaseUrl).replace(/\/+$/u, "");
    return `${baseUrl}/api/v1/google/oauth/callback`;
  }

  async exchangeCodeForTokens({ client, code, redirectUri }) {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw validation("Google OAuth token exchange failed", {
        status: response.status,
        error: payload.error,
        errorDescription: payload.error_description,
      });
    }
    return payload;
  }

  async refreshUserTokens({ userId, tokens, client }) {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw validation("Google OAuth token refresh failed", {
        status: response.status,
        error: payload.error,
        errorDescription: payload.error_description,
      });
    }
    if (!payload.access_token) {
      throw validation("Google OAuth token refresh response did not include access_token");
    }

    const expiresAt = payload.expires_in
      ? new Date(this.now().getTime() + Number(payload.expires_in) * 1000).toISOString()
      : tokens.expiresAt || null;
    const refreshed = {
      ...tokens,
      accessToken: payload.access_token || tokens.accessToken || null,
      refreshToken: payload.refresh_token || tokens.refreshToken,
      tokenType: payload.token_type || tokens.tokenType || "Bearer",
      expiresAt,
      scopes: readScopes(payload.scope) || tokens.scopes || DEFAULT_SCOPES,
      updatedAt: this.now().toISOString(),
    };
    await this.writeUserTokens(userId, refreshed);
    return refreshed;
  }

  async readGoogleAccount(accessToken) {
    try {
      const response = await this.fetchImpl(USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        return {};
      }
      return await response.json();
    } catch {
      return {};
    }
  }

  async readCalendarList({ accessToken, maxResults }) {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("minAccessRole", "reader");
    url.searchParams.set("fields", "items(id,summary,summaryOverride,description,primary,accessRole,selected,hidden,timeZone)");
    const payload = await this.fetchGoogleJson(url, accessToken);
    const calendars = Array.isArray(payload.items) ? payload.items : [];
    return {
      count: calendars.length,
      calendars: calendars.map((calendar) => normalizeCalendarListItem(calendar)),
    };
  }

  async readSharedCalendarEvents({
    accessToken,
    calendars,
    searchTerms,
    period,
    maxCalendars,
    maxEventsPerCalendar,
  }) {
    const terms = normalizeSearchTerms(searchTerms);
    const candidates = matchCalendarsByTerms(calendars, terms)
      .filter((calendar) => !calendar.primary)
      .slice(0, maxCalendars);
    const results = [];

    for (const calendar of candidates) {
      const events = await this.readCalendarEvents({
        accessToken,
        calendarId: calendar.id,
        period,
        maxResults: maxEventsPerCalendar,
      });
      results.push({
        calendar: publicCalendar(calendar),
        matchedTerms: calendar.matchedTerms,
        events,
      });
    }

    return {
      searchTerms: terms,
      availableCalendars: Array.isArray(calendars) ? calendars.length : 0,
      matchedCalendars: results.length,
      calendars: results,
    };
  }

  async readCalendarEvents({ accessToken, period, maxResults, calendarId = "primary" }) {
    const url = new URL(`${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", period.from);
    url.searchParams.set("timeMax", period.to);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("fields", "items(id,summary,status,start,end,htmlLink,attendees/email)");
    const payload = await this.fetchGoogleJson(url, accessToken);
    const events = Array.isArray(payload.items) ? payload.items : [];
    return {
      calendarId,
      count: events.length,
      events: events.map((event) => ({
        id: event.id || null,
        title: event.summary || "(без названия)",
        status: event.status || null,
        start: event.start?.dateTime || event.start?.date || null,
        end: event.end?.dateTime || event.end?.date || null,
        attendeeCount: Array.isArray(event.attendees) ? event.attendees.length : 0,
        url: event.htmlLink || null,
      })),
    };
  }

  async readGmailMessages({ accessToken, period, maxResults }) {
    const url = new URL(GMAIL_MESSAGES_URL);
    url.searchParams.set("q", [
      `after:${formatGmailDate(period.from)}`,
      `before:${formatGmailDate(addDays(period.to, 1))}`,
      "-category:promotions",
      "-category:social",
      "-category:forums",
      "-from:noreply",
      "-from:no-reply",
    ].join(" "));
    url.searchParams.set("maxResults", String(maxResults));
    const payload = await this.fetchGoogleJson(url, accessToken);
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const details = await Promise.all(
      messages.slice(0, maxResults).map((message) => this.readGmailMessageMetadata({ accessToken, id: message.id })),
    );
    return {
      resultSizeEstimate: Number(payload.resultSizeEstimate || details.length),
      messages: details.filter(Boolean),
      workLikeMessages: details.filter(Boolean).filter(isWorkLikeEmail),
    };
  }

  async readGmailMessageMetadata({ accessToken, id }) {
    const url = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "metadata");
    url.searchParams.append("metadataHeaders", "Subject");
    url.searchParams.append("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "Date");
    try {
      const payload = await this.fetchGoogleJson(url, accessToken);
      const headers = readGmailHeaders(payload.payload?.headers);
      return {
        id: payload.id || id,
        threadId: payload.threadId || null,
        labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
        subject: headers.Subject || "(без темы)",
        from: headers.From || null,
        date: headers.Date || null,
        snippet: payload.snippet || null,
        workLike: isWorkLikeEmail({
          subject: headers.Subject || "",
          from: headers.From || "",
          snippet: payload.snippet || "",
          labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
        }),
      };
    } catch (error) {
      return {
        id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readDriveFiles({ accessToken, maxResults }) {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set("pageSize", String(maxResults));
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink,owners/displayName)");
    const payload = await this.fetchGoogleJson(url, accessToken);
    const files = Array.isArray(payload.files) ? payload.files : [];
    return {
      count: files.length,
      files: files.map((file) => ({
        id: file.id || null,
        name: file.name || "(без названия)",
        mimeType: file.mimeType || null,
        modifiedTime: file.modifiedTime || null,
        ownerNames: Array.isArray(file.owners) ? file.owners.map((owner) => owner.displayName).filter(Boolean) : [],
        url: file.webViewLink || null,
      })),
    };
  }

  async readDriveFileContents({
    accessToken,
    files,
    maxResults,
    docCharLimit,
    sheetRows,
    sheetColumns,
  }) {
    const candidates = (Array.isArray(files) ? files : [])
      .filter((file) => [GOOGLE_DOC_MIME_TYPE, GOOGLE_SHEET_MIME_TYPE].includes(file.mimeType))
      .slice(0, maxResults);
    const documents = [];
    const sheets = [];

    for (const file of candidates) {
      if (file.mimeType === GOOGLE_DOC_MIME_TYPE) {
        documents.push(await this.readGoogleDocContent({ accessToken, file, charLimit: docCharLimit }));
      }
      if (file.mimeType === GOOGLE_SHEET_MIME_TYPE) {
        sheets.push(await this.readGoogleSheetContent({ accessToken, file, maxRows: sheetRows, maxColumns: sheetColumns }));
      }
    }

    return {
      count: candidates.length,
      documents,
      sheets,
    };
  }

  async readGoogleDocContent({ accessToken, file, charLimit }) {
    const url = new URL(`${DOCS_DOCUMENTS_URL}/${encodeURIComponent(file.id)}`);
    url.searchParams.set("fields", "title,body(content(paragraph(elements(textRun(content)))))");
    try {
      const payload = await this.fetchGoogleJson(url, accessToken);
      const fullText = extractGoogleDocText(payload);
      return {
        id: file.id,
        name: file.name,
        title: payload.title || file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime || null,
        url: file.url || null,
        truncated: fullText.length > charLimit,
        text: fullText.slice(0, charLimit).trim(),
      };
    } catch (error) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async readGoogleSheetContent({ accessToken, file, maxRows, maxColumns }) {
    try {
      const metadataUrl = new URL(`${SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(file.id)}`);
      metadataUrl.searchParams.set("fields", "properties/title,sheets(properties/title)");
      const metadata = await this.fetchGoogleJson(metadataUrl, accessToken);
      const sheetTitle = metadata.sheets?.[0]?.properties?.title || "Sheet1";
      const range = `${quoteSheetTitle(sheetTitle)}!A1:${columnName(maxColumns)}${maxRows}`;
      const valuesUrl = new URL(`${SHEETS_SPREADSHEETS_URL}/${encodeURIComponent(file.id)}/values/${encodeURIComponent(range)}`);
      valuesUrl.searchParams.set("majorDimension", "ROWS");
      const values = await this.fetchGoogleJson(valuesUrl, accessToken);
      return {
        id: file.id,
        name: file.name,
        title: metadata.properties?.title || file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime || null,
        url: file.url || null,
        range: values.range || range,
        rows: normalizeSheetValues(values.values, maxRows, maxColumns),
      };
    } catch (error) {
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async fetchGoogleJson(url, accessToken) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw validation("Google API request failed", {
          status: response.status,
          body: text.slice(0, 1000),
        });
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async readUserTokens(userId) {
    const raw = await this.setupService.secretStore.readSecret(userTokenSecretName(userId));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeUserTokens(userId, tokens) {
    await this.setupService.secretStore.writeSecret(
      userTokenSecretName(userId),
      JSON.stringify(tokens, null, 2),
    );
  }

  async signState(payload) {
    const secret = await this.readOrCreateStateSecret();
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  async verifyState(value) {
    const [encoded, signature] = String(value).split(".");
    if (!encoded || !signature) {
      throw validation("Invalid Google OAuth state");
    }
    const secret = await this.readOrCreateStateSecret();
    const expected = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
    if (
      Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw validation("Invalid Google OAuth state signature");
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const issuedAt = new Date(payload.iat).getTime();
    if (!Number.isFinite(issuedAt) || this.now().getTime() - issuedAt > 15 * 60 * 1000) {
      throw validation("Google OAuth state expired");
    }
    return payload;
  }

  async readOrCreateStateSecret() {
    const existing = await this.setupService.secretStore.readSecret(STATE_SECRET_NAME);
    if (existing) {
      return existing;
    }
    const secret = crypto.randomBytes(32).toString("base64url");
    await this.setupService.secretStore.writeSecret(STATE_SECRET_NAME, secret);
    return secret;
  }

  publicStatus(tokens) {
    return {
      connected: Boolean(tokens?.connected && tokens.refreshToken),
      userId: tokens?.userId,
      googleAccountEmail: tokens?.googleAccountEmail || null,
      googleAccountName: tokens?.googleAccountName || null,
      scopes: tokens?.scopes || [],
      connectedAt: tokens?.connectedAt || null,
      updatedAt: tokens?.updatedAt || null,
      expiresAt: tokens?.expiresAt || null,
    };
  }
}

function userTokenSecretName(userId) {
  return `googleOAuthTokens:${userId}`;
}

function requireString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw validation(`${name} is required`);
  }
  return normalized;
}

function readScopes(value) {
  if (!value) {
    return null;
  }
  return String(value).split(/\s+/u).filter(Boolean);
}

function isExpiringSoon(expiresAt, now) {
  if (!expiresAt) {
    return true;
  }
  const expires = new Date(expiresAt).getTime();
  return !Number.isFinite(expires) || expires - now.getTime() < 2 * 60 * 1000;
}

function normalizePeriod(period, now) {
  const fallbackStart = new Date(now);
  fallbackStart.setHours(0, 0, 0, 0);
  const fallbackEnd = new Date(now);
  fallbackEnd.setHours(23, 59, 59, 999);
  return {
    label: period?.label || "today",
    from: isDateLike(period?.from) ? new Date(period.from).toISOString() : fallbackStart.toISOString(),
    to: isDateLike(period?.to) ? new Date(period.to).toISOString() : fallbackEnd.toISOString(),
  };
}

function isDateLike(value) {
  return value && Number.isFinite(new Date(value).getTime());
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatGmailDate(value) {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function readGmailHeaders(headers) {
  const result = {};
  for (const header of Array.isArray(headers) ? headers : []) {
    if (header?.name) {
      result[header.name] = header.value || "";
    }
  }
  return result;
}

function isWorkLikeEmail(message) {
  const text = [
    message?.subject,
    message?.from,
    message?.snippet,
    ...(Array.isArray(message?.labelIds) ? message.labelIds : []),
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text) {
    return false;
  }
  const personalNoise = [
    "ozon",
    "wallet",
    "faceit",
    "steam",
    "promo",
    "promotion",
    "sale",
    "скидк",
    "акци",
  ];
  if (personalNoise.some((word) => text.includes(word))) {
    return false;
  }
  const workSignals = [
    "bitrix",
    "jira",
    "n8n",
    "google",
    "calendar",
    "meet",
    "docs",
    "sheets",
    "drive",
    "task",
    "project",
    "report",
    "starlab",
    "отчет",
    "отчёт",
    "задач",
    "проект",
    "созвон",
    "встреч",
    "документ",
    "таблиц",
  ];
  return workSignals.some((word) => text.includes(word));
}

function extractGoogleDocText(document) {
  const chunks = [];
  const blocks = Array.isArray(document?.body?.content) ? document.body.content : [];
  for (const block of blocks) {
    const elements = block.paragraph?.elements;
    if (!Array.isArray(elements)) {
      continue;
    }
    const paragraph = elements
      .map((element) => element.textRun?.content || "")
      .join("")
      .trim();
    if (paragraph) {
      chunks.push(paragraph);
    }
  }
  return chunks.join("\n").trim();
}

function quoteSheetTitle(title) {
  const normalized = String(title || "Sheet1").replaceAll("'", "''");
  return `'${normalized}'`;
}

function columnName(index) {
  let remaining = Math.max(1, Number(index) || 1);
  let value = "";
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    value = String.fromCharCode(65 + modulo) + value;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return value;
}

function normalizeSheetValues(values, maxRows, maxColumns) {
  return (Array.isArray(values) ? values : [])
    .slice(0, maxRows)
    .map((row) => (Array.isArray(row) ? row : [])
      .slice(0, maxColumns)
      .map((cell) => String(cell ?? "")));
}

function normalizeCalendarListItem(calendar) {
  return {
    id: calendar.id || null,
    name: calendar.summaryOverride || calendar.summary || "(без названия)",
    summary: calendar.summary || null,
    summaryOverride: calendar.summaryOverride || null,
    description: calendar.description || null,
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole || null,
    selected: Boolean(calendar.selected),
    hidden: Boolean(calendar.hidden),
    timeZone: calendar.timeZone || null,
  };
}

function publicCalendar(calendar) {
  return {
    id: calendar.id || null,
    name: calendar.name || "(без названия)",
    summary: calendar.summary || null,
    summaryOverride: calendar.summaryOverride || null,
    description: calendar.description || null,
    primary: Boolean(calendar.primary),
    accessRole: calendar.accessRole || null,
    selected: Boolean(calendar.selected),
    hidden: Boolean(calendar.hidden),
    timeZone: calendar.timeZone || null,
  };
}

function matchCalendarsByTerms(calendars, searchTerms) {
  const terms = normalizeSearchTerms(searchTerms);
  if (!terms.length) {
    return [];
  }

  return (Array.isArray(calendars) ? calendars : [])
    .map((calendar) => {
      const searchable = normalizeCalendarSearchText([
        calendar.name,
        calendar.description,
        calendar.id,
      ].filter(Boolean).join(" "));
      const matchedTerms = terms.filter((term) => {
        const normalizedTerm = normalizeCalendarSearchText(term);
        return normalizedTerm && searchable.includes(normalizedTerm);
      });
      return { ...calendar, matchedTerms };
    })
    .filter((calendar) => calendar.matchedTerms.length)
    .sort((left, right) => {
      if (left.primary !== right.primary) {
        return left.primary ? 1 : -1;
      }
      return right.matchedTerms.length - left.matchedTerms.length;
    });
}

function normalizeSearchTerms(terms) {
  const raw = Array.isArray(terms) ? terms : [];
  const result = [];
  for (const term of raw) {
    const normalized = String(term || "").trim();
    for (const variant of [normalized, transliterateLatinToCyrillic(normalized), transliterateLongLatinWordsToCyrillic(normalized)]) {
      if (variant && !result.some((item) => normalizeCalendarSearchText(item) === normalizeCalendarSearchText(variant))) {
        result.push(variant);
      }
    }
  }
  return result.slice(0, 20);
}

function normalizeCalendarSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/э/gu, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function transliterateLatinToCyrillic(value) {
  const source = String(value || "").toLowerCase();
  if (!/[a-z]/u.test(source)) {
    return "";
  }
  const pairs = [
    ["shch", "щ"],
    ["yo", "е"],
    ["yu", "ю"],
    ["ya", "я"],
    ["ye", "е"],
    ["zh", "ж"],
    ["ch", "ч"],
    ["sh", "ш"],
    ["kh", "х"],
    ["ts", "ц"],
  ];
  let result = source;
  for (const [latin, cyrillic] of pairs) {
    result = result.replaceAll(latin, cyrillic);
  }
  const chars = {
    a: "а",
    b: "б",
    c: "к",
    d: "д",
    e: "е",
    f: "ф",
    g: "г",
    h: "х",
    i: "и",
    j: "ж",
    k: "к",
    l: "л",
    m: "м",
    n: "н",
    o: "о",
    p: "п",
    q: "к",
    r: "р",
    s: "с",
    t: "т",
    u: "у",
    v: "в",
    w: "в",
    x: "кс",
    y: "и",
    z: "з",
  };
  return result.replace(/[a-z]/gu, (char) => chars[char] || char);
}

function transliterateLongLatinWordsToCyrillic(value) {
  return String(value || "").replace(/[a-z]+/giu, (word) => {
    if (word.length <= 3 && word === word.toUpperCase()) {
      return word;
    }
    if (word.length <= 3) {
      return word;
    }
    return transliterateLatinToCyrillic(word);
  });
}

async function safeGoogleRead(reader) {
  try {
    return {
      ok: true,
      data: await reader(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
