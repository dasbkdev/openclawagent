import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, "starlab-agent-code.n8n.js"), "utf8");

const workflow = {
  id: "starlabTelegramMvp01",
  name: "Starlab Agent - Telegram n8n MVP",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "starlab-telegram",
        responseMode: "onReceived",
        options: {},
      },
      id: "starlab-telegram-webhook",
      name: "Telegram Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "starlab-telegram",
    },
    {
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: code,
      },
      id: "starlab-agent-brain",
      name: "Starlab Agent Brain",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [280, 0],
    },
  ],
  connections: {
    "Telegram Webhook": {
      main: [[{ node: "Starlab Agent Brain", type: "main", index: 0 }]],
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
  versionId: "starlab-n8n-mvp-1",
  active: true,
};

const outPath = process.argv[2] || path.join(here, "starlab-agent-mvp.workflow.json");
fs.writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(outPath);
