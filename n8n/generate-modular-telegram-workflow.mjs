import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = (name) => fs.readFileSync(path.join(here, "modular", name), "utf8");

const nodes = [
  webhook("Telegram Webhook", "telegram-webhook", [0, 0]),
  code("Parse Telegram Update", "parse-telegram", mod("01-parse-telegram.n8n.js"), [260, 0]),
  code("Access Scope & Commands", "access-scope", mod("02-access-scope.n8n.js"), [540, 0]),
  code("Bitrix Context", "bitrix-context", mod("03-bitrix-context.n8n.js"), [820, -140]),
  code("Google Calendar Context", "google-context", mod("04-google-context.n8n.js"), [1100, -140]),
  code("Device Context", "device-context", mod("05-device-context.n8n.js"), [1380, 0]),
  code("Claude Response", "claude-response", mod("06-claude-response.n8n.js"), [1660, 0]),
  code("Send Telegram Response", "send-telegram", mod("07-send-telegram.n8n.js"), [1940, 0]),
];

const workflow = {
  id: "starlabTelegramMvp01",
  name: "Starlab Agent - Telegram Modular",
  nodes,
  connections: {
    "Telegram Webhook": { main: [[{ node: "Parse Telegram Update", type: "main", index: 0 }]] },
    "Parse Telegram Update": { main: [[{ node: "Access Scope & Commands", type: "main", index: 0 }]] },
    "Access Scope & Commands": { main: [[{ node: "Bitrix Context", type: "main", index: 0 }]] },
    "Bitrix Context": { main: [[{ node: "Google Calendar Context", type: "main", index: 0 }]] },
    "Google Calendar Context": { main: [[{ node: "Device Context", type: "main", index: 0 }]] },
    "Device Context": { main: [[{ node: "Claude Response", type: "main", index: 0 }]] },
    "Claude Response": { main: [[{ node: "Send Telegram Response", type: "main", index: 0 }]] },
  },
  pinData: {},
  settings: { executionOrder: "v1" },
  staticData: null,
  tags: [],
  triggerCount: 0,
  updatedAt: new Date().toISOString(),
  versionId: "starlab-telegram-modular-1",
  active: true,
};

const outPath = process.argv[2] || path.join(here, "starlab-telegram-modular.workflow.json");
fs.writeFileSync(outPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(outPath);

function webhook(name, id, position) {
  return {
    parameters: { httpMethod: "POST", path: "starlab-telegram", responseMode: "onReceived", options: {} },
    id,
    name,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position,
    webhookId: "starlab-telegram",
  };
}

function code(name, id, jsCode, position) {
  return {
    parameters: { mode: "runOnceForAllItems", jsCode },
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
  };
}
