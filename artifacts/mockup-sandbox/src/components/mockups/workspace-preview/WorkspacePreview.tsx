import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  FileCode2,
  FileWarning,
  Globe2,
  Maximize2,
  MousePointer2,
  RefreshCw,
  ScanLine,
  Search,
  Server,
  Terminal,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

type ViewMode = "sandbox" | "web";
type LogKind = "NET" | "JS" | "PY3" | "CSS" | "HTML";

type LogEntry = {
  id: string;
  kind: LogKind;
  file: string;
  line: number;
  title: string;
  detail: string[];
  severity: "error" | "warning" | "info";
};

const initialLogs: LogEntry[] = [
  {
    id: "net-texture",
    kind: "NET",
    file: "assets/texture_02.png",
    line: 0,
    title: "failed to fetch asset",
    detail: [
      "GET /assets/texture_02.png 404 (Not Found)",
      "The game requested an asset that is not available",
      "in the collected workspace.",
    ],
    severity: "warning",
  },
  {
    id: "js-player",
    kind: "JS",
    file: "main.js",
    line: 42,
    title: "cannot read property 'x' of undefined",
    detail: [
      "TypeError: cannot read property 'x' of undefined",
      "  at updatePlayer (main.js:42:18)",
      "  at gameLoop (main.js:12:5)",
    ],
    severity: "error",
  },
  {
    id: "py3-numpy",
    kind: "PY3",
    file: "server.py",
    line: 7,
    title: "ModuleNotFoundError: numpy",
    detail: [
      "Traceback (most recent call last):",
      '  File "server.py", line 7, in <module>',
      "ModuleNotFoundError: No module named 'numpy'",
    ],
    severity: "error",
  },
  {
    id: "css-gap",
    kind: "CSS",
    file: "style.css",
    line: 118,
    title: "unknown property 'gap'",
    detail: [
      "The legacy renderer does not support the gap property",
      "at style.css:118:3",
      "Try using margin or flex-basis for this target.",
    ],
    severity: "warning",
  },
  {
    id: "html-div",
    kind: "HTML",
    file: "index.html",
    line: 118,
    title: "unclosed tag <div>",
    detail: [
      "Parser stopped at the end of the document",
      "Expected closing tag for <div> opened at line 96",
      "The preview may render with an incomplete layout.",
    ],
    severity: "error",
  },
];

const kindStyles: Record<LogKind, { text: string; bg: string; border: string }> = {
  NET: { text: "#9aa9bb", bg: "rgba(143,163,187,.10)", border: "rgba(143,163,187,.24)" },
  JS: { text: "#ff8478", bg: "rgba(255,107,94,.12)", border: "rgba(255,107,94,.34)" },
  PY3: { text: "#d5a7ff", bg: "rgba(171,120,225,.12)", border: "rgba(171,120,225,.34)" },
  CSS: { text: "#73d6ee", bg: "rgba(68,183,217,.12)", border: "rgba(68,183,217,.34)" },
  HTML: { text: "#ffb86c", bg: "rgba(255,184,108,.12)", border: "rgba(255,184,108,.34)" },
};

function StatusPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono uppercase tracking-[0.12em] ${
        compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1 text-[10px]"
      }`}
      style={{ color: "#63e6c3", borderColor: "rgba(99,230,195,.28)", background: "rgba(99,230,195,.08)" }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: "#63e6c3" }} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "#63e6c3" }} />
      </span>
      Live
    </span>
  );
}

function GamePreview({ webView, reloadTick }: { webView: boolean; reloadTick: number }) {
  return (
    <div
      className={`relative isolate flex min-h-0 flex-1 overflow-hidden rounded-lg border ${
        webView ? "h-full rounded-none border-0" : ""
      }`}
      style={{
        borderColor: "rgba(85,102,120,.42)",
        background: "#081019",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)",
      }}
    >
      <div className="absolute inset-0 opacity-70" style={{ background: "radial-gradient(circle at 72% 25%, rgba(47,107,125,.22), transparent 30%), radial-gradient(circle at 20% 80%, rgba(44,71,104,.20), transparent 34%)" }} />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: "linear-gradient(rgba(100,165,173,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(100,165,173,.08) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          transform: "perspective(300px) rotateX(54deg) scale(1.45) translateY(23%)",
          transformOrigin: "center bottom",
        }}
      />
      <div className="relative flex min-h-[300px] w-full flex-col justify-between p-3 sm:p-5">
        <div className="flex items-start justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-slate-400 sm:text-[10px]">
          <span>ORBIT RUN / BUILD 0.8.14</span>
          <span className="flex items-center gap-1.5 text-[#63e6c3]"><Wifi size={11} /> Connected</span>
        </div>

        <div className="relative flex flex-1 items-center justify-center">
          <div className="absolute h-44 w-44 rounded-full border border-[#39737b]/40 sm:h-64 sm:w-64" />
          <div className="absolute h-32 w-32 rounded-full border border-dashed border-[#3c8490]/50 sm:h-48 sm:w-48" style={{ animation: "orbit-spin 18s linear infinite" }} />
          <div className="absolute h-16 w-16 rounded-full border border-[#7de1c0]/60 sm:h-24 sm:w-24" />
          <div className="absolute h-4 w-4 rounded-full bg-[#63e6c3] shadow-[0_0_28px_rgba(99,230,195,.8)] sm:h-6 sm:w-6" />
          <div className="absolute h-2 w-2 -translate-y-16 rounded-full bg-[#ffb86c] sm:-translate-y-24" />
          <div className="relative flex h-24 w-32 items-end justify-center sm:h-32 sm:w-44">
            <div className="absolute bottom-4 h-16 w-28 rotate-[-9deg] rounded-[45%] border border-[#8be0d2]/60 bg-[linear-gradient(145deg,rgba(129,218,204,.3),rgba(33,62,83,.56))] shadow-[0_14px_35px_rgba(29,161,156,.18)] sm:h-20 sm:w-36" />
            <div className="absolute bottom-9 h-5 w-16 rounded-full border border-[#c3fff0]/50 bg-[#9de7d7]/30 sm:w-20" />
            <div className="absolute bottom-1 flex w-24 justify-between sm:w-28">
              <span className="h-7 w-1 rounded-full bg-[#ffb86c]/80 shadow-[0_0_12px_rgba(255,184,108,.65)]" />
              <span className="h-7 w-1 rounded-full bg-[#ffb86c]/80 shadow-[0_0_12px_rgba(255,184,108,.65)]" />
            </div>
          </div>
          <div className="absolute bottom-4 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-[#63e6c3]/25 blur-sm sm:w-40" />
        </div>

        <div className="flex items-end justify-between font-mono text-[9px] text-slate-400 sm:text-[10px]">
          <div className="space-y-1">
            <div className="text-[#63e6c3]">SECTOR 07 // TRAINING DECK</div>
            <div>OBJECTIVE: REACH THE BEACON</div>
          </div>
          <div className="text-right">
            <div className="text-slate-300">SCORE <span className="text-[#ffb86c]">1,280</span></div>
            <div>SYNC {String(reloadTick).padStart(2, "0")}.04</div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-[#9de7d7]/10" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[#9de7d7]/10" />
    </div>
  );
}

function LogBadge({ kind }: { kind: LogKind }) {
  const style = kindStyles[kind];
  return (
    <span
      className="inline-flex min-w-[38px] justify-center rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.08em]"
      style={{ color: style.text, background: style.bg, border: `1px solid ${style.border}` }}
    >
      {kind}
    </span>
  );
}

export function WorkspacePreview() {
  const [mode, setMode] = useState<ViewMode>("sandbox");
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [selectedId, setSelectedId] = useState("js-player");
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState("Listening for workspace output");
  const [reloadTick, setReloadTick] = useState(14);

  const selectedLog = logs.find((entry) => entry.id === selectedId) ?? logs[0];
  const visibleLogs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return logs;
    return logs.filter((entry) => `${entry.kind} ${entry.file} ${entry.title}`.toLowerCase().includes(needle));
  }, [logs, query]);

  function selectLog(id: string) {
    setSelectedId(id);
    setActivity("Inspecting selected diagnostic");
  }

  function clearLogs() {
    setLogs([]);
    setSelectedId("");
    setActivity("Log buffer cleared");
  }

  function scanErrors() {
    setActivity("Scanning workspace sources…");
    window.setTimeout(() => setActivity("Scan complete · 5 diagnostics found"), 650);
  }

  function reloadPreview() {
    setReloadTick((tick) => (tick + 1) % 100);
    setActivity("Reloading game preview…");
    window.setTimeout(() => setActivity("Preview reloaded · listening for output"), 650);
  }

  return (
    <main
      className="min-h-[100dvh] w-full overflow-hidden p-3 text-slate-200 sm:p-5 lg:p-7"
      style={{
        background: "#0b1016",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        color: "#e3e8ee",
      }}
    >
      <style>{`
        @keyframes orbit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse-soft { 0%,100% { opacity:.55; } 50% { opacity:1; } }
        .workspace-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
        .workspace-scroll::-webkit-scrollbar-thumb { background: #344252; border-radius: 999px; }
        .workspace-scroll::-webkit-scrollbar-track { background: transparent; }
        @media (max-width: 620px) {
          .workspace-split { grid-template-columns: 1fr !important; }
          .workspace-log { max-height: 270px; }
          .workspace-game { min-height: 360px !important; }
        }
      `}</style>

      {mode === "web" ? (
        <section className="flex min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-xl border" style={{ borderColor: "#293541", background: "#111820" }}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: "#293541", background: "#151d26" }}>
            <div className="flex items-center gap-3">
              <button onClick={() => setMode("sandbox")} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-slate-300 transition-colors hover:border-[#63e6c3] hover:text-[#63e6c3]" style={{ borderColor: "#364554", background: "#10161d" }}>
                <ArrowLeft size={14} /> Kembali
              </button>
              <div className="hidden h-5 w-px sm:block" style={{ background: "#344250" }} />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-100"><Globe2 size={15} className="text-[#63e6c3]" /> Web View</div>
                <div className="font-mono text-[10px] text-slate-500">game.local / live render</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">PREVIEW SURFACE · 100%</span>
              <StatusPill />
            </div>
          </header>
          <div className="min-h-0 flex-1 p-2 sm:p-4">
            <GamePreview webView reloadTick={reloadTick} />
          </div>
        </section>
      ) : (
        <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-[1220px] flex-col">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-4 sm:mb-5">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#63e6c3]">
                <span className="h-px w-5 bg-[#63e6c3]" /> Workspace / Preview
              </div>
              <h1 className="text-xl font-semibold tracking-[-0.02em] text-slate-100 sm:text-2xl">Preview &amp; Error Panel</h1>
              <p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-500">Collect, run, and inspect the game without losing the evidence that explains what broke.</p>
            </div>
            <div className="flex items-center gap-2">
              <CircleDot size={13} className="text-[#63e6c3]" />
              <span className="font-mono text-[10px] text-slate-400">{activity}</span>
            </div>
          </header>

          <div className="mb-3 flex flex-wrap gap-2">
            <button onClick={() => setMode("sandbox")} className="flex min-w-[112px] flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors sm:flex-none" style={{ color: "#63e6c3", borderColor: "#63e6c3", background: "rgba(99,230,195,.09)" }}>
              <Terminal size={13} /> Sandbox
            </button>
            <button onClick={() => setMode("web")} className="flex min-w-[112px] flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 sm:flex-none" style={{ borderColor: "#2f3b48", background: "#151c24" }}>
              <Globe2 size={13} /> Web View
            </button>
            <div className="hidden flex-1 sm:block" />
            <button onClick={scanErrors} className="flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#ff8478] transition-colors hover:border-[#ff8478] sm:flex-none" style={{ borderColor: "rgba(255,107,94,.35)", background: "rgba(255,107,94,.07)" }}>
              <ScanLine size={13} /> Scan Error
            </button>
            <button onClick={reloadPreview} className="flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400 transition-colors hover:border-[#63e6c3] hover:text-[#63e6c3] sm:flex-none" style={{ borderColor: "#2f3b48", background: "#151c24" }}>
              <RefreshCw size={13} /> Reload
            </button>
          </div>

          <section className="workspace-split grid min-h-0 flex-1 overflow-hidden rounded-t-xl border" style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(250px, 3fr)", borderColor: "#2b3845", background: "#111820" }}>
            <div className="workspace-game flex min-h-[420px] min-w-0 flex-col border-r p-3 sm:p-4" style={{ borderColor: "#2b3845", background: "#151d26" }}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <Activity size={13} className="shrink-0 text-[#63e6c3]" />
                  <span className="truncate">70% · Game Preview Surface</span>
                </div>
                <StatusPill compact />
              </div>
              <GamePreview webView={false} reloadTick={reloadTick} />
              <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[10px] text-slate-500">
                <span className="flex items-center gap-1.5"><MousePointer2 size={12} /> Input connected</span>
                <button onClick={() => setMode("web")} className="flex items-center gap-1 text-slate-400 transition-colors hover:text-[#63e6c3]">Open Web View <Maximize2 size={12} /></button>
              </div>
            </div>

            <aside className="workspace-log flex min-h-0 min-w-0 flex-col p-3 sm:p-4" style={{ background: "#10161d" }}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500"><Server size={13} className="text-[#63e6c3]" /> Diagnostics</div>
                  <div className="mt-1 text-xs text-slate-300"><span className="text-[#ff8478]">{logs.length}</span> entries · network + source</div>
                </div>
                <button aria-label="Clear logs" title="Clear logs" onClick={clearLogs} className="rounded p-1.5 text-slate-500 transition-colors hover:bg-[#1b2631] hover:text-[#ff8478]"><Trash2 size={14} /></button>
              </div>
              <label className="mb-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-slate-500" style={{ borderColor: "#2b3845", background: "#0c1218" }}>
                <Search size={13} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter logs..." className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-slate-200 outline-none placeholder:text-slate-600" />
                {query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={12} /></button>}
              </label>
              <div className="workspace-scroll min-h-0 flex-1 overflow-y-auto pr-1">
                {visibleLogs.length ? visibleLogs.map((entry) => {
                  const selected = entry.id === selectedId;
                  return (
                    <button key={entry.id} onClick={() => selectLog(entry.id)} className="group flex w-full items-start gap-2 border-b px-1 py-2.5 text-left transition-colors" style={{ borderColor: "rgba(47,59,72,.55)", background: selected ? "rgba(99,230,195,.07)" : "transparent" }}>
                      <LogBadge kind={entry.kind} />
                      <span className="min-w-0 flex-1 font-mono text-[10px] leading-4">
                        <span className={`block break-words ${entry.severity === "error" ? "text-[#ff8478]" : "text-slate-400"}`}>{entry.title}</span>
                        <span className="mt-0.5 block truncate text-slate-600">{entry.file}{entry.line ? `:${entry.line}` : ""}</span>
                      </span>
                      <ChevronRight size={13} className={`mt-1 shrink-0 transition-colors ${selected ? "text-[#63e6c3]" : "text-slate-700 group-hover:text-slate-400"}`} />
                    </button>
                  );
                }) : (
                  <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center" style={{ borderColor: "#2b3845", color: "#667482" }}>
                    <Check size={18} className="text-[#63e6c3]" />
                    <span className="font-mono text-[10px]">No diagnostics in buffer</span>
                  </div>
                )}
              </div>
            </aside>
          </section>

          <section className="rounded-b-xl border border-t-0 p-3 sm:p-4" style={{ borderColor: "#2b3845", background: "#10161d" }}>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500"><FileWarning size={13} className="text-[#ff8478]" /> Selected diagnostic</div>
              {selectedLog && <span className="font-mono text-[10px] text-slate-600">{selectedLog.kind} · line {selectedLog.line || "—"}</span>}
            </div>
            {selectedLog ? (
              <>
                <div className="workspace-scroll max-h-28 overflow-y-auto rounded-lg border p-3 font-mono text-[10px] leading-5 sm:text-[11px]" style={{ borderColor: "#2b3845", background: "#0b1117", color: "#8d9aaa" }}>
                  {selectedLog.detail.map((line, index) => <div key={`${selectedLog.id}-${index}`} className={index === 0 ? "text-[#ffb0a8]" : ""}>{line}</div>)}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-2 font-mono text-[10px] text-slate-400" style={{ borderColor: "#2b3845", background: "#151d26" }}>
                    <FileCode2 size={13} className="shrink-0 text-[#63e6c3]" />
                    <span className="truncate">{selectedLog.file}</span>
                    {selectedLog.line > 0 && <span className="shrink-0 text-slate-600">:{selectedLog.line}</span>}
                  </div>
                  <button onClick={() => setActivity(`Opening ${selectedLog.file}:${selectedLog.line || 1}`)} className="rounded-md border px-3 py-2 font-mono text-[10px] text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200" style={{ borderColor: "#2b3845", background: "#151d26" }}>Custom</button>
                  <button onClick={() => setActivity("Preparing AI diagnosis…")} className="flex items-center gap-1.5 rounded-md border px-3 py-2 font-mono text-[10px] font-semibold text-[#63e6c3] transition-colors hover:bg-[#63e6c3]/10" style={{ borderColor: "rgba(99,230,195,.45)", background: "rgba(99,230,195,.07)" }}><Code2 size={13} /> AI inspect</button>
                </div>
              </>
            ) : (
              <div className="flex min-h-24 items-center gap-2 rounded-lg border border-dashed px-3 font-mono text-[10px] text-slate-600" style={{ borderColor: "#2b3845" }}>Select a log entry to inspect its evidence.</div>
            )}
          </section>

          <footer className="mt-4 flex items-start gap-3 border-l-2 pl-3 font-mono text-[10px] leading-5 text-slate-600" style={{ borderColor: "#2b3845" }}>
            <AlertTriangle size={13} className="mt-1 shrink-0 text-slate-500" />
            <span>Collection flow: download game → replace endpoint → host locally → modify → inspect the evidence left by the runtime.</span>
          </footer>
        </div>
      )}
    </main>
  );
}