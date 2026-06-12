import { createSetupService } from '/opt/company-control-plane/src/setup/setup-service.js';
process.env.CONTROL_PLANE_CONFIG_DIR = '/var/lib/company-control-plane';
const setupService = createSetupService({ projectRoot: '/opt/company-control-plane' });
const raw = await setupService.secretStore.readSecret('googleOAuthClientJson');
const parsed = JSON.parse(raw || '{}');
const client = parsed.web || parsed.installed || parsed;
const redacted = JSON.parse(JSON.stringify(parsed));
for (const block of [redacted, redacted.web, redacted.installed].filter(Boolean)) {
  if (block.client_secret) block.client_secret = '[redacted]';
}
console.log(JSON.stringify(redacted, null, 2));
