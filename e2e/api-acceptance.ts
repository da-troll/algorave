// Plan 13 items 6 and 7 against the DEPLOYED gateway (through e2e/edge-proxy.ts).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const base = "http://127.0.0.1:3597";
const H = { origin: base, "x-algorave": "1", "content-type": "application/json" };
const j = async (m: string, p: string, b?: unknown, h: Record<string, string> = {}) => { const r = await fetch(base + p, { method: m, headers: { ...H, ...h }, body: m === "GET" ? undefined : JSON.stringify(b ?? {}) }); return { s: r.status, b: await r.json() as any }; };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitTurn = async (sid: string, ms = 240000) => { const t0 = Date.now(); for (;;) { const r = await j("GET", `/api/sessions/${sid}`); if (!r.b.runningTurn) return r.b; if (Date.now() - t0 > ms) throw new Error("turn timeout"); await sleep(1000); } };

const song = (await j("POST", "/api/songs", { title: "Acceptance 6-7", genre: "acid-techno" })).b;
const dir = `/home/eve/projects/nightly-mvps/2026-10-02-algorave-room/data/songs/${song.slug}`;
const ses = (await j("POST", `/api/songs/${song.slug}/sessions`, { kind: "chat" })).b;
log(`song ${song.slug} session ${ses.id}`);
const second = await j("POST", `/api/songs/${song.slug}/sessions`, { kind: "terminal" });
assert.equal(second.s, 409); assert.equal(second.b.holder, ses.id);
log(`second writer refused: 409 ${second.b.error}, holder = the chat session`);

// 7: the user's edit refused while a turn runs
const detail = (await j("GET", `/api/songs/${song.slug}`)).b;
const t = await j("POST", `/api/sessions/${ses.id}/turns`, { input: "Make the acid line a touch more resonant. Keep it short." }, { "idempotency-key": crypto.randomUUID() });
assert.equal(t.s, 202);
await sleep(1500);
const during = await j("PUT", `/api/songs/${song.slug}/files`, { path: "parts/bass.js", content: detail.parts.bass + "// daniel\n", baseCommit: detail.head });
assert.equal(during.s, 409); assert.equal(during.b.error, "turn-running");
log(`the user's edit during the turn: 409 ${during.b.error}`);
const dup = await j("POST", `/api/sessions/${ses.id}/turns`, { input: "another" }, { "idempotency-key": crypto.randomUUID() });
assert.equal(dup.s, 409); log(`second prompt while running: 409 ${dup.b.error}`);
await waitTurn(ses.id);
const d2 = (await j("GET", `/api/songs/${song.slug}`)).b;
const after = await j("PUT", `/api/songs/${song.slug}/files`, { path: "parts/bass.js", content: d2.parts.bass.trimEnd() + "\n// tweaked by hand\n", baseCommit: d2.head });
assert.equal(after.s, 200); assert.equal(after.b.committed, true);
const top = execFileSync("git", ["-C", dir, "log", "-3", "--format=%an|%s"], { encoding: "utf8" }).trim().split("\n");
assert.match(top[0]!, /^You\|edit: parts\/bass\.js/); assert.match(top[1]!, /^Algorave Agent\|turn 1:/);
log(`after the turn: ${top[0]} / ${top[1]}`);
const stale = await j("PUT", `/api/songs/${song.slug}/files`, { path: "parts/bass.js", content: "x", baseCommit: d2.head });
assert.equal(stale.s, 409); log(`stale baseCommit: 409 ${stale.b.error}`);

// 6: gateway restart mid-turn: interrupted, repo intact, nothing re-sent
const t2 = await j("POST", `/api/sessions/${ses.id}/turns`, { input: "Add a short 2-bar breakdown before the peak and run the check." }, { "idempotency-key": crypto.randomUUID() });
assert.equal(t2.s, 202);
await sleep(4000);
const headBefore = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
execFileSync("/home/eve/projects/nightly-mvps/node_modules/.bin/pm2", ["restart", "2026-10-02-algorave-room"], { stdio: "ignore" });
log("pm2 restart (no --update-env)");
for (let i = 0; i < 40; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await sleep(250); }
const snap = (await j("GET", `/api/sessions/${ses.id}`)).b;
const ev = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=0`)).b;
let all = ev.events; let next = ev.nextAfterSeq; let more = ev.hasMore;
while (more) { const pg = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=${next}`)).b; all = all.concat(pg.events); next = pg.nextAfterSeq; more = pg.hasMore; }
const last = all.slice(-3).map((e: any) => `${e.type}:${e.payload.reason ?? e.payload.status ?? ""}`);
assert.equal(snap.session.status, "interrupted");
assert.equal(snap.live, false);
assert.equal(snap.runningTurn, null);
assert.ok(all.some((e: any) => e.type === "turn.interrupted" && /NOT re-sent|not sent/.test(e.payload.reason)));
const fsck = execFileSync("git", ["-C", dir, "fsck", "--no-progress"], { encoding: "utf8" });
log(`after restart: status ${snap.session.status}, recovery ${JSON.stringify(snap.session.recovery)}, last events ${last.join(", ")}; HEAD before ${headBefore.slice(0, 7)}; git fsck '${fsck.trim() || "clean"}'`);
const userMsgs = all.filter((e: any) => e.type === "message.completed" && e.payload.role === "user").length;
await sleep(5000);
const all2 = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=${next}`)).b.events;
assert.equal(all2.filter((e: any) => e.type === "turn.started").length, 0, "a prompt was re-sent after restart");
log(`nothing re-sent: ${userMsgs} user messages, 0 new turn.started in the 5 s after restart`);
// resume: offered and tested
const res = await j("POST", `/api/sessions/${ses.id}/resume`);
assert.equal(res.s, 200, JSON.stringify(res.b));
const t3 = await j("POST", `/api/sessions/${ses.id}/turns`, { input: "In one sentence: what was the last thing I asked you before this?" }, { "idempotency-key": crypto.randomUUID() });
await waitTurn(ses.id);
const tail = (await j("GET", `/api/sessions/${ses.id}/events?afterSeq=${next}`)).b.events;
const reply = tail.filter((e: any) => e.type === "message.completed" && e.payload.role === "assistant").map((e: any) => e.payload.text).join(" ");
log(`resume: ${res.b.status}; reply after resume: ${reply.slice(0, 200)}`);
assert.match(reply, /breakdown|resonan/i, "resumed conversation did not remember prior context");
await j("POST", `/api/sessions/${ses.id}/stop`);
console.log("API ACCEPTANCE 6-7 PASSED");
