import { createSetupService } from "/opt/company-control-plane/src/setup/setup-service.js";
import { JsonStore } from "/opt/company-control-plane/src/infra/json-store.js";
import { exportMemoryGraphSite } from "/opt/company-control-plane/src/domain/memory-graph-site.js";

const setupService = createSetupService({ projectRoot: "/opt/company-control-plane" });
await setupService.applyToEnv(process.env, { overwrite: true });
const dataFilePath = process.env.CONTROL_PLANE_DATA_FILE || "/var/lib/company-control-plane/control-plane.json";
const store = new JsonStore(dataFilePath, () => ({}));
const state = await store.load();
const outDir = process.env.STARLAB_GRAPH_SITE_DIR || "/opt/starlab-vault-web";
const r = await exportMemoryGraphSite({ state, dataFilePath, outDir });
console.log("graph site:", JSON.stringify(r));
