import fs from "node:fs/promises";
import path from "node:path";
import { readTimeline, summarizeTimeline, listTimelineUserIds } from "./work-timeline.js";

/**
 * Build a self-contained static web showcase of the company memory graph
 * from state + work timeline. Outputs `graph.json` (nodes + edges + per-node
 * details) and a single `index.html` that renders an interactive force graph
 * (CDN lib) with a side panel — no backend, served by nginx as static files.
 *
 * Nodes: people, projects, and (optionally) tasks. Edges come from timeline
 * link references (person↔project, person↔collaborator) and the org chart.
 */
export async function exportMemoryGraphSite({ state, dataFilePath, outDir, now = new Date() }) {
  if (!outDir || typeof outDir !== "string") {
    throw new Error("exportMemoryGraphSite: outDir must be a non-empty string");
  }
  await fs.mkdir(outDir, { recursive: true });

  const usersById = new Map((state.users || []).map((u) => [u.id, u]));
  const projectsById = new Map((state.projects || []).map((p) => [p.id, p]));

  const nodes = [];
  const links = [];
  const linkSet = new Set();
  const addLink = (a, b) => {
    if (!a || !b || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source: a, target: b });
  };

  const nameOfUser = (id) => usersById.get(id)?.displayName || id;
  const nameOfProject = (id) => projectsById.get(id)?.name || id;
  const ref = (kind, id, label) => ({ id: `${kind}:${id}`, label });

  // Project nodes (events filled in after we read each user's timeline).
  const projectEvents = new Map();
  for (const project of state.projects || []) {
    nodes.push({
      id: `project:${project.id}`,
      label: project.name || project.id,
      type: "project",
      detail: {
        kind: "Проект",
        members: (project.memberUserIds || []).map((id) => ref("person", id, nameOfUser(id))),
        manager: project.managerUserId ? ref("person", project.managerUserId, nameOfUser(project.managerUserId)) : null,
        recent: [],
      },
    });
    projectEvents.set(project.id, []);
  }

  // Person nodes + their timeline digest.
  const timelineUserIds = new Set(await listTimelineUserIds({ dataFilePath }));
  for (const user of state.users || []) {
    let summary = { total: 0, byKind: {}, projectIds: [], collaborators: [], tasksCompleted: [], tasksAssigned: [], tasksCreated: [] };
    let recent = [];
    if (timelineUserIds.has(sanitize(user.id))) {
      try {
        const events = await readTimeline({ dataFilePath, userId: user.id, limit: 4000 });
        summary = summarizeTimeline(events);
        recent = events.slice(-40).reverse().map(shortEvent);
        // Attribute events to their projects for the project panel.
        for (const e of events) {
          for (const pid of e.links?.projectIds || []) {
            if (projectEvents.has(pid)) {
              projectEvents.get(pid).push({ ...shortEvent(e), who: nameOfUser(user.id) });
            }
          }
        }
      } catch {
        // ignore per-user read failures
      }
    }

    nodes.push({
      id: `person:${user.id}`,
      label: user.displayName || user.id,
      type: "person",
      role: user.role,
      detail: {
        kind: "Сотрудник",
        role: user.role,
        manager: user.managerId ? ref("person", user.managerId, nameOfUser(user.managerId)) : null,
        totals: {
          events: summary.total,
          tasksCompleted: summary.tasksCompleted.length,
          tasksAssigned: summary.tasksAssigned.length,
          tasksCreated: summary.tasksCreated.length,
        },
        tasks: {
          completed: summary.tasksCompleted.slice(-15).reverse().map((e) => e.title),
          assigned: summary.tasksAssigned.slice(-15).reverse().map((e) => e.title),
        },
        projects: summary.projectIds.filter((id) => projectsById.has(id)).map((id) => ref("project", id, nameOfProject(id))),
        collaborators: summary.collaborators.filter((id) => usersById.has(id)).map((id) => ref("person", id, nameOfUser(id))),
        recent,
      },
    });

    // Org chart edge.
    if (user.managerId) {
      addLink(`person:${user.id}`, `person:${user.managerId}`);
    }
    // Person ↔ project edges from summary.
    for (const pid of summary.projectIds) {
      if (projectsById.has(pid)) {
        addLink(`person:${user.id}`, `project:${pid}`);
      }
    }
    // Person ↔ collaborator edges.
    for (const uid of summary.collaborators) {
      if (usersById.has(uid)) {
        addLink(`person:${user.id}`, `person:${uid}`);
      }
    }
  }

  // Fill project recent events (newest first, capped).
  for (const node of nodes) {
    if (node.type === "project") {
      const pid = node.id.slice("project:".length);
      const evs = projectEvents.get(pid) || [];
      node.detail.recent = evs
        .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
        .slice(0, 30);
    }
  }

  // Project membership edges.
  for (const project of state.projects || []) {
    for (const uid of project.memberUserIds || []) {
      if (usersById.has(uid)) {
        addLink(`person:${uid}`, `project:${project.id}`);
      }
    }
  }

  const graph = {
    generatedAt: now.toISOString(),
    stats: {
      people: (state.users || []).length,
      projects: (state.projects || []).length,
      nodes: nodes.length,
      links: links.length,
    },
    nodes,
    links,
  };

  await fs.writeFile(path.join(outDir, "graph.json"), JSON.stringify(graph), "utf8");
  await fs.writeFile(path.join(outDir, "index.html"), INDEX_HTML, "utf8");
  return { outDir, nodes: nodes.length, links: links.length };
}

function sanitize(userId) {
  return String(userId || "unknown").replace(/[^a-zA-Z0-9._-]/gu, "_");
}

function shortEvent(e) {
  return { ts: e.ts, kind: e.kind, title: e.title, detail: e.detail ? String(e.detail).slice(0, 600) : "" };
}

const INDEX_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Starlab — Граф памяти</title>
<script src="https://unpkg.com/force-graph"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0e1116; color: #e6edf3; }
  #graph { position: fixed; inset: 0; }
  #panel { position: fixed; top: 0; right: 0; width: 400px; max-width: 92vw; height: 100%; background: #161b22; border-left: 1px solid #30363d; padding: 18px 20px 40px; overflow-y: auto; transform: translateX(100%); transition: transform .2s; }
  #panel.open { transform: translateX(0); }
  #panel h2 { margin: 0 0 4px; font-size: 20px; }
  #panel h3 { margin: 18px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; }
  .role { color: #8b949e; font-size: 13px; margin-bottom: 12px; }
  .stat { display: inline-block; background: #21262d; border-radius: 6px; padding: 6px 10px; margin: 0 6px 6px 0; font-size: 13px; }
  .chip { display: inline-block; background: #1f6feb22; border: 1px solid #1f6feb55; color: #58a6ff; border-radius: 999px; padding: 3px 10px; margin: 0 6px 6px 0; font-size: 13px; cursor: pointer; }
  .chip.proj { background: #3fb95022; border-color: #3fb95055; color: #3fb950; }
  .li { font-size: 13px; padding: 4px 0; border-top: 1px solid #21262d; }
  .ev { border-top: 1px solid #21262d; padding: 9px 0; font-size: 13px; cursor: pointer; }
  .ev .t { color: #8b949e; font-size: 11px; }
  .ev .d { color: #adbac7; font-size: 12px; margin-top: 4px; white-space: pre-wrap; display: none; }
  .ev.open .d { display: block; }
  .empty { color: #8b949e; font-size: 13px; margin-top: 8px; }
  #hdr { position: fixed; top: 12px; left: 14px; z-index: 5; background: #161b22cc; backdrop-filter: blur(4px); border: 1px solid #30363d; border-radius: 8px; padding: 10px 12px; font-size: 13px; width: 250px; }
  #hdr b { font-size: 15px; }
  #search { width: 100%; margin-top: 8px; background: #0e1116; border: 1px solid #30363d; color: #e6edf3; border-radius: 6px; padding: 7px 9px; font-size: 13px; }
  #results { margin-top: 6px; max-height: 220px; overflow-y: auto; }
  #results .r { padding: 5px 6px; font-size: 13px; cursor: pointer; border-radius: 5px; }
  #results .r:hover { background: #21262d; }
  #close { float: right; cursor: pointer; color: #8b949e; }
  .dot { display:inline-block; width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle; }
</style>
</head>
<body>
<div id="hdr">
  <b>Starlab — Граф памяти</b><br>
  <span id="stats">загрузка…</span>
  <input id="search" placeholder="поиск сотрудника / проекта…" autocomplete="off">
  <div id="results"></div>
</div>
<div id="graph"></div>
<div id="panel"><span id="close">✕</span><div id="pcontent"></div></div>
<script>
const COLORS = { person: "#58a6ff", project: "#3fb950", task: "#d29922" };
const KIND = {
  dialog_question: "❓ вопрос", dialog_answer: "💬 ответ ассистента",
  device_action: "🖥 действие на ПК", agent_task: "🤖 задача агента",
  agent_task_step: "↳ шаг агента", task_created: "🆕 задача создана",
  task_assigned: "📌 задача назначена", task_completed: "✅ задача завершена",
  task_status_change: "🔄 смена статуса", report_submitted: "📝 отчёт",
  activity_summary: "📊 активность", commitment: "🤝 договорённость",
  schedule: "🗓 расписание", note: "•"
};
let GraphRef, byId = {};
fetch("graph.json").then(r => r.json()).then(data => {
  byId = Object.fromEntries(data.nodes.map(n => [n.id, n]));
  document.getElementById("stats").textContent =
    data.stats.people + " сотрудников · " + data.stats.projects + " проектов · " + data.links.length + " связей";
  const el = document.getElementById("graph");
  const panel = document.getElementById("panel");
  const pc = document.getElementById("pcontent");
  document.getElementById("close").onclick = () => panel.classList.remove("open");

  GraphRef = ForceGraph()(el)
    .graphData(data)
    .nodeId("id")
    .nodeColor(n => COLORS[n.type] || "#8b949e")
    .nodeRelSize(6)
    .linkColor(() => "#30363d")
    .linkWidth(1)
    .nodeCanvasObject((node, ctx, scale) => {
      const r = node.type === "project" ? 7 : 6;
      ctx.fillStyle = COLORS[node.type] || "#8b949e";
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2*Math.PI); ctx.fill();
      if (scale > 0.6) {
        ctx.font = (12/scale) + "px sans-serif";
        ctx.fillStyle = "#e6edf3"; ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(node.label, node.x, node.y + r + 1);
      }
    })
    .onNodeClick(openNode);

  function openNode(node) {
    const d = node.detail || {};
    let h = "<h2><span class='dot' style='background:" + (COLORS[node.type]||'#8b949e') + "'></span>" + esc(node.label) + "</h2>";
    h += "<div class='role'>" + esc(d.kind || node.type) + (d.role ? " · " + esc(d.role) : "") + "</div>";
    if (d.totals) {
      h += "<div><span class='stat'>событий: " + d.totals.events + "</span>";
      h += "<span class='stat'>✅ " + d.totals.tasksCompleted + "</span>";
      h += "<span class='stat'>📌 поставлено: " + d.totals.tasksAssigned + "</span></div>";
    }
    if (d.manager) h += "<h3>Руководитель</h3>" + chip(d.manager, "");
    if (d.members && d.members.length) h += "<h3>Участники</h3>" + d.members.map(m => chip(m, "")).join("");
    if (d.projects && d.projects.length) h += "<h3>Проекты</h3>" + d.projects.map(m => chip(m, "proj")).join("");
    if (d.collaborators && d.collaborators.length) h += "<h3>Работал(а) с</h3>" + d.collaborators.map(m => chip(m, "")).join("");
    if (d.tasks && d.tasks.completed && d.tasks.completed.length) {
      h += "<h3>Завершённые задачи</h3>" + d.tasks.completed.map(t => "<div class='li'>✅ " + esc(t) + "</div>").join("");
    }
    if (d.tasks && d.tasks.assigned && d.tasks.assigned.length) {
      h += "<h3>Поставленные задачи</h3>" + d.tasks.assigned.map(t => "<div class='li'>📌 " + esc(t) + "</div>").join("");
    }
    if (d.recent && d.recent.length) {
      h += "<h3>Лента событий</h3>";
      d.recent.forEach((e, i) => {
        const who = e.who ? esc(e.who) + " · " : "";
        h += "<div class='ev' data-i='" + i + "'><span class='t'>" + esc(fmt(e.ts)) + " · " + who + (KIND[e.kind]||esc(e.kind)) + "</span><br>" +
          esc(e.title || "") + (e.detail ? "<div class='d'>" + esc(e.detail) + "</div>" : "") + "</div>";
      });
    } else if (d.kind === "Сотрудник") {
      h += "<p class='empty'>Пока нет записанных событий — хронология начнёт наполняться по мере работы в боте и на компьютере.</p>";
    }
    pc.innerHTML = h;
    panel.classList.add("open");
    pc.querySelectorAll(".chip").forEach(c => c.onclick = () => { const n = byId[c.dataset.id]; if (n) { focusNode(n); openNode(n); } });
    pc.querySelectorAll(".ev").forEach(c => c.onclick = () => c.classList.toggle("open"));
  }
  function chip(refObj, cls) { return "<span class='chip " + cls + "' data-id='" + esc(refObj.id) + "'>" + esc(refObj.label) + "</span>"; }
  function focusNode(n) { if (n.x != null) { GraphRef.centerAt(n.x, n.y, 600); GraphRef.zoom(2.2, 600); } }

  // Search.
  const search = document.getElementById("search"), results = document.getElementById("results");
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ""; return; }
    const hits = data.nodes.filter(n => n.label.toLowerCase().includes(q)).slice(0, 12);
    results.innerHTML = hits.map(n => "<div class='r' data-id='" + esc(n.id) + "'><span class='dot' style='background:" + (COLORS[n.type]||'#8b949e') + "'></span>" + esc(n.label) + "</div>").join("");
    results.querySelectorAll(".r").forEach(r => r.onclick = () => { const n = byId[r.dataset.id]; results.innerHTML=""; search.value=""; focusNode(n); openNode(n); });
  };

  window.__openNode = openNode;
  function fmt(ts){ return String(ts||"").replace('T',' ').slice(0,16); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
});
</script>
</body>
</html>
`;
