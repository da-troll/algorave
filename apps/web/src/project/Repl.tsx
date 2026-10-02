// REPL panel: the heart. The StrudelMirror always holds what PLAYS. Part tabs
// edit one file in a small CodeMirror; "Try" plays it unsaved, "Keep" commits it
// as Daniel (PUT /files, refused while an agent turn runs).
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, cn, toast } from "@trollefsen-labs/components-react";
import { Play, Square, Save, FlaskConical, Undo2, Repeat, Clock3, BarChart3 } from "lucide-react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { compileFiles } from "@algorave/ears/compile-core";
import { StatusBadge } from "@agent-gateway/ui-agent-shell";
import { api, type SongDetail } from "../api.ts";
import { engine, type ApplyMode, type EngineState } from "./engine.ts";
import { tokenEditorTheme } from "./cmTheme.ts";

export function useEngine(): EngineState {
  const [s, setS] = useState(engine.state);
  useEffect(() => engine.on(setS), []);
  return s;
}

/** Song code with an optional pianoroll/punchcard painter, applied via all() so the final expression stays the song. */
export function withVisual(code: string, visual: "none" | "pianoroll" | "punchcard"): string {
  if (visual === "none") return code;
  const lines = code.split("\n");
  // .punchcard() is the PAINTER form: it draws into the REPL panel's own canvas. .pianoroll()
  // defaults its ctx to Strudel's global full-screen canvas and would paint over the page.
  const fn = visual === "pianoroll" ? "punchcard({ fold: 1, labels: false, cycles: 4, playhead: 0.5 })" : "punchcard({ fold: 0, cycles: 2, playhead: 0 })";
  lines.splice(2, 0, `all(x => x.${fn}) // visual: ${visual === "pianoroll" ? "punchcard roll" : "punchcard grid"} (not part of the song)`);
  return lines.join("\n");
}

type View = "song" | `part:${string}` | "arrange" | "song.json";

export function ReplPanel({ slug, detail, onSaved, ab, setAb, applyMode, setApplyMode, visual, setVisual, songCode }: {
  slug: string; detail: SongDetail | null; onSaved: () => void; songCode: string;
  ab: { a?: { sha: string; code: string }; b?: { sha: string; code: string }; active: "a" | "b" | null }; setAb: (x: { a?: { sha: string; code: string }; b?: { sha: string; code: string }; active: "a" | "b" | null }) => void;
  applyMode: ApplyMode; setApplyMode: (m: ApplyMode) => void; visual: "none" | "pianoroll" | "punchcard"; setVisual: (v: "none" | "pianoroll" | "punchcard") => void;
}) {
  const st = useEngine();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>("song");
  useEffect(() => { if (root.current && canvas.current) engine.mount(root.current, canvas.current); }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => { c.width = c.clientWidth * devicePixelRatio; c.height = c.clientHeight * devicePixelRatio; });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const parts = detail ? Object.keys(detail.parts) : [];
  const fileFor = (v: View): { path: string; content: string } | null => {
    if (!detail) return null;
    if (v.startsWith("part:")) { const p = v.slice(5); return { path: `parts/${p}.js`, content: detail.parts[p] ?? "" }; }
    if (v === "arrange") return { path: "arrange.js", content: detail.arrange };
    if (v === "song.json") return { path: "song.json", content: JSON.stringify(detail.meta, null, 2) };
    return null;
  };
  const file = fileFor(view);
  const playing = st.playing;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="repl">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1.5">
        {playing ? (
          <Button size="sm" variant="secondary" onClick={() => engine.stop()} aria-label="Stop"><Square />Stop</Button>
        ) : (
          <Button size="sm" onClick={() => void engine.play()} disabled={!st.ready} aria-label="Play"><Play />{st.ready ? "Play" : "Loading sounds"}</Button>
        )}
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]" title="When agent changes reach the player">
          <Clock3 className="size-3.5" />
          <select aria-label="Apply changes" value={applyMode} onChange={(e) => setApplyMode(e.target.value as ApplyMode)} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 text-xs text-[var(--text-primary)]">
            <option value="bar">next bar</option><option value="4bars">next 4 bars</option><option value="now">now</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <BarChart3 className="size-3.5" />
          <select aria-label="Visual feedback" value={visual} onChange={(e) => setVisual(e.target.value as "none")} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 text-xs text-[var(--text-primary)]">
            <option value="pianoroll">punchcard roll</option><option value="punchcard">punchcard grid</option><option value="none">no visual</option>
          </select>
        </label>
        {st.pending && <span data-testid="pending-pill" className="inline-flex items-center gap-1 rounded-full border border-[var(--info-border)] bg-[var(--info-bg)] px-2 py-0.5 text-[11px] text-[var(--info-fg)]"><span className="size-1.5 animate-pulse rounded-full bg-[var(--info)]" />{st.pending.label}: applies on bar {Math.floor(st.pending.at) + 1}</span>}
        {st.scratch && <StatusBadge entity="session" value="interrupted">unsaved scratch</StatusBadge>}
        {playing && <span className="ml-auto font-mono text-[11px] text-[var(--text-muted)]">bar {Math.floor(st.cycle) + 1}</span>}
      </div>
      {(ab.a || ab.b) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1 text-xs">
          <span className="text-[var(--text-muted)]">Compare</span>
          {(["a", "b"] as const).map((k) => ab[k] && (
            <button key={k} onClick={() => { engine.apply(withVisual(ab[k]!.code, visual), `${k.toUpperCase()} ${ab[k]!.sha.slice(0, 7)}`, playing ? applyMode : "now"); setAb({ ...ab, active: k }); }}
              className={cn("rounded-md border px-2 py-0.5 font-mono", ab.active === k ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-secondary)]")} data-testid={`ab-${k}`}>
              {k.toUpperCase()} {ab[k]!.sha.slice(0, 7)}
            </button>
          ))}
          {ab.a && ab.b && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { const n = ab.active === "a" ? "b" : "a"; engine.apply(withVisual(ab[n]!.code, visual), `${n.toUpperCase()} ${ab[n]!.sha.slice(0, 7)}`, playing ? applyMode : "now"); setAb({ ...ab, active: n }); }}><Repeat />Swap</Button>}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setAb({ active: null }); engine.apply(withVisual(songCode, visual), "back to HEAD", playing ? applyMode : "now"); }}>Back to HEAD</Button>
        </div>
      )}
      <div className="flex gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] px-1 pt-1 text-xs">
        {(["song", ...parts.map((p) => `part:${p}`), "arrange", "song.json"] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} className={cn("shrink-0 rounded-t-md px-2.5 py-1 font-mono", view === v ? "bg-[var(--surface-sunken)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]")}>
            {v === "song" ? "song (plays)" : v.startsWith("part:") ? `${v.slice(5)}.js` : v === "arrange" ? "arrange.js" : v}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn("repl-root absolute inset-x-0 top-0 overflow-hidden", visual === "none" ? "bottom-0" : "bottom-20", view !== "song" && "invisible")} ref={root} data-testid="repl-editor" />
        <canvas ref={canvas} className={cn("pointer-events-none absolute bottom-0 left-0 right-0 h-20 w-full border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)]", (view !== "song" || visual === "none") && "hidden")} />
        {file && detail && <PartEditor key={`${view}:${detail.head}`} slug={slug} file={file} head={detail.head} turnRunning={detail.turnRunning} detail={detail} visual={visual} onSaved={onSaved} />}
      </div>
      {(st.evalError || st.schedulerError) && (
        <div className="border-t border-[var(--error-border)] bg-[var(--error-bg)] px-2 py-1 font-mono text-[11px] text-[var(--error-fg)]" data-testid="eval-error">
          {st.evalError ?? st.schedulerError} · the previous pattern keeps playing
        </div>
      )}
      <p className="border-t border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-muted)]">Ctrl+Enter evaluates the song view as an unsaved scratch. Agent changes arrive after each turn's commit.</p>
    </div>
  );
}

function PartEditor({ slug, file, head, turnRunning, detail, visual, onSaved }: { slug: string; file: { path: string; content: string }; head: string; turnRunning: boolean; detail: SongDetail; visual: "none" | "pianoroll" | "punchcard"; onSaved: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: file.content,
        extensions: [lineNumbers(), history(), javascript(), keymap.of([...defaultKeymap, ...historyKeymap]), tokenEditorTheme(), EditorView.updateListener.of((u) => { if (u.docChanged) setDirty(u.state.doc.toString() !== file.content); })],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [file.content]);
  const current = () => view.current?.state.doc.toString() ?? file.content;
  const compiledWith = useMemo(() => () => {
    const parts = { ...detail.parts };
    let arrange = detail.arrange;
    let songJson = JSON.stringify(detail.meta);
    if (file.path.startsWith("parts/")) parts[file.path.slice(6, -3)] = current();
    else if (file.path === "arrange.js") arrange = current();
    else songJson = current();
    return compileFiles({ parts, arrange, songJson }).code;
  }, [detail, file.path]);
  const tryIt = () => {
    try {
      const code = withVisual(compiledWith(), visual);
      const err = engine.check(code);
      if (err) { toast.error(`Does not parse: ${err}`); return; }
      engine.setCode(code, true);
      void engine.evaluate();
    } catch (e) { toast.error((e as Error).message); }
  };
  const keep = async () => {
    setBusy(true);
    try {
      await api("PUT", `/api/songs/${slug}/files`, { path: file.path, content: current(), baseCommit: head });
      toast.success(`Committed ${file.path} as Daniel`);
      setDirty(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="absolute inset-0 flex flex-col bg-[var(--surface-sunken)]">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs">
        <span className="font-mono text-[var(--text-secondary)]">{file.path}</span>
        {dirty && <StatusBadge entity="session" value="interrupted">edited</StatusBadge>}
        <span className="ml-auto" />
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={tryIt}><FlaskConical />Try</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!dirty} onClick={() => view.current?.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: file.content } })}><Undo2 />Revert</Button>
        <Button size="sm" className="h-7 px-2 text-xs" disabled={!dirty || busy || turnRunning} title={turnRunning ? "The agent is working; wait for the turn" : "Commit this file as Daniel"} onClick={() => void keep()}><Save />Keep</Button>
      </div>
      <div ref={host} className="min-h-0 flex-1 overflow-auto" data-testid="part-editor" />
    </div>
  );
}
