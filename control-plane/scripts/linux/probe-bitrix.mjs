// Throwaway READ-ONLY probe of the live Bitrix webhook to discover the task /
// kanban data model. Does NOT print the secret webhook URL. Run on the server:
//   CONTROL_PLANE_CONFIG_DIR=/var/lib/company-control-plane \
//   node /opt/company-control-plane/scripts/linux/probe-bitrix.mjs
import { createSetupService } from "../../src/setup/setup-service.js";

const projectRoot = "/opt/company-control-plane";
const setup = createSetupService({ projectRoot });
await setup.applyToEnv(process.env, { overwrite: true });

const webhook = (process.env.BITRIX_WEBHOOK_URL || "").replace(/\/+$/, "");
if (!webhook) {
  console.log("BITRIX_WEBHOOK_URL is NOT configured");
  process.exit(0);
}
console.log("Bitrix webhook configured: yes (url hidden)");

async function call(method, params = {}) {
  const res = await fetch(`${webhook}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { ok: res.ok, status: res.status, json };
}

function brief(label, r) {
  if (!r.ok || r.json?.error) {
    console.log(`\n## ${label}: ERROR status=${r.status} error=${r.json?.error || ""} ${r.json?.error_description || ""}`);
    return null;
  }
  return r.json?.result;
}

// 1) Scopes available to this webhook
{
  const r = await call("scope");
  console.log("\n## scope (granted permissions)");
  console.log(JSON.stringify(brief("scope", r)));
}

// 2) Workgroups / projects
{
  const r = await call("socialnetwork.api.workgroup.list", { select: ["ID", "NAME", "ACTIVE", "CLOSED", "PROJECT", "SCRUM_MASTER_ID"] });
  const groups = brief("workgroups", r);
  if (groups) {
    const list = groups.workgroups || groups.items || groups;
    console.log(`\n## workgroups: ${Array.isArray(list) ? list.length : "?"}`);
    if (Array.isArray(list)) {
      for (const g of list.slice(0, 40)) {
        console.log(`  [${g.ID || g.id}] ${g.NAME || g.name} active=${g.ACTIVE ?? g.active} scrum=${g.SCRUM_MASTER_ID ?? g.scrumMasterId ?? "-"} project=${g.PROJECT ?? g.project ?? "-"}`);
      }
    } else {
      console.log(JSON.stringify(list).slice(0, 800));
    }
  }
}

// 3) ALL tasks (no group filter) — count, freshness, group + stage distribution
{
  const r = await call("tasks.task.list", {
    order: { CHANGED_DATE: "desc" },
    select: ["ID", "TITLE", "GROUP_ID", "STAGE_ID", "STATUS", "RESPONSIBLE_ID", "RESPONSIBLE_NAME", "CHANGED_DATE", "CREATED_DATE", "CLOSED_DATE"],
    start: 0,
  });
  const result = brief("all tasks", r);
  if (result) {
    const tasks = result.tasks || result;
    console.log(`\n## tasks.task.list (no filter): returned ${tasks.length}, total=${r.json.total ?? "?"}`);
    const byGroup = {};
    const byStatus = {};
    let openCount = 0;
    for (const t of tasks) {
      const g = t.groupId ?? t.GROUP_ID ?? "0";
      byGroup[g] = (byGroup[g] || 0) + 1;
      const s = t.status ?? t.STATUS;
      byStatus[s] = (byStatus[s] || 0) + 1;
      if (String(s) !== "5") openCount++;
    }
    console.log("by GROUP_ID:", JSON.stringify(byGroup));
    console.log("by STATUS  :", JSON.stringify(byStatus), `(open=${openCount})`);
    console.log("\nmost recent 15 tasks (changed desc):");
    for (const t of tasks.slice(0, 15)) {
      console.log(`  #${t.id ?? t.ID} grp=${t.groupId ?? t.GROUP_ID ?? "-"} stage=${t.stageId ?? t.STAGE_ID ?? "-"} st=${t.status ?? t.STATUS} chg=${(t.changedDate ?? t.CHANGED_DATE ?? "").slice(0,10)} resp=${t.responsibleName ?? t.RESPONSIBLE_NAME ?? t.responsibleId ?? ""} :: ${(t.title ?? t.TITLE ?? "").slice(0,50)}`);
    }
  }
}

// 4) Kanban stages — personal "My Plan" (entityId 0) and per-group
{
  const r = await call("task.stages.get", { entityId: 0, isAdmin: "N" });
  const stages = brief("personal kanban stages (My Plan)", r);
  if (stages) {
    console.log("\n## task.stages.get entityId=0 (personal kanban / My Plan)");
    console.log(JSON.stringify(stages).slice(0, 1200));
  }
}

// 5) Scrum detection
{
  const r = await call("tasks.api.scrum.sprint.list", { filter: {} });
  const sprints = brief("scrum sprints", r);
  if (sprints) {
    console.log("\n## scrum sprints");
    console.log(JSON.stringify(sprints).slice(0, 1000));
  }
}

console.log("\n--- probe done ---");
