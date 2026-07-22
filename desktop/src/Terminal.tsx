import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IconTerminal, IconTrash, IconX } from "./icons";

type CommandResult = { stdout: string; stderr: string; code: number };

type Line =
  | { kind: "cmd"; text: string; cwd: string }
  | { kind: "out"; text: string }
  | { kind: "err"; text: string };

// Built-in terminal: runs commands via the Rust `run_command`. A bare `cd <dir>` just moves
// the working directory (no subprocess); everything else runs in the current cwd.
export function Terminal({ onClose }: { onClose: () => void }) {
  const [cwd, setCwd] = useState<string>("");
  const [cmd, setCmd] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const history = useRef<string[]>([]);
  const histPos = useRef<number>(-1);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    const text = cmd.trim();
    if (!text || busy) return;
    setCmd("");
    history.current.unshift(text);
    histPos.current = -1;
    setLines((l) => [...l, { kind: "cmd", text, cwd: cwd || "~" }]);

    // handle `cd` locally so the working directory persists across commands
    const cdMatch = /^cd\s+(.+)$/.exec(text);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, "");
      setCwd(target);
      return;
    }

    setBusy(true);
    try {
      const res = await invoke<CommandResult>("run_command", { cmd: text, cwd: cwd || null });
      if (res.stdout) setLines((l) => [...l, { kind: "out", text: res.stdout.trimEnd() }]);
      if (res.stderr) setLines((l) => [...l, { kind: "err", text: res.stderr.trimEnd() }]);
      if (!res.stdout && !res.stderr) {
        setLines((l) => [...l, { kind: "out", text: `(код ${res.code})` }]);
      }
    } catch (e) {
      setLines((l) => [
        ...l,
        { kind: "err", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function recall(dir: 1 | -1) {
    const h = history.current;
    if (!h.length) return;
    histPos.current = Math.max(-1, Math.min(h.length - 1, histPos.current + dir));
    setCmd(histPos.current === -1 ? "" : h[histPos.current]);
  }

  return (
    <div className="terminal">
      <div className="term-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <IconTerminal size={15} /> Терминал{cwd ? ` — ${cwd}` : ""}
        </span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => setLines([])} title="Очистить">
          <IconTrash size={15} />
        </button>
        <button className="icon-btn" onClick={onClose} title="Закрыть">
          <IconX size={15} />
        </button>
      </div>
      <div className="term-log" ref={logRef}>
        {lines.map((ln, i) => (
          <div key={i} className={`term-line ${ln.kind}`}>
            {ln.kind === "cmd" ? `${ln.cwd} $ ${ln.text}` : ln.text}
          </div>
        ))}
        {busy && <div className="term-line out">…</div>}
      </div>
      <div className="term-input">
        <span className="prompt">$</span>
        <input
          value={cmd}
          autoFocus
          spellCheck={false}
          placeholder="команда…"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
            else if (e.key === "ArrowUp") {
              e.preventDefault();
              recall(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              recall(-1);
            }
          }}
        />
      </div>
    </div>
  );
}
