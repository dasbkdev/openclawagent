// Live Google OAuth validation per user: attempts getAccessToken (forces
// refresh when expired). Prints ok/fail per user, no tokens.
import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { createGoogleOAuthService } from "/opt/company-control-plane/src/integrations/google-oauth.js";

const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });
const service = createGoogleOAuthService({ setupService });

for (const userId of ["u-nikolay", "u-maksat", "u-pm-1", "u-pm-2", "u-pm-3"]) {
  try {
    const status = await service.status({ userId });
    if (!status?.connected) {
      console.log(userId, "| not connected");
      continue;
    }
    try {
      const token = await service.getAccessToken({ userId });
      console.log(userId, "|", status.googleAccountEmail, "| token:", token ? "LIVE_OK" : "EMPTY");
    } catch (error) {
      console.log(userId, "|", status.googleAccountEmail, "| REFRESH_FAILED:", String(error.message || error).slice(0, 120));
    }
  } catch (error) {
    console.log(userId, "| status error:", String(error.message || error).slice(0, 120));
  }
}
