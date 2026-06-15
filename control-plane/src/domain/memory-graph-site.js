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

  // Project nodes.
  for (const project of state.projects || []) {
    nodes.push({
      id: `project:${project.id}`,
      label: project.name || project.id,
      type: "project",
      detail: { kind: "Проект", members: (project.memberUserIds || []).map((id) => usersById.get(id)?.displayName || id) },
    });
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
        recent = events.slice(-25).reverse().map((e) => ({
          ts: e.ts,
          kind: e.kind,
          title: e.title,
        }));
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
        totals: {
          events: summary.total,
          tasksCompleted: summary.tasksCompleted.length,
          tasksAssigned: summary.tasksAssigned.length,
          tasksCreated: summary.tasksCreated.length,
        },
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
  #panel { position: fixed; top: 0; right: 0; width: 360px; max-width: 86vw; height: 100%; background: #161b22; border-left: 1px solid #30363d; padding: 18px; overflow-y: auto; transform: translateX(100%); transition: transform .2s; }
  #panel.open { transform: translateX(0); }
  #panel h2 { margin: 0 0 4px; font-size: 19px; }
  #panel .role { color: #8b949e; font-size: 13px; margin-bottom: 14px; }
  .stat { display: inline-block; background: #21262d; border-radius: 6px; padding: 6px 10px; margin: 0 6px 6px 0; font-size: 13px; }
  .ev { border-top: 1px solid #21262d; padding: 7px 0; font-size: 13px; }
  .ev .t { color: #8b949e; font-size: 11px; }
  #hdr { position: fixed; top: 12px; left: 14px; z-index: 5; background: #161b22cc; backdrop-filter: blur(4px); border: 1px solid #30363d; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
  #hdr b { font-size: 15px; }
  #close { float: right; cursor: pointer; color: #8b949e; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<div id="hdr"><b>Starlab — Граф памяти</b><br><span id="stats">загрузка…</span></div>
<div id="graph"></div>
<div id="panel"><span id="close">✕ закрыть</span><div id="pcontent"></div></div>
<script>
const COLORS = { person: "#58a6ff", project: "#3fb950", task: "#d29922" };
fetch("graph.json").then(r => r.json()).then(data => {
  document.getElementById("stats").textContent =
    data.stats.people + " сотрудников · " + data.stats.projects + " проектов · " +
    data.nodes.length + " узлов · " + data.links.length + " связей";
  const el = document.getElementById("graph");
  const panel = document.getElementById("panel");
  const pc = document.getElementById("pcontent");
  document.getElementById("close").onclick = () => panel.classList.remove("open");

  const Graph = ForceGraph()(el)
    .graphData(data)
    .nodeId("id")
    .nodelabel(n => n.label)
    .nodeColor(n => COLORS[n.type] || "#8b949e")
    .nodeRelSize(6)
    .linkColor(() => "#30363d")
    .linkWidth(1)
    .nodeCanvasObject((node, ctx, scale) => {
      const r = node.type === "project" ? 7 : 6;
      ctx.fillStyle = COLORS[node.type] || "#8b949e";
      ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2*Math.PI); ctx.fill();
      const label = node.label;
      const fs = 12 / scale;
      ctx.font = fs + "px sans-serif";
      ctx.fillStyle = "#e6edf3";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      if (scale > 0.7) ctx.fillText(label, node.x, node.y + r + 1);
    })
    .onNodeClick(node => {
      const d = node.detail || {};
      let html = "<h2>" + esc(node.label) + "</h2>";
      html += "<div class='role'>" + esc(d.kind || node.type) + (d.role ? " · " + esc(d.role) : "") + "</div>";
      if (d.totals) {
        html += "<div><span class='stat'>событий: " + d.totals.events + "</span>";
        html += "<span class='stat'>завершено: " + d.totals.tasksCompleted + "</span>";
        html += "<span class='stat'>поставлено: " + d.totals.tasksAssigned + "</span></div>";
      }
      if (d.members && d.members.length) {
        html += "<p><b>Участники:</b> " + d.members.map(esc).join(", ") + "</p>";
      }
      if (d.recent && d.recent.length) {
        html += "<h3 style='margin-top:16px;font-size:14px'>Последние события</h3>";
        for (const e of d.recent) {
          html += "<div class='ev'><span class='t'>" + esc(e.ts.replace('T',' ').slice(0,16)) +
            " · " + esc(e.kind) + "</span><br>" + esc(e.title || "") + "</div>";
        }
      } else if (d.kind === "Сотрудник") {
        html += "<p style='color:#8b949e'>Пока нет записанных событий — хронология начнёт наполняться по мере работы.</p>";
      }
      pc.innerHTML = html;
      panel.classList.add("open");
    });
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
});
</script>
</body>
</html>
`;
