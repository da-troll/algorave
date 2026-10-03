import type { ReactNode } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from "@trollefsen-labs/components-react";
import { Moon, Sun, Palette, AudioWaveform, GitBranch } from "lucide-react";
import { StatusBadge } from "@agent-gateway/ui-agent-shell";
import { ACCENT_OPTIONS, FLAVOR_OPTIONS, useAppTheme } from "@agent-gateway/ui-theme";
import type { ConnectionState } from "@agent-gateway/sdk";

export function ThemeControls() {
  const { theme, toggle, flavor, setFlavor, accent, setAccent } = useAppTheme();
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Flavor and accent" title="Flavor and accent"><Palette /></Button></PopoverTrigger>
        <PopoverContent className="w-64 text-xs">
          {theme === "dark" && (
            <div className="mb-2">
              <p className="mb-1 text-[var(--text-muted)]">Dark flavor (light is always Latte)</p>
              <div className="flex gap-1">{FLAVOR_OPTIONS.map((f) => <button key={f} onClick={() => setFlavor(f)} className={cn("rounded-md border px-2 py-0.5", flavor === f ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-secondary)]")}>{f}</button>)}</div>
            </div>
          )}
          <p className="mb-1 text-[var(--text-muted)]">Accent</p>
          <div className="flex flex-wrap gap-1">{ACCENT_OPTIONS.map((a) => <button key={a} onClick={() => setAccent(a)} className={cn("rounded-md border px-1.5 py-0.5", accent === a ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-secondary)]")}>{a}</button>)}</div>
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" onClick={toggle} aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"} title={theme === "dark" ? "Light (Latte)" : "Dark (Mocha)"} data-testid="theme-toggle">{theme === "dark" ? <Sun /> : <Moon />}</Button>
    </div>
  );
}

export function Header({ title, onHome, meta, session, conn, lastSeq, right }: {
  title: string; onHome: () => void; meta?: { branch: string; bpm: number; key: string }; session?: { status: string; model?: string };
  conn?: ConnectionState; lastSeq?: number; right?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-1.5">
      <button onClick={onHome} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--heading-color)]" aria-label="Home"><AudioWaveform className="size-4 text-[var(--accent)]" />Algorave</button>
      <span className="text-[var(--text-muted)]">/</span>
      <h1 className="max-w-[40vw] truncate text-sm font-medium text-[var(--text-primary)]" data-testid="song-title">{title}</h1>
      {meta && (
        <div className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1"><GitBranch className="size-3" />{meta.branch}</span>
          <span>{meta.bpm} bpm</span><span>{meta.key}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {session && <StatusBadge entity="session" value={session.status}>{session.status}</StatusBadge>}
        {conn && <StatusBadge entity="connection" value={conn === "connecting" ? "reconnecting" : conn}>{conn}</StatusBadge>}
        {lastSeq !== undefined && conn && <span className="hidden font-mono text-[10px] text-[var(--text-muted)] sm:inline">seq {lastSeq}</span>}
        {right}
        <ThemeControls />
      </div>
    </header>
  );
}
