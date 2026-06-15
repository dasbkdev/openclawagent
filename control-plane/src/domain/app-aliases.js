/**
 * Resolve a human app name ("Visual Studio Code") into a launch target the
 * device agent can actually open, per platform. This runs SERVER-SIDE when an
 * open_app command is queued, so existing agents receive a target their
 * `Start-Process` / `open -a` can resolve — no agent rebuild required.
 *
 * Windows: return a PATH command or executable name (Start-Process resolves
 *   PATH + App Paths registry). e.g. "Visual Studio Code" → "code".
 * macOS: `open -a` matches the display name, so keep the human name.
 * Linux: best-effort lowercase binary name.
 */

const WINDOWS_ALIASES = [
  { match: /visual studio code|vs ?code|вижуал|вс ?код/iu, target: "code" },
  { match: /google chrome|chrome|хром/iu, target: "chrome" },
  { match: /firefox|файрфокс|фаерфокс/iu, target: "firefox" },
  { match: /\bedge\b|эдж/iu, target: "msedge" },
  { match: /telegram|телеграм|телегу/iu, target: "Telegram" },
  { match: /\bword\b|ворд/iu, target: "winword" },
  { match: /excel|эксель/iu, target: "excel" },
  { match: /power ?point|поинт/iu, target: "powerpnt" },
  { match: /outlook|аутлук/iu, target: "outlook" },
  { match: /notepad\+\+/iu, target: "notepad++" },
  { match: /notepad|блокнот/iu, target: "notepad" },
  { match: /calculator|калькул/iu, target: "calc" },
  { match: /\bterminal\b|терминал/iu, target: "wt" },
  { match: /powershell|поверш/iu, target: "powershell" },
  { match: /command prompt|командн(ая|ую)/iu, target: "cmd" },
  { match: /explorer|проводник/iu, target: "explorer" },
  { match: /spotify|спотифай/iu, target: "spotify" },
  { match: /zoom|зум/iu, target: "zoom" },
  { match: /discord|дискорд/iu, target: "discord" },
  { match: /\bpaint\b|пейнт/iu, target: "mspaint" },
];

const MAC_ALIASES = [
  { match: /visual studio code|vs ?code|вижуал|вс ?код/iu, target: "Visual Studio Code" },
  { match: /google chrome|chrome|хром/iu, target: "Google Chrome" },
  { match: /telegram|телеграм|телегу/iu, target: "Telegram" },
  { match: /safari|сафари/iu, target: "Safari" },
  { match: /terminal|терминал/iu, target: "Terminal" },
  { match: /finder|файндер/iu, target: "Finder" },
];

export function resolveOpenAppTarget(appName, platform) {
  const raw = String(appName || "").trim();
  if (!raw) {
    return raw;
  }
  if (platform === "win32") {
    const hit = WINDOWS_ALIASES.find((a) => a.match.test(raw));
    return hit ? hit.target : raw;
  }
  if (platform === "darwin") {
    const hit = MAC_ALIASES.find((a) => a.match.test(raw));
    return hit ? hit.target : raw;
  }
  // linux / unknown: keep the name; agents fall back to xdg/which.
  return raw;
}
