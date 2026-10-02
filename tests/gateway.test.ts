// Gateway over HTTP (apps/gateway/dist/gateway.mjs on a scratch port + data dir).
// No real agent turns: chat/terminal sessions are never created here. A session is
// seeded straight into the scratch SQLite before boot so the events API, the WS
// replay and restart reconciliation can be exercised without spawning claude.
// Run: node scripts/build-gateway.mjs (if dist is stale), then node --test tests/gateway.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { Store } from "../packages/persistence/src/index.ts";
import { ROOT, api, connect, startGateway, type Gw } from "../scripts/lib/gw.ts";

const DIST = join(ROOT, "apps/gateway/dist/gateway.mjs");
let gw: Gw;
let dataDir: string;
const SEEDED = "11111111-2222-4333-8444-555555555555";
const SEEDED_TURN = "turn-seeded-dispatched";

function gitIn(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}
const songDir = (slug: string) => join(dataDir, "songs", slug);

before(async () => {
  if (!existsSync(DIST)) execFileSync(process.execPath, [join(ROOT, "scripts/build-gateway.mjs")], { cwd: ROOT, stdio: "inherit" });
  mkdirSync(join(ROOT, "data", "test-runs"), { recursive: true });
  dataDir = mkdtempSync(join(ROOT, "data", "test-runs", "gwtest-"));
  // Seed: a session that was "running" with a dispatched turn when the gateway died,
  // plus a lock held by another gateway instance with no recorded process.
  const seed = new Store(dataDir);
  seed.createSession({ id: SEEDED, adapter: "claude-cli", workspacePath: join(dataDir, "songs", "ghost-song"), workspaceMode: "in-place", status: "starting", capabilities: ["chat", "diff", "mcp"], providerSessionId: "prov-seeded" });
  seed.appendEvent(SEEDED, { type: "session.status", payload: { status: "running", reason: "provider-session", providerSessionId: "prov-seeded" } }, "claude-cli");
  seed.db.prepare("INSERT INTO turns (id,session_id,input,state,created_at) VALUES (?,?,?,?,?)").run(SEEDED_TURN, SEEDED, "make the bass lower", "pending", new Date().toISOString());
  seed.appendEvent(SEEDED, { type: "turn.started", turnId: SEEDED_TURN, payload: { turnId: SEEDED_TURN, input: "make the bass lower" } }, "claude-cli");
  seed.appendEvent(SEEDED, { type: "message.delta", turnId: SEEDED_TURN, payload: { messageId: "m#0", role: "assistant", delta: "Lowering" } }, "claude-cli");
  seed.acquireLock(join(dataDir, "songs", "ghost-song"), SEEDED, "a-dead-gateway-instance", "rt-dead");
  seed.close();
  gw = await startGateway({ data: dataDir });
});

after(async () => {
  if (gw) await gw.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("dist is not older than the gateway sources (rebuild with node scripts/build-gateway.mjs)", (t) => {
  const distM = statSync(DIST).mtimeMs;
  const srcs = ["apps/gateway/src", "packages/protocol/src", "packages/persistence/src", "packages/adapters/claude-cli/src"].flatMap((d) =>
    execFileSync("find", [join(ROOT, d), "-name", "*.ts"], { encoding: "utf8" }).trim().split("\n").filter(Boolean));
  const stale = srcs.filter((s) => statSync(s).mtimeMs > distM);
  if (stale.length) t.diagnostic(`stale: ${stale.join(", ")}`);
  assert.deepEqual(stale, []);
});

test("/api/health is open without identity", async () => {
  const r = await fetch(`${gw.base}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("/api/songs without the identity header -> 401", async () => {
  const r = await fetch(`${gw.base}/api/songs`, { headers: { host: `127.0.0.1:${gw.port}` } });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "unauthenticated");
});

// fetch() (undici) silently drops a caller-supplied Host header, so a Host test must use node:http.
function rawGet(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((res, rej) => {
    const r = httpRequest({ host: "127.0.0.1", port: gw.port, path, headers }, (m) => { m.resume(); res(m.statusCode!); });
    r.on("error", rej);
    r.end();
  });
}

test("a foreign Host over the wire -> 400 (DNS rebinding); a POST without X-Algorave -> 403", async () => {
  assert.equal(await rawGet("/api/songs", { host: "evil.example", "x-authentik-username": "daniel" }), 400);
  assert.equal(await rawGet("/api/songs", { host: `evil.example:${gw.port}`, "x-authentik-username": "daniel" }), 400);
  assert.equal(await rawGet("/api/songs", { host: `127.0.0.1:${gw.port}`, "x-authentik-username": "daniel" }), 200, "control: the allowed Host passes");
  const r = await api(gw, "POST", "/api/songs", {}, { "x-algorave": "" });
  assert.equal(r.status, 403);
});

test("an unknown /api route is a JSON 404, not the SPA", async () => {
  const r = await fetch(`${gw.base}/api/does-not-exist`, { headers: { host: `127.0.0.1:${gw.port}`, "x-authentik-username": "daniel" } });
  assert.equal(r.status, 404);
  assert.match(r.headers.get("content-type") ?? "", /application\/json/);
  assert.equal((await r.json()).error, "not-found");
});

test("restart reconciliation: the seeded running session is interrupted, the turn is delivery-unknown, nothing re-sent", async () => {
  const s = await api(gw, "GET", `/api/sessions/${SEEDED}`);
  assert.equal(s.status, 200);
  assert.equal(s.body.session.status, "interrupted");
  assert.equal(s.body.live, false);
  assert.equal(s.body.runningTurn, null);
  assert.deepEqual(s.body.session.recovery, { canResume: true });
  const ev = await api(gw, "GET", `/api/sessions/${SEEDED}/events?afterSeq=0`);
  const types = ev.body.events.map((e: any) => e.type);
  const ti = ev.body.events.find((e: any) => e.type === "turn.interrupted");
  assert.ok(ti, `turn.interrupted emitted (got ${types.join(",")})`);
  assert.equal(ti.payload.turnId, SEEDED_TURN);
  assert.match(ti.payload.reason, /delivery-unknown/);
  const reasons = ev.body.events.filter((e: any) => e.type === "session.status").map((e: any) => e.payload.reason);
  assert.ok(reasons.includes("interrupted-by-restart"));
  assert.ok(reasons.includes("stale-lock-reclaimed"), "the dead instance's lock was reclaimed");
  assert.ok(!types.includes("turn.started") || types.filter((t: string) => t === "turn.started").length === 1, "the prompt was not re-dispatched");
});

test("events API: paging, throughSeq, cursor beyond the high-water mark -> 400", async () => {
  const all = await api(gw, "GET", `/api/sessions/${SEEDED}/events`);
  assert.equal(all.status, 200);
  const H = all.body.highWaterSeq;
  assert.ok(H >= 5);
  assert.deepEqual(all.body.events.map((e: any) => e.seq), Array.from({ length: H }, (_, i) => i + 1));
  assert.equal(all.body.hasMore, false);
  assert.equal(all.body.nextAfterSeq, H);
  const part = await api(gw, "GET", `/api/sessions/${SEEDED}/events?afterSeq=1&throughSeq=3`);
  assert.deepEqual(part.body.events.map((e: any) => e.seq), [2, 3]);
  assert.equal(part.body.nextAfterSeq, 3);
  assert.equal(part.body.hasMore, false);
  for (const q of [`afterSeq=${H + 1}`, `afterSeq=-1`, `afterSeq=abc`, `afterSeq=0&throughSeq=${H + 5}`]) {
    const r = await api(gw, "GET", `/api/sessions/${SEEDED}/events?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error, "bad-cursor", q);
  }
  assert.equal((await api(gw, "GET", `/api/sessions/no-such-session/events`)).status, 404);
});

test("WS: replay of the seeded session (snapshot, events in order, replay.done)", async () => {
  const s = await connect(gw, SEEDED, 0);
  try {
    const done = await s.waitFor((e) => e.type === "replay.done", 5000, "replay.done");
    const snap = s.frames.find((f) => f.type === "snapshot");
    assert.ok(snap);
    assert.equal(snap.session.id, SEEDED);
    assert.equal(done.throughSeq, snap.lastSeq);
    assert.deepEqual(s.events.map((e) => e.seq), Array.from({ length: snap.lastSeq }, (_, i) => i + 1), "no gaps, no duplicates");
  } finally { s.close(); }
  const s2 = await connect(gw, SEEDED, 3);
  try {
    await s2.waitFor((e) => e.type === "replay.done", 5000, "replay.done");
    assert.equal(s2.events[0].seq, 4, "replay starts after the cursor");
  } finally { s2.close(); }
});

test("WS to a nonexistent session fails cleanly and the gateway stays up", async () => {
  await assert.rejects(Promise.race([connect(gw, "no-such-session"), new Promise((_, rej) => setTimeout(() => rej(new Error("hang")), 5000)).then(() => "hung")]), (e: Error) => e.message !== "hang");
  assert.equal((await fetch(`${gw.base}/api/health`)).status, 200);
});

test("WS upgrade with a foreign Origin is refused", async () => {
  const ok = await new Promise<string>((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/api/sessions/${SEEDED}/stream`, { headers: { origin: "https://evil.example", "x-authentik-username": "daniel", host: `127.0.0.1:${gw.port}` } } as any);
    ws.onopen = () => { ws.close(); res("opened"); };
    ws.onerror = () => res("refused");
    setTimeout(() => res("hang"), 5000);
  });
  assert.equal(ok, "refused");
});

// ---------- songs ----------
let blank: any;
let hard: any;

test("create a blank song: template files, one commit on main", async () => {
  const r = await api(gw, "POST", "/api/songs", { title: "Test Blank" });
  assert.equal(r.status, 201);
  blank = r.body;
  assert.match(blank.slug, /^test-blank-[0-9a-f]{4}$/);
  const d = songDir(blank.slug);
  for (const f of ["song.json", "arrange.js", "AGENTS.md", "parts/bass.js", "parts/drums.js"]) assert.ok(existsSync(join(d, f)), f);
  assert.equal(JSON.parse(readFileSync(join(d, "song.json"), "utf8")).title, "Test Blank");
  assert.equal(gitIn(d, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  assert.equal(gitIn(d, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(gitIn(d, ["log", "-1", "--format=%an"]), "Algorave Agent");
  assert.equal(blank.headCommit, gitIn(d, ["rev-parse", "HEAD"]));
});

test("create a song from genre hardgroove: starter parts + song.json bpm", async () => {
  const genre = JSON.parse(readFileSync(join(ROOT, "content/genres/hardgroove.json"), "utf8"));
  const r = await api(gw, "POST", "/api/songs", { genre: "hardgroove" });
  assert.equal(r.status, 201);
  hard = r.body;
  const d = songDir(hard.slug);
  const meta = JSON.parse(readFileSync(join(d, "song.json"), "utf8"));
  assert.equal(meta.bpm, genre.starter.bpm);
  assert.equal(meta.genre, genre.name);
  for (const [name, code] of Object.entries<string>(genre.starter.parts)) {
    assert.equal(readFileSync(join(d, "parts", `${name}.js`), "utf8"), code.trimEnd() + "\n", `parts/${name}.js`);
  }
  // template parts not in the starter are removed
  const extra = ["bass", "drums", "fx", "chords", "lead"].filter((p) => !(p in genre.starter.parts));
  for (const p of extra) assert.equal(existsSync(join(d, "parts", `${p}.js`)), false, `parts/${p}.js should be gone`);
  assert.equal(readFileSync(join(d, "arrange.js"), "utf8"), genre.starter.arrange.trimEnd() + "\n");
  assert.match(gitIn(d, ["log", "-1", "--format=%s"]), /starter/);
  const list = await api(gw, "GET", "/api/songs");
  assert.ok(list.body.some((s: any) => s.slug === hard.slug && s.bpm === genre.starter.bpm && s.branch === "main"));
});

test("an unknown genre -> 404", async () => {
  const r = await api(gw, "POST", "/api/songs", { genre: "polka" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "no-genre");
});

test("GET compiled: code contains setcpm and the arrange code", async () => {
  const r = await api(gw, "GET", `/api/songs/${hard.slug}/compiled`);
  assert.equal(r.status, 200);
  assert.match(r.body.code, /setcpm\(/);
  assert.match(r.body.code, /arrange/);
  const arrange = readFileSync(join(songDir(hard.slug), "arrange.js"), "utf8").trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("//"))!;
  assert.ok(r.body.code.includes(arrange.trim()), "the arrange.js body is in the compiled code");
  assert.equal(r.body.commit, hard.headCommit);
});

test("bad slugs are refused", async () => {
  assert.equal((await api(gw, "GET", "/api/songs/..%2F..%2Fetc/compiled")).status, 400);
  assert.equal((await api(gw, "GET", "/api/songs/no-such-song/compiled")).status, 404);
});

let firstSha: string;
let editSha: string;

test("PUT a file as the user commits with author You and message 'edit: parts/bass.js'", async () => {
  const d = songDir(hard.slug);
  firstSha = gitIn(d, ["rev-parse", "HEAD"]);
  const content = `// test edit\n$: note("c1").s("sawtooth")\n`;
  const r = await api(gw, "PUT", `/api/songs/${hard.slug}/files`, { path: "parts/bass.js", content, baseCommit: firstSha });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.committed, true);
  editSha = r.body.head;
  assert.notEqual(editSha, firstSha);
  assert.equal(gitIn(d, ["rev-parse", "HEAD"]), editSha);
  assert.equal(gitIn(d, ["log", "-1", "--format=%an <%ae>"]), "You <you@algorave.local>");
  assert.equal(gitIn(d, ["log", "-1", "--format=%s"]), "edit: parts/bass.js");
  assert.equal(readFileSync(join(d, "parts/bass.js"), "utf8"), content);
  // an identical PUT commits nothing
  const same = await api(gw, "PUT", `/api/songs/${hard.slug}/files`, { path: "parts/bass.js", content, baseCommit: editSha });
  assert.deepEqual(same.body, { head: editSha, committed: false });
});

test("PUT with a stale baseCommit -> 409 stale-base with the current head", async () => {
  const r = await api(gw, "PUT", `/api/songs/${hard.slug}/files`, { path: "parts/bass.js", content: "// x\n", baseCommit: firstSha });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "stale-base");
  assert.equal(r.body.head, editSha);
  assert.equal(gitIn(songDir(hard.slug), ["rev-parse", "HEAD"]), editSha, "nothing committed");
});

test("PUT to a non-editable path -> 403", async () => {
  for (const p of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", "../escape.js", "parts/../AGENTS.md", "parts/sub/x.js"]) {
    const r = await api(gw, "PUT", `/api/songs/${hard.slug}/files`, { path: p, content: "x", baseCommit: editSha });
    assert.equal(r.status, 403, p);
    assert.equal(r.body.error, "not-editable", p);
  }
});

test("PUT song.json with invalid JSON is refused and leaves the tree clean", async () => {
  const r = await api(gw, "PUT", `/api/songs/${hard.slug}/files`, { path: "song.json", content: "{not json", baseCommit: editSha });
  assert.equal(r.status, 400);
  assert.equal(gitIn(songDir(hard.slug), ["status", "--porcelain"]), "");
});

test("timeline lists commits newest first", async () => {
  const r = await api(gw, "GET", `/api/songs/${hard.slug}/timeline`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((c: any) => c.sha), [editSha, firstSha]);
  assert.equal(r.body[0].author, "You");
  assert.deepEqual(r.body[0].files, ["parts/bass.js"]);
  assert.equal(r.body[1].author, "Algorave Agent");
});

test("compiled?commit=<first sha> differs from HEAD after an edit", async () => {
  const head = await api(gw, "GET", `/api/songs/${hard.slug}/compiled`);
  const old = await api(gw, "GET", `/api/songs/${hard.slug}/compiled?commit=${firstSha}`);
  assert.equal(old.status, 200);
  assert.equal(old.body.commit, firstSha);
  assert.equal(head.body.commit, editSha);
  assert.notEqual(old.body.code, head.body.code);
  assert.ok(head.body.code.includes("// test edit"));
  assert.ok(!old.body.code.includes("// test edit"));
  assert.equal((await api(gw, "GET", `/api/songs/${hard.slug}/compiled?commit=--output=x`)).status, 400);
});

test("branch from the first commit creates idea/<name>; checkout back to main works", async () => {
  const d = songDir(hard.slug);
  const b = await api(gw, "POST", `/api/songs/${hard.slug}/branch`, { from: firstSha, name: "Dark Idea!" });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body, { branch: "idea/dark-idea", head: firstSha });
  assert.equal(gitIn(d, ["rev-parse", "--abbrev-ref", "HEAD"]), "idea/dark-idea");
  const det = await api(gw, "GET", `/api/songs/${hard.slug}`);
  assert.deepEqual([...det.body.branches].sort(), ["idea/dark-idea", "main"]);
  const c = await api(gw, "POST", `/api/songs/${hard.slug}/checkout`, { branch: "main" });
  assert.deepEqual(c.body, { branch: "main", head: editSha });
  assert.equal(gitIn(d, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  assert.equal((await api(gw, "POST", `/api/songs/${hard.slug}/checkout`, { branch: "nope" })).status, 404);
  assert.equal((await api(gw, "POST", `/api/songs/${hard.slug}/branch`, { from: "HEAD~1", name: "x" })).status, 400);
});

test("rewind creates a NEW commit whose tree equals the target", async () => {
  const d = songDir(hard.slug);
  const before = Number(gitIn(d, ["rev-list", "--count", "HEAD"]));
  const r = await api(gw, "POST", `/api/songs/${hard.slug}/rewind`, { to: firstSha });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.committed, true);
  assert.equal(Number(gitIn(d, ["rev-list", "--count", "HEAD"])), before + 1, "history grows, never rewritten");
  assert.equal(gitIn(d, ["rev-parse", "HEAD^{tree}"]), gitIn(d, ["rev-parse", `${firstSha}^{tree}`]));
  assert.equal(gitIn(d, ["rev-parse", "HEAD~1"]), editSha, "the edit is still in history");
  assert.match(gitIn(d, ["log", "-1", "--format=%s"]), new RegExp(`^rewind to ${firstSha.slice(0, 7)}`));
  // rewinding to where we already are commits nothing
  const again = await api(gw, "POST", `/api/songs/${hard.slug}/rewind`, { to: firstSha });
  assert.equal(again.body.committed, false);
});

test("runtime-report writes .runtime/last-eval.json", async () => {
  const r = await api(gw, "POST", `/api/songs/${hard.slug}/runtime-report`, { commit: firstSha, ok: false, error: "ReferenceError: foo is not defined", warnings: ["w1"] });
  assert.equal(r.status, 200);
  const f = join(songDir(hard.slug), ".runtime", "last-eval.json");
  assert.ok(existsSync(f));
  const rec = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(rec.ok, false);
  assert.equal(rec.error, "ReferenceError: foo is not defined");
  assert.equal(rec.commit, firstSha);
  assert.deepEqual(rec.warnings, ["w1"]);
  assert.equal(gitIn(songDir(hard.slug), ["status", "--porcelain"]), "", ".runtime is not a tracked change");
});

function tinyWav(samples = 16): string {
  const dataLen = samples * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + dataLen, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 2) * 8000), 44 + i * 2);
  return b.toString("base64");
}

test("takes: POST a tiny WAV, list it, GET it back as audio/wav", async () => {
  const wav = tinyWav();
  const r = await api(gw, "POST", `/api/songs/${hard.slug}/takes`, { wav, bars: 4 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.name, /^take-.*-4bars\.wav$/);
  assert.equal(r.body.bytes, 44 + 32);
  const list = await api(gw, "GET", `/api/songs/${hard.slug}/takes`);
  assert.ok(list.body.some((t: any) => t.name === r.body.name && t.bytes === 76));
  const g = await fetch(`${gw.base}/api/songs/${hard.slug}/takes/${r.body.name}`, { headers: { host: `127.0.0.1:${gw.port}`, "x-authentik-username": "daniel" } });
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.from(await g.arrayBuffer()).toString("base64"), wav);
  assert.equal(gitIn(songDir(hard.slug), ["status", "--porcelain"]), "", "takes are gitignored");
  assert.equal((await api(gw, "GET", `/api/songs/${hard.slug}/takes/..%2Fsong.json`)).status, 400);
  assert.equal((await api(gw, "GET", `/api/songs/${hard.slug}/takes/take-missing.wav`)).status, 404);
});

test("takes: a non-WAV is 422", async () => {
  const r = await api(gw, "POST", `/api/songs/${hard.slug}/takes`, { wav: Buffer.from("this is not a wav file at all, honestly, not even close").toString("base64"), bars: 4 });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "not-wav");
  const tooShort = await api(gw, "POST", `/api/songs/${hard.slug}/takes`, { wav: Buffer.from("RIFF0000WAVE").toString("base64"), bars: 4 });
  assert.equal(tooShort.status, 422);
});

test("POST /api/songs/:slug/sessions with adapter codex-app-server -> 422, no lock left behind", async () => {
  const r = await api(gw, "POST", `/api/songs/${blank.slug}/sessions`, { kind: "chat", adapter: "codex-app-server" });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "adapter-not-implemented");
  assert.equal(r.body.adapter, "codex-app-server");
  const det = await api(gw, "GET", `/api/songs/${blank.slug}`);
  assert.equal(det.body.writerSession, null);
  const sessions = await api(gw, "GET", "/api/sessions");
  assert.deepEqual(sessions.body.map((s: any) => s.id), [SEEDED], "no session row was created");
});

test("POST /api/sessions outside the songs dir -> 403", async () => {
  const r = await api(gw, "POST", "/api/sessions", { workspace: { path: "/home/eve" }, adapter: "codex-app-server" });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "workspace-not-allowed");
  const trav = await api(gw, "POST", "/api/sessions", { workspace: { path: join(dataDir, "songs", "..", "..", "x") }, adapter: "codex-app-server" });
  assert.equal(trav.status, 403);
});

test("invalid JSON and invalid bodies are 400, not 500", async () => {
  const r = await fetch(`${gw.base}/api/songs`, { method: "POST", headers: { host: `127.0.0.1:${gw.port}`, origin: `http://127.0.0.1:${gw.port}`, "x-authentik-username": "daniel", "x-algorave": "1", "content-type": "application/json" }, body: "{oops" });
  assert.equal(r.status, 400);
  const b = await api(gw, "POST", "/api/songs", { title: 42 });
  assert.equal(b.status, 400);
  assert.equal(b.body.error, "invalid-body");
});

test("GET / serves HTML with a content-security-policy header", async (t) => {
  if (!existsSync(join(ROOT, "out", "index.html"))) { t.skip("out/index.html not built"); return; }
  const r = await fetch(`${gw.base}/`, { headers: { host: `127.0.0.1:${gw.port}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  const csp = r.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
