// Read-only diagnostic: capture the RAW Google Docs API status + error body to
// explain why doc content can't be read while Drive listing works. Prints no
// tokens (only the access-token length and the Google error body).
import { createSetupService } from "../../src/setup/setup-service.js";
import { createGoogleOAuthService } from "../../src/integrations/google-oauth.js";
import { createStore } from "../../src/infra/store-factory.js";
import { createInitialState } from "../../src/infra/seed.js";

const DOC_MIME = "application/vnd.google-apps.document";
const projectRoot = process.env.PROBE_ROOT || "/opt/company-control-plane";
const setupService = createSetupService({ projectRoot });
await setupService.applyToEnv(process.env, { overwrite: true });
const google = createGoogleOAuthService({ setupService });
const store = await createStore({ projectRoot, seedFactory: () => createInitialState(process.env) });
const state = await store.load();

for (const user of state.users || []) {
  let accessToken;
  try {
    const tokens = await google.readUserTokens(user.id);
    if (!tokens?.refreshToken) continue;
    accessToken = await google.getAccessToken({ userId: user.id });
  } catch {
    continue;
  }
  // list drive files, find one google doc
  let docFile = null;
  try {
    const drive = await google.readDriveFiles({ accessToken, maxResults: 10 });
    docFile = (drive.files || []).find((f) => f.mimeType === DOC_MIME);
  } catch (e) {
    console.log(`USER ${user.id} (${user.displayName}) drive list failed: ${e.message}`);
    continue;
  }
  if (!docFile) {
    console.log(`USER ${user.id} (${user.displayName}): no Google Doc among drive files`);
    continue;
  }
  // raw Docs API call
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docFile.id)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  const body = await res.text();
  console.log(`USER ${user.id} (${user.displayName}) tokenLen=${accessToken.length}`);
  console.log(`  doc "${docFile.name}" -> HTTP ${res.status}`);
  console.log(`  body: ${body.slice(0, 700)}`);
  console.log("");
}
process.exit(0);
