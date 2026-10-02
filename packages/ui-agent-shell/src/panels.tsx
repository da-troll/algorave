// Stock panels (GW-PLAN 12): Conversation, Activity, Review, Terminal,
// SessionHeader, and the project-panel registry. No ThemeRoot, no useTheme,
// no attributes on <html> (the host owns theming).
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Badge, Button, Textarea, cn } from "@trollefsen-labs/components-react";
import { Ban, CircleStop, Hammer, Send, Wrench, CheckCircle2, AlertTriangle, Terminal as TermIcon, ShieldX, GitCommitHorizontal } from "lucide-react";
import type { AgentEvent } from "@agent-gateway/protocol";
import { diffClasses, terminalTheme, tone, toneClasses, toneText, watchTheme } from "@agent-gateway/ui-theme";
import type { ChatItem, SessionHandle } from "./state.ts";

// ---------- registry ----------
export type PanelDef = { id: string; title: string; icon?: ComponentType<{ className?: string }>; component: ComponentType<Record<string, unknown>>; requiresFiles?: boolean };
const registry = new Map<string, PanelDef>();
export function registerPanel(p: PanelDef) { registry.set(p.id, p); }
export function getPanels(ids?: string[]): PanelDef[] { return ids ? ids.map((i) => registry.get(i)).filter((x): x is PanelDef => !!x) : [...registry.values()]; }

export function StatusBadge({ entity, value, children, className }: { entity: Parameters<typeof tone>[0]; value: string; children?: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4", toneClasses(tone(entity, value)), className)}>{children ?? value}</span>;
}

export function prettyTool(name: string): string {
  if (name.startsWith("mcp__ears__")) return `ears · ${name.slice(11).replace(/_/g, " ")}`;
  return name;
}
function toolTarget(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const p = (i.file_path ?? i.path ?? i.pattern ?? i.skill ?? "") as string;
  return typeof p === "string" ? p.replace(/^.*\/songs\/[^/]+\//, "") : "";
}

// ---------- Conversation ----------
export function ConversationPanel({ handle, onSend, onInterrupt, disabledReason, placeholder, draft, setDraft, footer }: {
  handle: SessionHandle; onSend: (text: string) => void; onInterrupt: () => void; disabledReason?: string | null; placeholder?: string;
  draft: string; setDraft: (s: string) => void; footer?: ReactNode;
}) {
  const { state } = handle;
  const end = useRef<HTMLDivElement>(null);
  const running = !!state.runningTurnId;
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [state.items.length, state.items[state.items.length - 1]]);
  const send = () => { const t = draft.trim(); if (!t || running || disabledReason) return; onSend(t); };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-testid="conversation">
        {state.items.length === 0 && <p className="text-sm text-[var(--text-muted)]">Tell the producer what you want to hear. Every turn is checked by the ears and committed.</p>}
        <div className="flex flex-col gap-2">
          {state.items.map((it) => <ChatRow key={it.id} it={it} />)}
        </div>
        {running && <div className="mt-2 flex items-center gap-2 text-xs text-[var(--info-fg)]"><span className="size-2 animate-pulse rounded-full bg-[var(--info)]" />working</div>}
        <div ref={end} />
      </div>
      <div className="border-t border-[var(--border-subtle)] p-2">
        {disabledReason && <p className="mb-1 text-xs text-[var(--warning-fg)]">{disabledReason}</p>}
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Prompt" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={placeholder ?? "Make the bass duck under the kick…"}
            className="min-h-[2.75rem] resize-none text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          {running ? (
            <Button variant="destructive" size="icon" aria-label="Interrupt" title="Interrupt" onClick={onInterrupt}><CircleStop /></Button>
          ) : (
            <Button size="icon" aria-label="Send" title="Send" onClick={send} disabled={!draft.trim() || !!disabledReason}><Send /></Button>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}

function ChatRow({ it }: { it: ChatItem }) {
  if (it.kind === "message") {
    const user = it.role === "user";
    return (
      <div className={cn("max-w-[92%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed", user ? "self-end border border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-primary)]" : "self-start border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)]")} data-role={it.role}>
        {user ? it.text : <Markdownish text={it.text} />}{it.streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[var(--text-muted)] align-middle" />}
      </div>
    );
  }
  if (it.kind === "tool") {
    const t = toolTarget(it.input);
    return (
      <div className="self-start flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]" data-tool={it.name}>
        {it.isError ? <ShieldX className="size-3.5 text-[var(--error)]" /> : it.done ? <Wrench className="size-3.5 text-[var(--text-muted)]" /> : <Hammer className="size-3.5 animate-pulse text-[var(--info)]" />}
        <span>{prettyTool(it.name)}</span>{t && <span className="text-[var(--text-muted)]">{t}</span>}
        {it.isError && <span className="text-[var(--error-fg)]">refused</span>}
      </div>
    );
  }
  if (it.kind === "check") {
    const v = it.ok ? "ok" : /^CHECK FAILED/.test(it.body) ? "failed" : "problems";
    return (
      <details className="self-start max-w-[92%] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 py-1 text-xs" data-check={v}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5">
          {it.ok ? <CheckCircle2 className="size-3.5 text-[var(--success)]" /> : <AlertTriangle className="size-3.5 text-[var(--warning)]" />}
          <span className={toneText(tone("check", v))}>ears: {it.body.split("\n")[0]}</span>
        </summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-[11px] leading-4 text-[var(--text-secondary)]">{it.body}</pre>
      </details>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
      <span className="h-px flex-1 bg-[var(--border-subtle)]" />
      <StatusBadge entity="turn" value={it.outcome}>turn {it.outcome}</StatusBadge>
      {it.detail && <span className="max-w-[60%] truncate" title={it.detail}>{it.detail}</span>}
      <span className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  );
}

/** Minimal, injection-safe markdown: paragraphs, "- " bullets, **bold**, `code`. No HTML is ever parsed. */
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, i) =>
    seg.startsWith("**") && seg.endsWith("**") ? <strong key={i} className="font-semibold">{seg.slice(2, -2)}</strong>
      : seg.startsWith("`") && seg.endsWith("`") ? <code key={i} className="rounded bg-[var(--surface-sunken)] px-1 font-mono text-[0.9em]">{seg.slice(1, -1)}</code>
      : seg);
}
export function Markdownish({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={i} className="my-1 list-disc pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
        return <p key={i} className="my-1 first:mt-0 last:mb-0">{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
      })}
    </>
  );
}

// ---------- Activity ----------
const FILTERS = ["all", "tools", "checks", "turns", "denials", "system"] as const;
function activityKind(e: AgentEvent): (typeof FILTERS)[number] {
  if (e.type.startsWith("tool.")) return "tools";
  if (e.type === "artifact.created") return e.payload.artifact.pathOrUrl === "ears://strudel_check" ? "checks" : "system";
  if (e.type.startsWith("turn.") || e.type === "usage.updated") return "turns";
  if (e.type.startsWith("approval.")) return "denials";
  return "system";
}
function activityLine(e: AgentEvent): { badge: string; t: ReturnType<typeof tone>; text: string; body?: string } {
  switch (e.type) {
    case "tool.started": return { badge: "tool", t: "info", text: `${prettyTool(e.payload.name)} ${toolTarget(e.payload.input)}` };
    case "tool.completed": return { badge: e.payload.isError ? "tool error" : "tool done", t: e.payload.isError ? "error" : "neutral", text: e.payload.toolUseId.slice(-8) };
    case "approval.resolved": return { badge: `${e.payload.decision}`, t: tone("approval", e.payload.decision), text: e.payload.reason ?? e.payload.toolName ?? "" };
    case "approval.requested": return { badge: "approval", t: "warning", text: e.payload.approval.commandOrTool };
    case "turn.started": return { badge: "turn", t: "info", text: e.payload.input.slice(0, 120) };
    case "turn.completed": return { badge: "completed", t: "success", text: (e.payload.result ?? "").slice(0, 140) };
    case "turn.failed": return { badge: "failed", t: "error", text: e.payload.error };
    case "turn.interrupted": return { badge: "interrupted", t: "warning", text: e.payload.reason };
    case "session.status": return { badge: e.payload.status, t: tone("session", e.payload.status), text: `${e.payload.reason}${e.payload.detail ? `: ${e.payload.detail}` : ""}` };
    case "artifact.created": {
      const check = e.payload.artifact.pathOrUrl === "ears://strudel_check";
      return { badge: check ? "ears" : e.payload.artifact.kind, t: check ? (e.payload.ok ? "success" : "warning") : e.payload.ok === false ? "error" : "neutral", text: e.payload.summary ?? e.payload.artifact.title ?? "", body: e.payload.body };
    }
    case "usage.updated": return { badge: "usage", t: "neutral", text: `${e.payload.inputTokens} in · ${e.payload.outputTokens} out${e.payload.costUsd ? ` · $${e.payload.costUsd.toFixed(3)}` : ""}${e.payload.durationMs ? ` · ${(e.payload.durationMs / 1000).toFixed(1)}s` : ""}` };
    case "file.changed": return { badge: "files", t: "neutral", text: e.payload.paths.join(", ") || "clean" };
    default: return { badge: e.type, t: "neutral", text: "" };
  }
}
export function ActivityPanel({ handle, enforcement }: { handle: SessionHandle; enforcement?: string }) {
  const [f, setF] = useState<(typeof FILTERS)[number]>("all");
  const rows = useMemo(() => handle.state.activity.filter((e) => f === "all" || activityKind(e) === f), [handle.state.activity, f]);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="activity">
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5">
        {FILTERS.map((x) => (
          <button key={x} onClick={() => setF(x)} className={cn("rounded-md px-2 py-0.5 text-xs", f === x ? "bg-[var(--surface-selected)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]")}>{x}</button>
        ))}
        {enforcement && <span className="ml-auto text-[11px] text-[var(--text-muted)]" title={enforcement}>enforcement: adapter tool permissions · ears sandbox</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px]">
        {rows.length === 0 && <p className="p-2 font-sans text-xs text-[var(--text-muted)]">Nothing yet.</p>}
        {rows.slice().reverse().map((e) => {
          const l = activityLine(e);
          return (
            <div key={e.id} className="flex items-start gap-2 border-b border-[var(--border-subtle)] py-1" data-activity={e.type}>
              <span className="w-10 shrink-0 text-right text-[var(--text-muted)]">{e.seq}</span>
              <span className={cn("shrink-0 rounded border px-1.5 leading-4", toneClasses(l.t))}>{l.badge}</span>
              {l.body ? (
                <details className="min-w-0 flex-1"><summary className="cursor-pointer truncate text-[var(--text-secondary)]">{l.text}</summary><pre className="whitespace-pre-wrap text-[var(--text-secondary)]">{l.body}</pre></details>
              ) : <span className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">{l.text}</span>}
              <span className="shrink-0 text-[var(--text-muted)]">{new Date(e.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Review ----------
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  return (
    <pre className={cn("overflow-auto bg-[var(--surface-sunken)] p-2 font-mono text-[11px] leading-4", className)} data-testid="diff">
      {diff.split("\n").map((l, i) => <div key={i} className={diffClasses(l)}>{l || " "}</div>)}
    </pre>
  );
}
export function ReviewPanel({ handle }: { handle: SessionHandle }) {
  const d = handle.state.diff;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="review">
      <div className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs">
        {!d || d.files.length === 0 ? <span className="text-[var(--text-muted)]">Working tree clean: every turn is committed (see Timeline).</span> :
          d.files.map((f) => <span key={f.path} className="rounded border border-[var(--border)] px-1.5 font-mono text-[11px] text-[var(--text-secondary)]">{f.status} {f.path}</span>)}
      </div>
      {d && d.diff && <DiffView diff={d.diff} className="min-h-0 flex-1" />}
      {d?.truncated && <p className="px-2 text-[11px] text-[var(--warning-fg)]">diff truncated</p>}
    </div>
  );
}

// ---------- Terminal ----------
export function TerminalPanel({ handle, sessionId, claim, live }: { handle: SessionHandle; sessionId: string; claim: (steal: boolean) => Promise<number>; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [gen, setGen] = useState<number | null>(null);
  const [owner, setOwner] = useState<"writer" | "observer">("observer");
  const [err, setErr] = useState<string | null>(null);
  const genRef = useRef<number | null>(null);
  genRef.current = gen;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      await document.fonts.load("13px 'JetBrains Mono'").catch(() => {});
      if (disposed || !host.current) return;
      const term = new Terminal({ fontFamily: "'JetBrains Mono', ui-monospace, monospace" /* xterm measures on a canvas: no var() */, fontSize: 13, theme: terminalTheme(), cursorBlink: true, allowProposedApi: true, scrollback: 2000 });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      try { fit.fit(); } catch { /* hidden */ }
      const unTheme = watchTheme(() => { term.options.theme = terminalTheme(); });
      const unTerm = handle.onTerminal((m) => {
        if (m.type === "terminal.snapshot") { term.reset(); term.resize(m.cols, m.rows); term.write(m.state); }
        else if (m.type === "terminal.resize") term.resize(m.cols, m.rows);
        else term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
      });
      const onData = term.onData((data) => {
        if (genRef.current === null) return;
        try { handle.send({ type: "terminal.input", inputId: crypto.randomUUID(), ownershipGeneration: genRef.current, data }); } catch { setErr("not connected; input was NOT sent"); }
      });
      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { return; }
        if (genRef.current !== null) { try { handle.send({ type: "terminal.resize", requestId: crypto.randomUUID(), ownershipGeneration: genRef.current, cols: term.cols, rows: term.rows }); } catch { /* offline */ } }
      });
      ro.observe(host.current);
      cleanup = () => { ro.disconnect(); onData.dispose(); unTerm(); unTheme(); term.dispose(); };
    })();
    return () => { disposed = true; cleanup(); };
  }, [handle.onTerminal, sessionId]);

  const take = async (steal: boolean) => {
    try { const g = await claim(steal); setGen(g); setOwner("writer"); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (live) void take(false); }, [live, sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="terminal">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-2 py-1 text-xs">
        <TermIcon className="size-3.5 text-[var(--text-muted)]" />
        <span className="text-[var(--text-secondary)]">claude in the song repo · no shell</span>
        <StatusBadge entity="session" value={live ? "running" : "stopped"}>{live ? owner : "ended"}</StatusBadge>
        {live && owner === "observer" && <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { if (confirm("Take control of this terminal from the other tab?")) void take(true); }}>Take control</Button>}
        {err && <span className="text-[var(--error-fg)]">{err}</span>}
      </div>
      <div ref={host} className="min-h-0 flex-1 bg-[var(--surface-sunken)] p-1" />
    </div>
  );
}

export { Badge, Ban, GitCommitHorizontal };
