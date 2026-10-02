// @agent-gateway/persistence: SQLite store (GW-PLAN 8). appendEvent is the ONLY
// allocator of seq; it updates the session/turn projection in the same
// transaction. Callers publish after it returns (i.e. after commit).
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  PROTOCOL_VERSION, EventPayloads, type AdapterEvent, type AgentEvent, type Artifact, type EventSource,
  type Session, type SessionStatus, type Turn,
} from "@agent-gateway/protocol";

type Row = Record<string, unknown>;

const MIGRATIONS: string[] = [
  `CREATE TABLE sessions (
    id TEXT PRIMARY KEY, label TEXT, adapter TEXT NOT NULL, workspace_path TEXT NOT NULL,
    workspace_mode TEXT NOT NULL, worktree_path TEXT, branch TEXT, head_commit TEXT,
    provider_session_id TEXT, model TEXT, status TEXT NOT NULL, recovery_json TEXT,
    capabilities_json TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_activity_at TEXT NOT NULL
  );
  CREATE TABLE events (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, protocol_version INTEGER NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL,
    turn_id TEXT, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, UNIQUE(session_id, seq)
  );
  CREATE INDEX events_session_seq ON events(session_id, seq);
  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, path_or_url TEXT NOT NULL, title TEXT, body TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE workspace_locks (
    workspace_path TEXT PRIMARY KEY, session_id TEXT NOT NULL, acquired_at TEXT NOT NULL,
    gateway_instance_id TEXT NOT NULL, runtime_id TEXT NOT NULL, process_identity_json TEXT
  );
  CREATE TABLE turns (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    input TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT,
    delivery TEXT NOT NULL DEFAULT 'accepted'
  );
  CREATE TABLE requests (
    scope TEXT NOT NULL, request_id TEXT NOT NULL, body_hash TEXT NOT NULL, status TEXT NOT NULL,
    result_json TEXT, created_at TEXT NOT NULL, PRIMARY KEY(scope, request_id)
  );`,
];

export type AppendResult = AgentEvent;
export type LockResult = { ok: true } | { ok: false; holder: string };
export type RequestAccept = { state: "new" } | { state: "duplicate"; status: string; result: unknown } | { state: "conflict" };

export function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export class Store {
  readonly db: Database.Database;

  constructor(dataDir: string, extraMigrations: string[] = []) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dataDir, "gateway.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate([...MIGRATIONS, ...extraMigrations]);
  }

  private migrate(all: string[]) {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
    const row = this.db.prepare("SELECT v FROM schema_version").get() as { v: number } | undefined;
    let v = row?.v ?? 0;
    if (!row) this.db.prepare("INSERT INTO schema_version (v) VALUES (0)").run();
    for (; v < all.length; v++) {
      this.db.transaction(() => {
        this.db.exec(all[v]!);
        this.db.prepare("UPDATE schema_version SET v = ?").run(v + 1);
      })();
    }
  }

  close() { this.db.close(); }

  // ---------- sessions ----------
  createSession(s: Omit<Session, "createdAt" | "updatedAt" | "lastActivityAt">): Session {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO sessions (id,label,adapter,workspace_path,workspace_mode,worktree_path,branch,head_commit,provider_session_id,model,status,recovery_json,capabilities_json,created_at,updated_at,last_activity_at)
      VALUES (@id,@label,@adapter,@workspacePath,@workspaceMode,@worktreePath,@branch,@headCommit,@providerSessionId,@model,@status,@recovery,@caps,@now,@now,@now)`).run({
      ...s, label: s.label ?? null, worktreePath: s.worktreePath ?? null, branch: s.branch ?? null, headCommit: s.headCommit ?? null,
      providerSessionId: s.providerSessionId ?? null, model: s.model ?? null,
      recovery: s.recovery ? JSON.stringify(s.recovery) : null, caps: JSON.stringify(s.capabilities), now,
    });
    return this.getSession(s.id)!;
  }

  private toSession(r: Row): Session {
    const o: Session = {
      id: r.id as string, adapter: r.adapter as Session["adapter"], workspacePath: r.workspace_path as string,
      workspaceMode: r.workspace_mode as Session["workspaceMode"], status: r.status as SessionStatus,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string, lastActivityAt: r.last_activity_at as string,
      capabilities: JSON.parse(r.capabilities_json as string),
    };
    if (r.label) o.label = r.label as string;
    if (r.worktree_path) o.worktreePath = r.worktree_path as string;
    if (r.branch) o.branch = r.branch as string;
    if (r.head_commit) o.headCommit = r.head_commit as string;
    if (r.provider_session_id) o.providerSessionId = r.provider_session_id as string;
    if (r.model) o.model = r.model as string;
    if (r.recovery_json) o.recovery = JSON.parse(r.recovery_json as string);
    return o;
  }

  getSession(id: string): Session | null {
    const r = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
    return r ? this.toSession(r) : null;
  }

  listSessions(): Session[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY last_activity_at DESC").all() as Row[]).map((r) => this.toSession(r));
  }

  updateSession(id: string, patch: Partial<Pick<Session, "branch" | "headCommit" | "providerSessionId" | "recovery" | "label" | "model">>) {
    const cols: Record<string, unknown> = {};
    if ("branch" in patch) cols.branch = patch.branch ?? null;
    if ("headCommit" in patch) cols.head_commit = patch.headCommit ?? null;
    if ("providerSessionId" in patch) cols.provider_session_id = patch.providerSessionId ?? null;
    if ("recovery" in patch) cols.recovery_json = patch.recovery ? JSON.stringify(patch.recovery) : null;
    if ("label" in patch) cols.label = patch.label ?? null;
    if ("model" in patch) cols.model = patch.model ?? null;
    const keys = Object.keys(cols);
    if (!keys.length) return;
    this.db.prepare(`UPDATE sessions SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @now WHERE id = @id`).run({ ...cols, id, now: new Date().toISOString() });
  }

  // ---------- events ----------
  /**
   * The only seq allocator. Validates the payload, assigns seq, inserts the event
   * and updates projections (session status / turn state) in ONE transaction.
   */
  appendEvent(sessionId: string, ev: AdapterEvent, source: EventSource): AppendResult {
    const payload = EventPayloads[ev.type].parse(ev.payload);
    const tx = this.db.transaction((): AppendResult => {
      const s = this.db.prepare("SELECT last_seq FROM sessions WHERE id = ?").get(sessionId) as { last_seq: number } | undefined;
      if (!s) throw new Error(`no session ${sessionId}`);
      const seq = s.last_seq + 1;
      const now = new Date().toISOString();
      const id = randomUUID();
      this.db.prepare(`INSERT INTO events (id,session_id,seq,protocol_version,type,source,turn_id,payload_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, sessionId, seq, PROTOCOL_VERSION, ev.type, source, ev.turnId ?? null, JSON.stringify(payload), now);
      this.db.prepare("UPDATE sessions SET last_seq = ?, last_activity_at = ?, updated_at = ? WHERE id = ?").run(seq, now, now, sessionId);
      this.project(sessionId, ev.type, payload as Record<string, unknown>, now);
      const out = { protocolVersion: 1, id, sessionId, seq, occurredAt: now, source, type: ev.type, payload } as AgentEvent;
      if (ev.turnId) (out as { turnId?: string }).turnId = ev.turnId;
      return out;
    });
    return tx();
  }

  private project(sessionId: string, type: string, p: Record<string, unknown>, now: string) {
    switch (type) {
      case "session.status":
        this.db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(p.status, sessionId);
        if (p.providerSessionId) this.db.prepare("UPDATE sessions SET provider_session_id = ? WHERE id = ?").run(p.providerSessionId, sessionId);
        break;
      case "turn.started":
        this.db.prepare("UPDATE turns SET state = 'running', delivery = 'dispatched' WHERE id = ?").run(p.turnId);
        break;
      case "turn.completed":
        this.db.prepare("UPDATE turns SET state = 'completed', completed_at = ? WHERE id = ?").run(now, p.turnId);
        break;
      case "turn.failed":
        this.db.prepare("UPDATE turns SET state = 'failed', completed_at = ? WHERE id = ?").run(now, p.turnId);
        break;
      case "turn.interrupted":
        this.db.prepare("UPDATE turns SET state = 'interrupted', completed_at = ? WHERE id = ?").run(now, p.turnId);
        break;
      case "artifact.created": {
        const a = p.artifact as Artifact;
        this.db.prepare("INSERT OR IGNORE INTO artifacts (id,session_id,kind,path_or_url,title,body,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(a.id, sessionId, a.kind, a.pathOrUrl, a.title ?? null, (p.body as string | undefined) ?? null, a.createdAt);
        break;
      }
    }
  }

  lastSeq(sessionId: string): number {
    return (this.db.prepare("SELECT last_seq FROM sessions WHERE id = ?").get(sessionId) as { last_seq: number } | undefined)?.last_seq ?? 0;
  }

  /** Session snapshot and high-water mark H read in one transaction (replay contract step 1). */
  snapshot(sessionId: string): { session: Session; lastSeq: number } | null {
    return this.db.transaction(() => {
      const s = this.getSession(sessionId);
      return s ? { session: s, lastSeq: this.lastSeq(sessionId) } : null;
    })();
  }

  listEventsAfter(sessionId: string, afterSeq: number, limit = 500, throughSeq?: number): AgentEvent[] {
    const rows = (throughSeq !== undefined
      ? this.db.prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? AND seq <= ? ORDER BY seq LIMIT ?").all(sessionId, afterSeq, throughSeq, limit)
      : this.db.prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(sessionId, afterSeq, limit)) as Row[];
    return rows.map((r) => {
      const e = { protocolVersion: 1, id: r.id, sessionId: r.session_id, seq: r.seq, occurredAt: r.occurred_at, source: r.source, type: r.type, payload: JSON.parse(r.payload_json as string) } as AgentEvent;
      if (r.turn_id) (e as { turnId?: string }).turnId = r.turn_id as string;
      return e;
    });
  }

  // ---------- turns ----------
  createTurn(sessionId: string, input: string): Turn {
    const t: Turn = { id: randomUUID(), sessionId, input, state: "pending", createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO turns (id,session_id,input,state,created_at) VALUES (?,?,?,?,?)").run(t.id, sessionId, input, t.state, t.createdAt);
    return t;
  }
  runningTurn(sessionId: string): (Turn & { delivery: string }) | null {
    const r = this.db.prepare("SELECT * FROM turns WHERE session_id = ? AND state IN ('pending','running') ORDER BY created_at DESC LIMIT 1").get(sessionId) as Row | undefined;
    return r ? { id: r.id as string, sessionId, input: r.input as string, state: r.state as Turn["state"], createdAt: r.created_at as string, delivery: r.delivery as string } : null;
  }
  getTurn(id: string): Turn | null {
    const r = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as Row | undefined;
    return r ? { id, sessionId: r.session_id as string, input: r.input as string, state: r.state as Turn["state"], createdAt: r.created_at as string, ...(r.completed_at ? { completedAt: r.completed_at as string } : {}) } : null;
  }
  setTurnDelivery(id: string, delivery: "accepted" | "dispatched" | "delivery-unknown") {
    this.db.prepare("UPDATE turns SET delivery = ? WHERE id = ?").run(delivery, id);
  }
  countTurns(sessionId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM turns WHERE session_id = ?").get(sessionId) as { n: number }).n;
  }

  // ---------- idempotent requests ----------
  acceptRequest(scope: string, requestId: string, body: unknown): RequestAccept {
    const h = hashBody(body);
    return this.db.transaction((): RequestAccept => {
      const r = this.db.prepare("SELECT * FROM requests WHERE scope = ? AND request_id = ?").get(scope, requestId) as Row | undefined;
      if (r) {
        if (r.body_hash !== h) return { state: "conflict" };
        return { state: "duplicate", status: r.status as string, result: r.result_json ? JSON.parse(r.result_json as string) : null };
      }
      this.db.prepare("INSERT INTO requests (scope,request_id,body_hash,status,created_at) VALUES (?,?,?,?,?)").run(scope, requestId, h, "accepted", new Date().toISOString());
      return { state: "new" };
    })();
  }
  completeRequest(scope: string, requestId: string, status: "completed" | "failed" | "delivery-unknown", result: unknown) {
    this.db.prepare("UPDATE requests SET status = ?, result_json = ? WHERE scope = ? AND request_id = ?").run(status, JSON.stringify(result ?? null), scope, requestId);
  }

  // ---------- workspace locks (GW-PLAN 9 step 4) ----------
  acquireLock(workspacePath: string, sessionId: string, instanceId: string, runtimeId: string): LockResult {
    return this.db.transaction((): LockResult => {
      const r = this.db.prepare("SELECT session_id FROM workspace_locks WHERE workspace_path = ?").get(workspacePath) as { session_id: string } | undefined;
      if (r) return { ok: false, holder: r.session_id };
      this.db.prepare("INSERT INTO workspace_locks (workspace_path,session_id,acquired_at,gateway_instance_id,runtime_id) VALUES (?,?,?,?,?)")
        .run(workspacePath, sessionId, new Date().toISOString(), instanceId, runtimeId);
      return { ok: true };
    })();
  }
  setLockProcess(workspacePath: string, identity: unknown) {
    this.db.prepare("UPDATE workspace_locks SET process_identity_json = ? WHERE workspace_path = ?").run(JSON.stringify(identity), workspacePath);
  }
  releaseLock(workspacePath: string, sessionId: string) {
    this.db.prepare("DELETE FROM workspace_locks WHERE workspace_path = ? AND session_id = ?").run(workspacePath, sessionId);
  }
  lockHolder(workspacePath: string): string | null {
    return (this.db.prepare("SELECT session_id FROM workspace_locks WHERE workspace_path = ?").get(workspacePath) as { session_id: string } | undefined)?.session_id ?? null;
  }
  listLocks(): Array<{ workspacePath: string; sessionId: string; gatewayInstanceId: string; processIdentity: unknown }> {
    return (this.db.prepare("SELECT * FROM workspace_locks").all() as Row[]).map((r) => ({
      workspacePath: r.workspace_path as string, sessionId: r.session_id as string, gatewayInstanceId: r.gateway_instance_id as string,
      processIdentity: r.process_identity_json ? JSON.parse(r.process_identity_json as string) : null,
    }));
  }

  listArtifacts(sessionId: string): Array<Artifact & { body?: string }> {
    return (this.db.prepare("SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at").all(sessionId) as Row[]).map((r) => ({
      id: r.id as string, sessionId, kind: r.kind as Artifact["kind"], pathOrUrl: r.path_or_url as string,
      ...(r.title ? { title: r.title as string } : {}), ...(r.body ? { body: r.body as string } : {}), createdAt: r.created_at as string,
    }));
  }
}
