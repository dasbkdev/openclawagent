import { createSetupService } from '/opt/company-control-plane/src/setup/setup-service.js';
import { createGoogleOAuthService } from '/opt/company-control-plane/src/integrations/google-oauth.js';
import fs from 'node:fs/promises';
process.env.CONTROL_PLANE_CONFIG_DIR = '/var/lib/company-control-plane';
process.env.PUBLIC_BASE_URL = 'https://starlabagent.pp.ua';
const setupService = createSetupService({ projectRoot: '/opt/company-control-plane' });
await setupService.applyToEnv(process.env, { overwrite: true });
const google = createGoogleOAuthService({ setupService, publicBaseUrl: 'https://starlabagent.pp.ua' });
const state = JSON.parse(await fs.readFile('/var/lib/company-control-plane/control-plane.json', 'utf8'));
const users = state.users.filter((user) => ['u-nikolay','u-maksat','u-pm-1'].includes(user.id));
const out = [];
for (const user of users) {
  const status = await google.status({ userId: user.id });
  const row = {
    userId: user.id,
    displayName: user.displayName,
    connected: status.connected,
    email: status.googleAccountEmail || null,
    canReadCalendar: null,
    error: null,
  };
  if (status.connected) {
    try {
      const snapshot = await google.readWorkspaceSnapshot({ userId: user.id, from: new Date(Date.now() - 3600000).toISOString(), to: new Date(Date.now() + 3600000).toISOString(), includeCalendar: true, includeGmail: false, includeDrive: false, includeDocs: false, includeSheets: false });
      row.canReadCalendar = true;
      row.calendarCount = snapshot.calendar?.calendars?.length ?? null;
    } catch (error) {
      row.canReadCalendar = false;
      row.error = error?.message || String(error);
      row.details = error?.details || null;
    }
  }
  out.push(row);
}
console.log(JSON.stringify(out, null, 2));
