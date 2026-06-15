// Generate the Obsidian vault once, immediately, from current state+timeline.
import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { JsonStore } from "/opt/company-control-plane/src/infra/json-store.js";
import { exportObsidianVault } from "/opt/company-control-plane/src/domain/obsidian-export.js";

const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });

const dataFilePath = process.env.CONTROL_PLANE_DATA_FILE || "/var/lib/company-control-plane/control-plane.json";
const store = new JsonStore(dataFilePath, () => ({}));
const state = await store.load();
const vaultDir = process.env.STARLAB_VAULT_DIR || "/opt/starlab-vault";
const { filesWritten } = await exportObsidianVault({ state, dataFilePath, vaultDir });
console.log("vault files written:", filesWritten, "->", vaultDir);
