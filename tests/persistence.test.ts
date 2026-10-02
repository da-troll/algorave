// Persistence: appendEvent is the only seq allocator, projections commit in the
// same transaction, idempotent requests, workspace locks (GW-PLAN 8, 9 step 4).
// Run: node --test tests/persistence.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../packages/persistence/src/index.ts";

const root = new URL("..", import.meta.url).pathname;
mkdirSync(join(root, "data", "test-runs"), { recursive: true });
const dirs: string[] = [];
const stores: Store[] = [];
after(() => {
  for (const s of stores) { try { s.close(); } catch { /* already closed */ } }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fresh(extra: string[] = []): { store: Store; dir: string } {
  const dir = mkdtempSync(join(root, "data", "test-runs", "persist-"));
  dirs.push(dir);
  const store = new Store(dir, extra);
  stores.push(store);
  return { store, dir };
}

function mkSession(store: Store, id = crypto.randomUUID()) {
  return store.createSession({ id, adapter: "claude-cli", workspacePath: `/songs/${id}`, workspaceMode: "in-place", status: "starting", capabilities: ["chat"] });
}

const eventCount = (store: Store, sid: string) => (store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ?").get(sid) as { n: number }).n;

test("appendEvent allocates seq 1 then 2 and returns a full envelope", () => {
  const { store } = fresh();
  const s = mkSession(store);
  const e1 = store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "started" } }, "system");
  const e2 = store.appendEvent(s.id, { type: "message.delta", turnId: "t1", payload: { messageId: "m#0", role: "assistant", delta: "x" } }, "claude-cli");
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e1.protocolVersion, 1);
  assert.equal(e2.turnId, "t1");
  assert.equal(store.lastSeq(s.id), 2);
  // seq is per session
  const other = mkSession(store);
  assert.equal(store.appendEvent(other.id, { type: "session.status", payload: { status: "idle", reason: "started" } }, "system").seq, 1);
});

test("session.status projects status and providerSessionId", () => {
  const { store } = fresh();
  const s = mkSession(store);
  store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "provider-session", providerSessionId: "prov-1" } }, "claude-cli");
  const got = store.getSession(s.id)!;
  assert.equal(got.status, "running");
  assert.equal(got.providerSessionId, "prov-1");
});

test("an invalid payload throws and leaves last_seq and events unchanged", () => {
  const { store } = fresh();
  const s = mkSession(store);
  store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "started" } }, "system");
  assert.throws(() => store.appendEvent(s.id, { type: "message.delta", payload: { messageId: "m", role: "user", delta: 1 } } as never, "system"));
  assert.equal(store.lastSeq(s.id), 1);
  assert.equal(eventCount(store, s.id), 1);
  // the next valid event still gets seq 2 (no hole)
  assert.equal(store.appendEvent(s.id, { type: "session.status", payload: { status: "idle", reason: "turn-finished" } }, "system").seq, 2);
});

test("appending to an unknown session throws and writes nothing", () => {
  const { store } = fresh();
  assert.throws(() => store.appendEvent("nope", { type: "session.status", payload: { status: "running", reason: "started" } }, "system"), /no session/);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n, 0);
});

test("a projection failure inside the transaction rolls back the event and last_seq", () => {
  // test-only trigger: make the turns projection fail, prove the event insert is undone with it
  const { store } = fresh([`CREATE TRIGGER fail_turn_update BEFORE UPDATE ON turns WHEN NEW.state = 'failed' BEGIN SELECT RAISE(ABORT, 'projection refused'); END;`]);
  const s = mkSession(store);
  const turn = store.createTurn(s.id, "hello");
  store.appendEvent(s.id, { type: "turn.started", turnId: turn.id, payload: { turnId: turn.id, input: "hello" } }, "claude-cli");
  assert.equal(store.lastSeq(s.id), 1);
  assert.throws(() => store.appendEvent(s.id, { type: "turn.failed", turnId: turn.id, payload: { turnId: turn.id, error: "x" } }, "claude-cli"), /projection refused/);
  assert.equal(store.lastSeq(s.id), 1, "last_seq rolled back");
  assert.equal(eventCount(store, s.id), 1, "event row rolled back");
  assert.equal(store.getTurn(turn.id)!.state, "running", "turn state untouched");
});

test("turn.* events update turn state in the same transaction", () => {
  const { store } = fresh();
  const s = mkSession(store);
  const t1 = store.createTurn(s.id, "one");
  assert.equal(store.getTurn(t1.id)!.state, "pending");
  assert.equal(store.runningTurn(s.id)!.delivery, "accepted");
  store.appendEvent(s.id, { type: "turn.started", turnId: t1.id, payload: { turnId: t1.id, input: "one" } }, "claude-cli");
  assert.equal(store.getTurn(t1.id)!.state, "running");
  assert.equal(store.runningTurn(s.id)!.delivery, "dispatched");
  store.appendEvent(s.id, { type: "turn.completed", turnId: t1.id, payload: { turnId: t1.id, result: "ok" } }, "claude-cli");
  const done = store.getTurn(t1.id)!;
  assert.equal(done.state, "completed");
  assert.ok(done.completedAt);
  assert.equal(store.runningTurn(s.id), null);

  const t2 = store.createTurn(s.id, "two");
  store.appendEvent(s.id, { type: "turn.failed", turnId: t2.id, payload: { turnId: t2.id, error: "boom" } }, "claude-cli");
  assert.equal(store.getTurn(t2.id)!.state, "failed");
  const t3 = store.createTurn(s.id, "three");
  store.appendEvent(s.id, { type: "turn.interrupted", turnId: t3.id, payload: { turnId: t3.id, reason: "user" } }, "system");
  assert.equal(store.getTurn(t3.id)!.state, "interrupted");
  assert.equal(store.countTurns(s.id), 3);
});

test("artifact.created projects into artifacts", () => {
  const { store } = fresh();
  const s = mkSession(store);
  store.appendEvent(s.id, { type: "artifact.created", payload: { artifact: { id: "a1", sessionId: s.id, kind: "report", pathOrUrl: "ears://x", title: "CHECK OK", createdAt: new Date().toISOString() }, body: "CHECK OK\n" } }, "system");
  const arts = store.listArtifacts(s.id);
  assert.equal(arts.length, 1);
  assert.equal(arts[0]!.kind, "report");
  assert.equal(arts[0]!.body, "CHECK OK\n");
});

test("acceptRequest: new, duplicate (with recorded result), conflict", () => {
  const { store } = fresh();
  assert.deepEqual(store.acceptRequest("turn:s1", "req-00001", { input: "a" }), { state: "new" });
  const dup1 = store.acceptRequest("turn:s1", "req-00001", { input: "a" });
  assert.equal(dup1.state, "duplicate");
  assert.equal(dup1.state === "duplicate" && dup1.status, "accepted");
  store.completeRequest("turn:s1", "req-00001", "completed", { kind: "turn", turnId: "t9" });
  const dup2 = store.acceptRequest("turn:s1", "req-00001", { input: "a" });
  assert.deepEqual(dup2, { state: "duplicate", status: "completed", result: { kind: "turn", turnId: "t9" } });
  assert.deepEqual(store.acceptRequest("turn:s1", "req-00001", { input: "b" }), { state: "conflict" });
  // the same id in another scope is independent
  assert.deepEqual(store.acceptRequest("turn:s2", "req-00001", { input: "b" }), { state: "new" });
});

test("acquireLock is exclusive; the loser gets the holder id; release frees it", () => {
  const { store } = fresh();
  assert.deepEqual(store.acquireLock("/songs/a", "sess-1", "gw-1", "rt-1"), { ok: true });
  assert.deepEqual(store.acquireLock("/songs/a", "sess-2", "gw-1", "rt-2"), { ok: false, holder: "sess-1" });
  assert.deepEqual(store.acquireLock("/songs/b", "sess-2", "gw-1", "rt-2"), { ok: true });
  assert.equal(store.lockHolder("/songs/a"), "sess-1");
  store.releaseLock("/songs/a", "sess-2"); // not the holder: no-op
  assert.equal(store.lockHolder("/songs/a"), "sess-1");
  store.setLockProcess("/songs/a", { pid: 1, startTime: "x", bootId: "b" });
  assert.deepEqual(store.listLocks().find((l) => l.workspacePath === "/songs/a")!.processIdentity, { pid: 1, startTime: "x", bootId: "b" });
  store.releaseLock("/songs/a", "sess-1");
  assert.equal(store.lockHolder("/songs/a"), null);
  assert.deepEqual(store.acquireLock("/songs/a", "sess-2", "gw-1", "rt-3"), { ok: true });
});

test("listEventsAfter honours afterSeq, limit and throughSeq", () => {
  const { store } = fresh();
  const s = mkSession(store);
  for (let i = 0; i < 6; i++) store.appendEvent(s.id, { type: "message.delta", turnId: "t", payload: { messageId: "m#0", role: "assistant", delta: String(i) } }, "claude-cli");
  assert.deepEqual(store.listEventsAfter(s.id, 0).map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(store.listEventsAfter(s.id, 2).map((e) => e.seq), [3, 4, 5, 6]);
  assert.deepEqual(store.listEventsAfter(s.id, 2, 2).map((e) => e.seq), [3, 4]);
  assert.deepEqual(store.listEventsAfter(s.id, 1, 500, 4).map((e) => e.seq), [2, 3, 4]);
  assert.deepEqual(store.listEventsAfter(s.id, 6).map((e) => e.seq), []);
  const e = store.listEventsAfter(s.id, 0, 1)[0]!;
  assert.equal(e.turnId, "t");
  assert.equal(e.type, "message.delta");
  assert.deepEqual(e.payload, { messageId: "m#0", role: "assistant", delta: "0" });
});

test("snapshot returns the session and its high-water mark", () => {
  const { store } = fresh();
  const s = mkSession(store);
  assert.equal(store.snapshot(s.id)!.lastSeq, 0);
  store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "started" } }, "system");
  store.appendEvent(s.id, { type: "session.status", payload: { status: "idle", reason: "turn-finished" } }, "system");
  const snap = store.snapshot(s.id)!;
  assert.equal(snap.lastSeq, 2);
  assert.equal(snap.session.status, "idle");
  assert.equal(store.snapshot("missing"), null);
});

test("migrations are idempotent on reopen and data survives", () => {
  const { store, dir } = fresh();
  const s = mkSession(store);
  store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "started" } }, "system");
  const v1 = (store.db.prepare("SELECT v FROM schema_version").get() as { v: number }).v;
  store.close();
  const again = new Store(dir);
  stores.push(again);
  assert.equal((again.db.prepare("SELECT v FROM schema_version").get() as { v: number }).v, v1);
  assert.equal((again.db.prepare("SELECT COUNT(*) AS n FROM schema_version").get() as { n: number }).n, 1);
  assert.equal(again.lastSeq(s.id), 1);
  assert.equal(again.appendEvent(s.id, { type: "session.status", payload: { status: "idle", reason: "turn-finished" } }, "system").seq, 2);
  again.close();
  // an extra migration applies once on top of the existing schema
  const extra = [`CREATE TABLE extra_t (x INTEGER)`];
  const third = new Store(dir, extra);
  stores.push(third);
  assert.equal((third.db.prepare("SELECT v FROM schema_version").get() as { v: number }).v, v1 + 1);
  third.close();
  const fourth = new Store(dir, extra);
  stores.push(fourth);
  assert.equal((fourth.db.prepare("SELECT v FROM schema_version").get() as { v: number }).v, v1 + 1);
});

test("deleting a session cascades to its events (foreign keys on)", () => {
  const { store } = fresh();
  const s = mkSession(store);
  store.appendEvent(s.id, { type: "session.status", payload: { status: "running", reason: "started" } }, "system");
  store.db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
  assert.equal(eventCount(store, s.id), 0);
});
