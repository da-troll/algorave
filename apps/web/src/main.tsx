import "./index.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, TooltipProvider } from "@trollefsen-labs/components-react";
import { AppTheme } from "@agent-gateway/ui-theme";
import { registerPanel } from "@agent-gateway/ui-agent-shell";
import { client, PROJECT_REPO } from "./api.ts";
import { Home } from "./Home.tsx";
import { SongPage } from "./Song.tsx";

// Project panels, registered with the shell's registry (GW-PLAN 12.3).
for (const [id, title] of [["repl", "REPL"], ["timeline", "Timeline"], ["visuals", "Visuals"], ["path", "Guided Path"], ["genres", "Genres"], ["record", "Record"]] as const) {
  registerPanel({ id, title, component: () => null });
}

function useRoute(): [string, (to: string) => void] {
  const get = () => location.hash.replace(/^#/, "") || "/";
  const [r, setR] = useState(get);
  useEffect(() => { const f = () => setR(get()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return [r, (to) => { location.hash = to; }];
}

function App() {
  const [route, navigate] = useRoute();
  const [cfg, setCfg] = useState<{ models: string[]; defaultModel: string } | null>(null);
  useEffect(() => { void client.config.ui().then((c) => setCfg(c as unknown as { models: string[]; defaultModel: string })).catch(() => setCfg({ models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" })); }, []);
  const m = /^\/song\/([a-z0-9-]+)/.exec(route);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {m && cfg ? <SongPage key={m[1]} slug={m[1]!} models={cfg.models} defaultModel={cfg.defaultModel} navigate={navigate} /> : <Home navigate={navigate} />}
      </div>
      <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-1 text-[10px] text-[var(--text-muted)]">
        Built on <a className="text-[var(--link)]" href="https://strudel.cc" target="_blank" rel="noreferrer">Strudel</a> (AGPL-3.0, <a className="text-[var(--link)]" href="https://codeberg.org/uzu/strudel" target="_blank" rel="noreferrer">source</a>) and Hydra. Algorave Room is AGPL-3.0: <a className="text-[var(--link)]" href={PROJECT_REPO} target="_blank" rel="noreferrer">source</a>.
      </footer>
      <Toaster position="bottom-right" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppTheme flavor="mocha" accent="mauve" initial="dark">
      <TooltipProvider><App /></TooltipProvider>
    </AppTheme>
  </StrictMode>,
);
