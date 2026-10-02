// The song page: Conversation | REPL on top, project + stock panels in tabs below.
// Mobile (< 768 px): every panel is a tab.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@trollefsen-labs/components-react";
import { Activity, FileDiff, GitCommitHorizontal, Map, Disc3, Sparkles, Mic, SquareTerminal, MessageSquare, Music, CirclePlay, Power, RotateCcw, CircleStop } from "lucide-react";
import { ActivityPanel, ConversationPanel, ReviewPanel, StatusBadge, TerminalPanel, useSession } from "@agent-gateway/ui-agent-shell";
import { client, api, type Compiled, type SongDetail } from "./api.ts";
import { ReplPanel, withVisual } from "./project/Repl.tsx";
import { TimelinePanel } from "./project/Timeline.tsx";
import { GenresPanel } from "./project/Genres.tsx";
import { PathPanel } from "./project/Path.tsx";
import { VisualsPanel } from "./project/Visuals.tsx";
import { RecordPanel } from "./project/Record.tsx";
import { engine, type ApplyMode } from "./project/engine.ts";
import { Header } from "./Header.tsx";

type Tab = "chat" | "repl" | "timeline" | "activity" | "review" | "visuals" | "path" | "genres" | "record" | "terminal";
const TABS: Array<{ id: Tab; label: string; icon: typeof Activity; mobileOnly?: boolean }> = [
  { id: "chat", label: "Chat", icon: MessageSquare, mobileOnly: true },
  { id: "repl", label: "REPL", icon: Music, mobileOnly: true },
  { id: "timeline", label: "Timeline", icon: GitCommitHorizontal },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "review", label: "Review", icon: FileDiff },
  { id: "visuals", label: "Visuals", icon: Sparkles },
  { id: "path", label: "Guided Path", icon: Map },
  { id: "genres", label: "Genres", icon: Disc3 },
  { id: "record", label: "Record", icon: Mic },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
];

function useIsMobile() {
  const q = "(max-width: 767px)";
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q); const f = () => setM(mq.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  return m;
}

export function SongPage({ slug, models, defaultModel, navigate }: { slug: string; models: string[]; defaultModel: string; navigate: (to: string) => void }) {
  const mobile = useIsMobile();
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>(() => (/[?&]tab=path\b/.test(location.hash) ? "path" : matchMedia("(max-width: 767px)").matches ? "chat" : "timeline"));
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [applyMode, setApplyMode] = useState<ApplyMode>("bar");
  const [visual, setVisual] = useState<"none" | "pianoroll" | "punchcard">("pianoroll");
  const [ab, setAb] = useState<{ a?: { sha: string; code: string }; b?: { sha: string; code: string }; active: "a" | "b" | null }>({ active: null });
  const [songCode, setSongCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<null | "stop" | "terminal">(null);
  const appliedHead = useRef<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  useEffect(() => {
    void api<SongDetail>("GET", `/api/songs/${slug}`).then((d) => {
      setDetail(d);
      setSessionId((cur) => cur ?? d.writerSession ?? d.song.lastSessionId);
    }).catch((e) => toast.error((e as Error).message));
  }, [slug, refreshKey]);

  // Follow HEAD: each new commit is compiled by the gateway and applied on the next bar.
  useEffect(() => {
    if (!detail || detail.head === appliedHead.current) return;
    const first = appliedHead.current === null;
    appliedHead.current = detail.head;
    void api<Compiled>("GET", `/api/songs/${slug}/compiled?commit=${detail.head}`).then((c) => {
      setSongCode(c.code);
      if (ab.active) return; // comparing: do not yank the A/B slot
      const err = engine.apply(withVisual(c.code, visual), first ? "song loaded" : `commit ${c.commit.slice(0, 7)}`, first ? "now" : applyMode);
      if (err) toast.error(`New version does not parse in the browser; still playing the previous one. ${err}`);
    });
  }, [detail?.head]);
  useEffect(() => { if (songCode && !ab.active) engine.apply(withVisual(songCode, visual), `visual: ${visual}`, "now"); }, [visual]);
  useEffect(() => {
    engine.onRuntime = (r) => { void api("POST", `/api/songs/${slug}/runtime-report`, { ...r, commit: appliedHead.current ?? undefined }).catch(() => {}); };
  }, [slug]);

  const handle = useSession(client, sessionId);
  const s = handle.state.session;
  const live = !!detail?.writerSession && detail.writerSession === sessionId;
  const kind = s?.adapter === "pty" ? "terminal" : "chat";
  // refetch the song when the agent's work lands
  const lastActivity = handle.state.activity[handle.state.activity.length - 1];
  useEffect(() => {
    if (!lastActivity) return;
    if (lastActivity.type === "artifact.created" && lastActivity.payload.artifact.pathOrUrl.startsWith("commit:")) refresh();
    if (lastActivity.type === "turn.started" || lastActivity.type === "turn.completed" || lastActivity.type === "turn.failed" || lastActivity.type === "turn.interrupted" || (lastActivity.type === "session.status" && ["stopped", "failed", "interrupted"].includes(lastActivity.payload.status))) refresh();
  }, [lastActivity?.id]);

  const start = async (k: "chat" | "terminal") => {
    try {
      const ses = await api<{ id: string }>("POST", `/api/songs/${slug}/sessions`, { kind: k, model });
      setSessionId(ses.id);
      if (k === "terminal") setTab("terminal");
      refresh();
    } catch (e) {
      const err = e as { code?: string; body?: { holder?: string } };
      if (err.code === "workspace-locked") { toast.error("Another session is writing to this song. Open it or stop it first."); if (err.body?.holder) setSessionId(err.body.holder); }
      else toast.error((e as Error).message);
    }
  };
  const stop = async () => { if (sessionId) { await client.sessions.stop(sessionId).catch((e) => toast.error((e as Error).message)); refresh(); } };
  const resume = async () => { if (sessionId) { try { await client.sessions.resume(sessionId); refresh(); } catch (e) { toast.error((e as Error).message); } } };
  const send = async (text: string) => {
    if (!sessionId) return;
    try { await client.sessions.submitTurn(sessionId, text, crypto.randomUUID()); setDraft(""); }
    catch (e) { toast.error((e as Error).message); }
  };
  const interrupt = async () => { if (sessionId) await client.sessions.interrupt(sessionId).catch((e) => toast.error((e as Error).message)); };
  const createFromGenre = async (genre: string) => {
    try { const song = await api<{ slug: string }>("POST", "/api/songs", { genre }); navigate(`/song/${song.slug}`); }
    catch (e) { toast.error((e as Error).message); }
  };

  const chatDisabled = !sessionId ? "Start a session to talk to the producer." : !live ? (s?.recovery?.canResume ? "This session is not running. Resume it to continue the conversation." : "This session has ended. Start a new one.") : kind !== "chat" ? "A terminal session holds the song. Use the Terminal tab." : null;

  const sessionBar = (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-subtle)] px-2 py-1.5 text-xs">
      {live ? (
        <>
          <StatusBadge entity="session" value={s?.status ?? "running"}>{kind} · {s?.status ?? "running"}</StatusBadge>
          {kind === "chat" && <span className="font-mono text-[var(--text-muted)]">{s?.model}</span>}
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => setConfirmStop("stop")}><Power />Stop session</Button>
        </>
      ) : (
        <>
          {s && <StatusBadge entity="session" value={s.status}>{s.status}</StatusBadge>}
          <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-1 py-0.5 font-mono text-xs text-[var(--text-primary)]">
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void start("chat")} data-testid="start-chat"><CirclePlay />New chat session</Button>
          {s?.recovery?.canResume && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void resume()}><RotateCcw />Resume</Button>}
        </>
      )}
    </div>
  );

  const conversation = (
    <div className="flex h-full min-h-0 flex-col">
      {sessionBar}
      <div className="min-h-0 flex-1">
        <ConversationPanel handle={handle} onSend={(t) => void send(t)} onInterrupt={() => void interrupt()} disabledReason={chatDisabled} draft={draft} setDraft={setDraft}
          footer={handle.state.usage.output > 0 ? <p className="mt-1 text-right font-mono text-[10px] text-[var(--text-muted)]">{handle.state.usage.input} in · {handle.state.usage.output} out · ${handle.state.usage.cost.toFixed(3)}</p> : null} />
      </div>
    </div>
  );
  const repl = <ReplPanel slug={slug} detail={detail} onSaved={refresh} ab={ab} setAb={setAb} applyMode={applyMode} setApplyMode={setApplyMode} visual={visual} setVisual={setVisual} songCode={songCode} />;
  const terminal = live && kind === "terminal" && sessionId ? (
    <TerminalPanel handle={handle} sessionId={sessionId} live={live} claim={async (steal) => (await client.sessions.claimTerminal(sessionId, handle.clientId, steal)).generation} />
  ) : (
    <div className="p-3 text-sm text-[var(--text-secondary)]">
      <p>Open Claude Code itself in this song's repo, with the same tools and the same ears. There is no shell: when claude exits, the terminal ends.</p>
      <Button className="mt-2" size="sm" onClick={() => (live ? setConfirmStop("terminal") : void start("terminal"))}><SquareTerminal />Open Claude Code terminal</Button>
      {live && <p className="mt-1 text-xs text-[var(--warning-fg)]">One writer per song: this stops the running chat session first (the conversation can be resumed later).</p>}
    </div>
  );
  const panel = (t: Tab): ReactNode => {
    switch (t) {
      case "chat": return conversation;
      case "repl": return repl;
      case "timeline": return <TimelinePanel slug={slug} detail={detail} refreshKey={refreshKey} onChanged={refresh} onCompare={(slot, sha, code) => { const n = { ...ab, [slot]: { sha, code } }; setAb(n); toast.message(`Loaded ${sha.slice(0, 7)} into ${slot.toUpperCase()}; switch in the REPL`); }} />;
      case "activity": return <ActivityPanel handle={handle} enforcement="Agent tools are limited by the Claude Code permission layer (no shell, no web, writes only in the song repo). strudel_check evaluates in a Node sandbox with no file, process or network access." />;
      case "review": return <ReviewPanel handle={handle} />;
      case "visuals": return <VisualsPanel active={tab === "visuals"} />;
      case "path": return <PathPanel slug={slug} detail={detail} onPrompt={(p) => { setDraft(p); setTab(mobile ? "chat" : tab); toast.message("Prompt ready in the chat box"); }} />;
      case "genres": return <GenresPanel onCreate={(g) => void createFromGenre(g)} />;
      case "record": return <RecordPanel slug={slug} bpm={detail?.meta.bpm ?? 128} />;
      case "terminal": return terminal;
    }
  };
  const tabs = TABS.filter((t) => mobile || !t.mobileOnly);
  const tabBar = (
    <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs", tab === t.id ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]")} data-tab={t.id}>
          <t.icon className="size-3.5" />{t.label}
          {t.id === "activity" && handle.state.activity.some((e) => e.type === "approval.resolved") && <span className="size-1.5 rounded-full bg-[var(--error)]" />}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <Header
        title={detail?.meta.title ?? "…"} onHome={() => navigate("/")}
        meta={detail ? { branch: detail.branch, bpm: detail.meta.bpm, key: `${detail.meta.key} ${detail.meta.scale}` } : undefined}
        session={s ? { status: s.status, model: s.model } : undefined} conn={sessionId ? handle.conn : undefined} lastSeq={handle.state.lastSeq}
        right={handle.state.runningTurnId ? <Button size="sm" variant="destructive" className="h-8" onClick={() => void interrupt()}><CircleStop />Interrupt</Button> : null}
      />
      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {tabBar}
          {tabs.map((t) => <div key={t.id} hidden={tab !== t.id} className="min-h-0 flex-1">{panel(t.id)}</div>)}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,58fr)_minmax(0,42fr)] gap-2 p-2">
          <div className="row-start-1 grid min-h-0 grid-cols-[minmax(320px,2fr)_minmax(0,3fr)] gap-2">
            <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]" aria-label="Conversation">{conversation}</section>
            <section className="min-h-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]" aria-label="REPL">{repl}</section>
          </div>
          <section className="row-start-2 flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)]" aria-label="Panels">
            {tabBar}
            {tabs.map((t) => <div key={t.id} hidden={tab !== t.id} className="min-h-0 flex-1">{panel(t.id)}</div>)}
          </section>
        </div>
      )}
      <Dialog open={!!confirmStop} onOpenChange={(o) => !o && setConfirmStop(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmStop === "terminal" ? "Stop the chat and open the terminal?" : "Stop this session?"}</DialogTitle>
            <DialogDescription>The song repo and every commit are kept. {kind === "chat" ? "The conversation can be resumed later." : "A terminal session cannot be resumed."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStop(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { const next = confirmStop; setConfirmStop(null); await stop(); if (next === "terminal") await start("terminal"); }}>Stop{confirmStop === "terminal" ? " and open terminal" : ""}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
