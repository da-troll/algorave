// Session registry: create/stop sessions against a song workspace (in-place
// mode, exclusive writer lock), stamp adapter events into the durable log and
// publish them after commit, run the review poller, commit after each turn.
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdapterEvent, AgentEvent, Session } from "@agent-gateway/protocol";
import type { SessionAdapter } from "@agent-gateway/adapter-core";
import type { Store } from "@agent-gateway/persistence";
import { ClaudeCliAdapter, DEFAULT_DISALLOWED, DEFAULT_TOOLS } from "@agent-gateway/adapter-claude-cli";
import { PtyAdapter } from "@agent-gateway/adapter-pty";
import { CodexAppServerAdapter } from "@agent-gateway/adapter-codex-app-server";
import { AcpAdapter } from "@agent-gateway/adapter-acp";
import { AdapterNotImplementedError } from "@agent-gateway/adapter-core";
import { DEMO, CHILD_ENV, CLAUDE_BIN, DEFAULT_MODEL, EARS_DIST, MCP_DIR, MODELS, NODE_BIN, SKILLS_DIR } from "./config.ts";
import { AGENT, git, head as gitHead } from "./git.ts";
import { LocalProcessRuntime, bootId, procStartTime } from "./runtime.ts";
import type { Bus } from "./bus.ts";
import { HttpError, type SongService } from "./songs.ts";

export const INSTANCE_ID = randomUUID();
const EARS_TOOLS = ["mcp__ears__strudel_check", "mcp__ears__song_info", "mcp__ears__runtime_errors"];
const OWNERSHIP_TTL_MS = 60_000;

type Live = {
  session: Session;
  slug: string;
  kind: "chat" | "terminal";
  adapter: SessionAdapter;
  runtime: LocalProcessRuntime;
  poller?: NodeJS.Timeout;
  polling: boolean;
  lastDiffHash?: string;
  checkToolIds: Set<string>;
  lastCheck?: { ok: boolean; text: string };
  turnInputs: Map<string, string>;
  owner?: { clientId: string; generation: number; expiresAt: number };
  generation: number;
};

export class SessionManager {
  private live = new Map<string, Live>();

  constructor(private store: Store, private bus: Bus, private songs: SongService) {
    songs.turnRunning = (slug) => [...this.live.values()].some((l) => l.slug === slug && !!this.store.runningTurn(l.session.id));
    songs.writerSession = (slug) => [...this.live.values()].find((l) => l.slug === slug)?.session.id ?? null;
  }

  liveFor(id: string): Live | undefined { return this.live.get(id); }
  isLive(id: string): boolean { return this.live.has(id); }
  slugOf(sessionId: string): string | null {
    const live = this.live.get(sessionId);
    if (live) return live.slug;
    const s = this.store.getSession(sessionId);
    return s ? s.workspacePath.split("/").pop()! : null;
  }

  /** stamp + persist + publish (after commit) */
  private emit(sessionId: string, ev: AdapterEvent, source: AgentEvent["source"]): AgentEvent {
    const e = this.store.appendEvent(sessionId, ev, source);
    this.bus.publish(sessionId, e);
    this.bus.publishAny(sessionId, e);
    return e;
  }

  /** Fresh agent-kit for the song: skills copied (dereferenced) and a per-session MCP config. */
  private prepare(songDir: string, sessionId: string): string {
    const dst = join(songDir, ".claude", "skills");
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    if (existsSync(SKILLS_DIR)) cpSync(SKILLS_DIR, dst, { recursive: true, dereference: true });
    mkdirSync(MCP_DIR, { recursive: true, mode: 0o700 });
    const mcp = join(MCP_DIR, `${sessionId}.json`);
    writeFileSync(mcp, JSON.stringify({ mcpServers: { ears: { type: "stdio", command: NODE_BIN, args: [join(EARS_DIST, "server.mjs")], env: { ALGORAVE_SONG_DIR: songDir, PATH: "/usr/bin:/bin" } } } }, null, 2));
    return mcp;
  }

  async createForSong(slug: string, opts: { kind: "chat" | "terminal"; model?: string; adapter?: string }): Promise<Session> {
    if (DEMO) throw new HttpError(403, "demo-mode", "the demo twin never starts an agent or a terminal");
    const songDir = this.songs.dir(slug);
    if (opts.adapter === "codex-app-server" || opts.adapter === "acp") {
      throw new HttpError(422, "adapter-not-implemented", new AdapterNotImplementedError(opts.adapter).message, { adapter: opts.adapter });
    }
    const model = opts.model && MODELS.includes(opts.model) ? opts.model : DEFAULT_MODEL;
    const id = randomUUID();
    const runtimeId = randomUUID();
    const lock = this.store.acquireLock(songDir, id, INSTANCE_ID, runtimeId);
    if (!lock.ok) throw new HttpError(409, "workspace-locked", "another session is writing to this song", { holder: lock.holder });
    try {
      const adapterName = opts.kind === "chat" ? "claude-cli" : "pty";
      const session = this.store.createSession({
        id, adapter: adapterName, workspacePath: songDir, workspaceMode: "in-place", status: "starting",
        capabilities: opts.kind === "chat" ? ["chat", "diff", "mcp"] : ["terminal", "diff"], model,
        branch: (await git(songDir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(), headCommit: await gitHead(songDir),
        label: `${opts.kind === "chat" ? "Chat" : "Terminal"} · ${slug}`,
      });
      this.emit(id, { type: "session.status", payload: { status: "starting", reason: "created", detail: `${adapterName}, in-place, ${model}` } }, "system");
      const mcp = this.prepare(songDir, id);
      const runtime = new LocalProcessRuntime(songDir, CHILD_ENV);
      const flags = { tools: DEFAULT_TOOLS, allowedTools: ["Skill", ...EARS_TOOLS], disallowedTools: DEFAULT_DISALLOWED };
      let adapter: SessionAdapter;
      if (opts.kind === "chat") {
        const a = new ClaudeCliAdapter({ bin: CLAUDE_BIN, model, mcpConfig: mcp, ...flags });
        a.onFileTool = () => void this.poll(id, true);
        if (process.env.ALGORAVE_CAPTURE_DIR) {
          const f = join(process.env.ALGORAVE_CAPTURE_DIR, `${id}.jsonl`);
          a.onRawLine = (raw) => appendFileSync(f, raw + "\n");
        }
        a.onUnknownLine = (l) => console.warn(`[claude-cli ${id.slice(0, 8)}] unknown line type ${String(l.type)}`);
        adapter = a;
      } else {
        // The SAME flags as the chat adapter, interactive: no -p, no stream-json. claude only.
        const args = ["--model", model, "--setting-sources", "project", "--permission-mode", "acceptEdits",
          "--tools", flags.tools.join(","), "--allowedTools", flags.allowedTools.join(","), "--disallowedTools", flags.disallowedTools.join(","),
          "--mcp-config", mcp, "--strict-mcp-config"];
        adapter = new PtyAdapter({ command: CLAUDE_BIN, args, cols: 110, rows: 32 });
      }
      const live: Live = { session, slug, kind: opts.kind, adapter, runtime, polling: false, checkToolIds: new Set(), turnInputs: new Map(), generation: 0 };
      this.live.set(id, live);
      adapter.subscribe((ev) => this.onAdapterEvent(live, ev));
      if (adapter instanceof PtyAdapter) {
        adapter.subscribeTerminal((d) => {
          const data = Buffer.from(d);
          this.bus.publish(id, { type: "terminal.output", sessionId: id, epoch: adapter.epoch, offset: adapter.offset - data.length, data: data.toString("base64") });
        });
      }
      await adapter.start({ session, runtime, project: { name: "algorave-room" }, policy: { describe: () => "claude-cli permission layer + song .claude/settings.json deny rules" } });
      const ident = adapter instanceof PtyAdapter ? { pid: adapter.pid, startTime: procStartTime(adapter.pid) ?? "unknown", bootId: bootId() } : runtime.identity();
      if (ident) this.store.setLockProcess(songDir, ident);
      this.songs.touch(slug, { lastSessionId: id });
      live.poller = setInterval(() => void this.poll(id), 3000);
      return this.store.getSession(id)!;
    } catch (e) {
      this.live.delete(id);
      this.store.releaseLock(songDir, id);
      throw e;
    }
  }

  private onAdapterEvent(live: Live, ev: AdapterEvent) {
    const id = live.session.id;
    const source = live.kind === "chat" ? "claude-cli" : "pty";
    // A chat turn's process exit after a requested interrupt is idle, not stopped.
    const e = this.emit(id, ev, source);
    if (e.type === "tool.started" && e.payload.name === "mcp__ears__strudel_check") live.checkToolIds.add(e.payload.toolUseId);
    if (e.type === "tool.output" && live.checkToolIds.has(e.payload.toolUseId)) {
      const ok = /^CHECK OK/.test(e.payload.output);
      live.lastCheck = { ok, text: e.payload.output };
      this.emit(id, { type: "artifact.created", turnId: e.turnId, payload: {
        artifact: { id: randomUUID(), sessionId: id, kind: "report", pathOrUrl: "ears://strudel_check", title: e.payload.output.split("\n")[0]!.slice(0, 100), createdAt: new Date().toISOString() },
        summary: e.payload.output.split("\n")[0], body: e.payload.output, ok,
      } }, "system");
    }
    if (e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted") {
      void this.afterTurn(live, e.payload.turnId, e.type);
    }
    if (e.type === "session.status" && (e.payload.status === "stopped" || e.payload.status === "failed") && live.kind === "terminal") {
      void this.release(id);
    }
  }

  /** Every agent turn that changed files becomes a commit (plan 6.1). */
  private async afterTurn(live: Live, turnId: string, outcome: string) {
    const dir = live.session.workspacePath;
    try {
      await this.poll(live.session.id, true);
      const dirty = (await git(dir, ["status", "--porcelain"])).trim();
      if (!dirty) return;
      if (outcome !== "turn.completed") {
        // keep the agent's partial edits as a commit too, clearly labelled, so nothing is lost
      }
      const n = this.store.countTurns(live.session.id);
      const prompt = (live.turnInputs.get(turnId) ?? this.store.getTurn(turnId)?.input ?? "").replace(/\s+/g, " ").slice(0, 60);
      await git(dir, ["add", "-A"]);
      await git(dir, ["commit", "-q", "-m", `turn ${n}: ${prompt}${outcome !== "turn.completed" ? ` (${outcome.replace("turn.", "")})` : ""}`], { author: AGENT });
      const h = await gitHead(dir);
      this.songs.touch(live.slug, { headCommit: h });
      this.store.updateSession(live.session.id, { headCommit: h });
      if (live.lastCheck) this.songs.recordCheck(live.slug, h, live.lastCheck.ok, live.lastCheck.text);
      live.lastCheck = undefined;
      this.emit(live.session.id, { type: "artifact.created", turnId, payload: {
        artifact: { id: randomUUID(), sessionId: live.session.id, kind: "link", pathOrUrl: `commit:${h}`, title: `commit ${h.slice(0, 7)}`, createdAt: new Date().toISOString() },
        summary: `turn ${n} committed as ${h.slice(0, 7)}`,
      } }, "system");
      await this.poll(live.session.id, true);
    } catch (err) {
      console.error("afterTurn", err);
    }
  }

  /** Review poller (GW-PLAN 14 Phase 5, simplified): git status + diff HEAD. */
  async poll(id: string, force = false) {
    const live = this.live.get(id);
    if (!live || (live.polling && !force)) return;
    live.polling = true;
    try {
      const dir = live.session.workspacePath;
      const status = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      const files = status.split("\0").filter(Boolean).map((r) => ({ status: r.slice(0, 2).trim() || "?", path: r.slice(3) }));
      let diff = await git(dir, ["diff", "--no-ext-diff", "--no-textconv", "HEAD"], { maxBuffer: 2 * 1024 * 1024 });
      for (const f of files.filter((x) => x.status === "??").slice(0, 10)) {
        try { diff += `\n+++ untracked ${f.path}\n${readFileSync(join(dir, f.path), "utf8").slice(0, 8000)}`; } catch { /* vanished */ }
      }
      const truncated = diff.length > 200_000;
      if (truncated) diff = diff.slice(0, 200_000);
      const hash = createHash("sha256").update(JSON.stringify(files)).update(diff).digest("hex");
      if (hash !== live.lastDiffHash) {
        const first = live.lastDiffHash === undefined;
        live.lastDiffHash = hash;
        if (!first || files.length) {
          this.emit(id, { type: "file.changed", payload: { paths: files.map((f) => f.path) } }, "system");
          this.emit(id, { type: "diff.updated", payload: { files, diff, hash, truncated } }, "system");
        }
      }
    } catch { /* repo mid-operation; next poll */ } finally {
      live.polling = false;
    }
  }

  async submitTurn(sessionId: string, input: string, requestId: string): Promise<{ status: number; body: unknown }> {
    const live = this.live.get(sessionId);
    if (!live) throw new HttpError(409, "not-running", "the session is not running; resume it or start a new one");
    if (live.kind !== "chat") throw new HttpError(409, "not-chat", "this is a terminal session; type in the terminal");
    const acc = this.store.acceptRequest(`turn:${sessionId}`, requestId, { input });
    if (acc.state === "conflict") throw new HttpError(409, "idempotency-conflict", "this request id was used with a different body");
    if (acc.state === "duplicate") return { status: 200, body: acc.result ?? { kind: "turn", pending: true } };
    if (this.store.runningTurn(sessionId)) {
      this.store.completeRequest(`turn:${sessionId}`, requestId, "failed", { error: "turn-running" });
      throw new HttpError(409, "turn-running", "a turn is already running");
    }
    // Persist acceptance and the durable user message BEFORE dispatch.
    const turn = this.store.createTurn(sessionId, input);
    live.turnInputs.set(turn.id, input);
    this.emit(sessionId, { type: "message.completed", turnId: turn.id, payload: { messageId: `${turn.id}#user`, role: "user", text: input } }, "system");
    const result = { kind: "turn" as const, turnId: turn.id };
    this.store.completeRequest(`turn:${sessionId}`, requestId, "completed", result);
    try {
      await live.adapter.sendInput({ text: input, turnId: turn.id });
    } catch (e) {
      this.emit(sessionId, { type: "turn.failed", turnId: turn.id, payload: { turnId: turn.id, error: `dispatch failed: ${(e as Error).message}` } }, "system");
    }
    return { status: 202, body: result };
  }

  async interrupt(sessionId: string) {
    const live = this.live.get(sessionId);
    if (!live) throw new HttpError(409, "not-running", "the session is not running");
    await live.adapter.interrupt();
    return { ok: true, path: live.adapter instanceof ClaudeCliAdapter ? live.adapter.lastInterruptPath : "ctrl-c" };
  }

  // ---------- terminal ownership (GW-PLAN 9) ----------
  claimOwnership(sessionId: string, clientId: string, steal: boolean) {
    const live = this.live.get(sessionId);
    if (!live || live.kind !== "terminal") throw new HttpError(409, "not-terminal", "not a live terminal session");
    const now = Date.now();
    const o = live.owner;
    if (o && o.clientId !== clientId && o.expiresAt > now && !steal) throw new HttpError(409, "owned", "another tab is typing in this terminal", { generation: o.generation });
    if (!o || o.clientId !== clientId) {
      live.generation += 1;
      if (o && o.expiresAt > now) this.emit(sessionId, { type: "session.status", payload: { status: "running", reason: "input-ownership-changed", detail: "another tab took control of the terminal" } }, "system");
    }
    live.owner = { clientId, generation: live.generation, expiresAt: now + OWNERSHIP_TTL_MS };
    return { generation: live.generation, expiresAt: live.owner.expiresAt };
  }
  private assertOwner(live: Live, clientId: string, generation: number) {
    const o = live.owner;
    if (!o || o.clientId !== clientId || o.generation !== generation || o.expiresAt < Date.now()) throw new HttpError(409, "not-owner", "this tab does not hold terminal input; take control first");
  }
  async terminalInput(sessionId: string, clientId: string, generation: number, data: string) {
    const live = this.live.get(sessionId);
    if (!live || !(live.adapter instanceof PtyAdapter)) throw new HttpError(409, "not-terminal", "not a live terminal");
    this.assertOwner(live, clientId, generation);
    live.owner!.expiresAt = Date.now() + OWNERSHIP_TTL_MS;
    await live.adapter.writeRaw(data);
  }
  async terminalResize(sessionId: string, clientId: string, generation: number, cols: number, rows: number) {
    const live = this.live.get(sessionId);
    if (!live || !(live.adapter instanceof PtyAdapter)) throw new HttpError(409, "not-terminal", "not a live terminal");
    this.assertOwner(live, clientId, generation);
    await live.adapter.resize(cols, rows);
    this.bus.publish(sessionId, { type: "terminal.resize", sessionId, epoch: live.adapter.epoch, atOffset: live.adapter.offset, cols, rows });
  }

  async stop(sessionId: string) {
    const live = this.live.get(sessionId);
    if (!live) {
      const s = this.store.getSession(sessionId);
      if (!s) throw new HttpError(404, "no-session", "no such session");
      return s;
    }
    const running = this.store.runningTurn(sessionId);
    if (live.adapter instanceof ClaudeCliAdapter) await live.adapter.terminate("session stopped by user");
    else await live.adapter.terminate();
    if (running && this.store.runningTurn(sessionId)) this.emit(sessionId, { type: "turn.interrupted", turnId: running.id, payload: { turnId: running.id, reason: "session stopped" } }, "system");
    this.emit(sessionId, { type: "session.status", payload: { status: "stopped", reason: "stopped", detail: "stopped by user; the song repo and its history are kept" } }, "system");
    await this.release(sessionId);
    return this.store.getSession(sessionId)!;
  }

  /** release the lock only after the writer is confirmed gone */
  private async release(sessionId: string) {
    const live = this.live.get(sessionId);
    if (!live) return;
    clearInterval(live.poller);
    if (live.adapter instanceof PtyAdapter && !live.adapter.exited) return;
    this.live.delete(sessionId);
    this.store.releaseLock(live.session.workspacePath, sessionId);
    this.store.updateSession(sessionId, { recovery: live.kind === "chat" && this.store.getSession(sessionId)?.providerSessionId ? { canResume: true } : { canResume: false, reason: "terminal sessions cannot resume" } });
  }

  async resume(sessionId: string): Promise<Session> {
    if (DEMO) throw new HttpError(403, "demo-mode", "the demo twin never starts an agent");
    const s = this.store.getSession(sessionId);
    if (!s) throw new HttpError(404, "no-session", "no such session");
    if (this.live.has(sessionId)) throw new HttpError(409, "already-running", "the session is already running");
    if (s.adapter !== "claude-cli" || !s.providerSessionId) throw new HttpError(409, "not-resumable", "only chat sessions with a provider conversation can resume");
    const slug = s.workspacePath.split("/").pop()!;
    const songDir = this.songs.dir(slug);
    const lock = this.store.acquireLock(songDir, sessionId, INSTANCE_ID, randomUUID());
    if (!lock.ok) throw new HttpError(409, "workspace-locked", "another session is writing to this song", { holder: lock.holder });
    const mcp = this.prepare(songDir, sessionId);
    const runtime = new LocalProcessRuntime(songDir, CHILD_ENV);
    const a = new ClaudeCliAdapter({ bin: CLAUDE_BIN, model: s.model ?? DEFAULT_MODEL, mcpConfig: mcp, tools: DEFAULT_TOOLS, allowedTools: ["Skill", ...EARS_TOOLS], disallowedTools: DEFAULT_DISALLOWED, resumeId: s.providerSessionId });
    const live: Live = { session: s, slug, kind: "chat", adapter: a, runtime, polling: false, checkToolIds: new Set(), turnInputs: new Map(), generation: 0 };
    a.onFileTool = () => void this.poll(sessionId, true);
    this.live.set(sessionId, live);
    a.subscribe((ev) => this.onAdapterEvent(live, ev));
    await a.start({ session: s, runtime, project: { name: "algorave-room" }, policy: { describe: () => "claude-cli" } });
    this.emit(sessionId, { type: "session.status", payload: { status: "running", reason: "resumed", detail: `resumed provider conversation ${s.providerSessionId.slice(0, 8)} with --resume` } }, "system");
    live.poller = setInterval(() => void this.poll(sessionId), 3000);
    return this.store.getSession(sessionId)!;
  }

  /** Gateway start (GW-PLAN 9.1): mark lost runtimes interrupted, never re-send. */
  reconcile() {
    for (const s of this.store.listSessions()) {
      if (["starting", "running", "idle"].includes(s.status)) {
        const t = this.store.runningTurn(s.id);
        if (t) {
          if (t.delivery === "dispatched") this.store.setTurnDelivery(t.id, "delivery-unknown");
          this.emit(s.id, { type: "turn.interrupted", turnId: t.id, payload: { turnId: t.id, reason: t.delivery === "dispatched" ? "gateway restarted mid-turn; the prompt is NOT re-sent (delivery-unknown)" : "gateway restarted before the prompt was dispatched; not sent" } }, "system");
        }
        this.emit(s.id, { type: "session.status", payload: { status: "interrupted", reason: "interrupted-by-restart", detail: "the gateway restarted; the song repo is intact" } }, "system");
        this.store.updateSession(s.id, { recovery: s.adapter === "claude-cli" && s.providerSessionId ? { canResume: true } : { canResume: false, reason: "terminal sessions cannot reattach after a gateway restart" } });
      }
    }
    for (const l of this.store.listLocks()) {
      if (l.gatewayInstanceId === INSTANCE_ID) continue;
      const id = l.processIdentity as { pid: number; startTime: string; bootId: string } | null;
      let gone: boolean;
      if (!id) gone = true; // never got past startup: no process was recorded for it
      else if (id.bootId !== bootId()) gone = true;
      else {
        const st = procStartTime(id.pid);
        if (st === null) gone = true;
        else if (st !== id.startTime) gone = true; // PID reused by an unrelated process
        else {
          // our own orphaned writer, verified by pid + start time: terminate its group
          try { process.kill(-id.pid, "SIGTERM"); } catch { /* ignore */ }
          gone = procStartTime(id.pid) === null;
          if (!gone) { console.warn(`lock on ${l.workspacePath} held: writer ${id.pid} still alive after SIGTERM`); continue; }
        }
      }
      if (gone) {
        this.store.releaseLock(l.workspacePath, l.sessionId);
        if (this.store.getSession(l.sessionId)) this.emit(l.sessionId, { type: "session.status", payload: { status: "interrupted", reason: "stale-lock-reclaimed", detail: "the previous writer is confirmed gone" } }, "system");
      }
    }
  }

  async shutdown() {
    for (const [id, live] of this.live) {
      const t0 = this.store.runningTurn(id);
      if (t0?.delivery === "dispatched") this.store.setTurnDelivery(t0.id, "delivery-unknown");
      try {
        if (live.adapter instanceof ClaudeCliAdapter) await live.adapter.terminate("gateway shut down mid-turn; the prompt is NOT re-sent (delivery-unknown)");
        else await live.adapter.terminate();
      } catch { /* ignore */ }
      const t = this.store.runningTurn(id);
      if (t) {
        if (t.delivery === "dispatched") this.store.setTurnDelivery(t.id, "delivery-unknown");
        this.emit(id, { type: "turn.interrupted", turnId: t.id, payload: { turnId: t.id, reason: "gateway shut down mid-turn; the prompt is NOT re-sent (delivery-unknown)" } }, "system");
      }
      this.emit(id, { type: "session.status", payload: { status: "interrupted", reason: "interrupted-by-restart", detail: "gateway shut down gracefully" } }, "system");
      this.store.releaseLock(live.session.workspacePath, id);
      this.store.updateSession(id, { recovery: live.kind === "chat" && this.store.getSession(id)?.providerSessionId ? { canResume: true } : { canResume: false } });
      clearInterval(live.poller);
    }
    this.live.clear();
  }

  ptySnapshot(sessionId: string) {
    const live = this.live.get(sessionId);
    return live?.adapter instanceof PtyAdapter ? live.adapter.snapshot() : null;
  }
}
