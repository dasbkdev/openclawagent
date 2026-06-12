import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "device-heartbeat-code.n8n.js"), "utf8");

const workflow = {
  id: "starlabDeviceHeartbeatMirror01",
  name: "Starlab Device Heartbeat Mirror",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "device-agent-heartbeat",
        responseMode: "onReceived",
        options: {},
      },
      id: "device-heartbeat-webhook",
      name: "Device Heartbeat Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "device-agent-heartbeat",
    },
    {
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: code,
      },
      id: "device-heartbeat-store",
      name: "Store Heartbeat Snapshot",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 0],
    },
  ],
  connections: {
    "Device Heartbeat Webhook": {
      main: [[{ node: "Store Heartbeat Snapshot", type: "main", index: 0 }]],
    },
  },
  pinData: {},
  settings: {
    executionOrder: "v1",
  },
  staticData: null,
  tags: [],
  triggerCount: 0,
  updatedAt: new Date().toISOString(),
  versionId: "starlab-device-heartbeat-mirror-1",
  active: true,
};

const outPath = process.argv[2] || path.join(here, "starlab-device-heartbeat.workflow.json");
fs.writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(outPath);
