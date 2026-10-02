// pnpm smoke:claude (plan 5.4): a REAL claude session through the gateway.
// Asserts: init, skill names in the reply, parts/bass.js changed, an
// mcp__ears__strudel_check call that returned OK, turn.completed, a commit.
// Saves the raw CLI JSONL as a fixture.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, api, connect, rid, startGateway } from "./lib/gw.ts";

const capture = join(ROOT, "data", "capture");
mkdirSync(capture, { recursive: true });
const gw = await startGateway({ env: { ALGORAVE_CAPTURE_DIR: capture } });
const results: string[] = [];
const ok = (m: string) => { results.push(`PASS ${m}`); console.log(`PASS ${m}`); };
try {
  const song = (await api(gw, "POST", "/api/songs", { title: "Smoke test" })).body;
  const dir = join(gw.data, "songs", song.slug);
  const bassBefore = readFileSync(join(dir, "parts/bass.js"), "utf8");
  const s = await api(gw, "POST", `/api/songs/${song.slug}/sessions`, { kind: "chat" });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const st = await connect(gw, s.body.id);
  const t = await api(gw, "POST", `/api/sessions/${s.body.id}/turns`, { input: "List the skills you can use, then make the bass an octave lower and run the check." }, { "idempotency-key": rid() });
  assert.equal(t.status, 202);
  await st.waitFor((e) => e.type === "session.status" && e.payload.reason === "provider-session", 60_000, "init");
  ok("init received (provider session id stored)");
  const done = await st.waitFor((e) => (e.type === "turn.completed" || e.type === "turn.failed") && e.payload.turnId === t.body.turnId, 240_000, "turn end");
  assert.equal(done.type, "turn.completed", JSON.stringify(done.payload));
  ok("turn.completed");
  const reply = st.events.filter((e) => e.type === "message.completed" && e.payload.role === "assistant").map((e) => e.payload.text).join("\n");
  for (const sk of ["strudel-core", "strudel-genres", "strudel-arrangement", "strudel-sound-design", "song-workflow"]) assert.match(reply, new RegExp(sk), `skill ${sk} missing from reply: ${reply}`);
  ok("all five skill names in the reply");
  assert.ok(st.events.some((e) => e.type === "message.delta"), "no streamed deltas");
  ok("streamed message.delta events");
  const checks = st.events.filter((e) => e.type === "tool.started" && e.payload.name === "mcp__ears__strudel_check");
  assert.ok(checks.length > 0, "no strudel_check call");
  const lastCheck = st.events.filter((e) => e.type === "artifact.created" && e.payload.artifact.pathOrUrl === "ears://strudel_check").pop();
  assert.ok(lastCheck?.payload.ok, `last check not OK: ${lastCheck?.payload.body}`);
  ok(`mcp__ears__strudel_check called ${checks.length}x, last returned OK`);
  // the commit lands right after turn.completed
  await st.waitFor((e) => e.type === "artifact.created" && e.payload.artifact.pathOrUrl.startsWith("commit:"), 15_000, "commit");
  const bassAfter = readFileSync(join(dir, "parts/bass.js"), "utf8");
  assert.notEqual(bassAfter, bassBefore);
  ok("parts/bass.js changed");
  const log = execFileSync("git", ["-C", dir, "log", "--format=%an|%s"], { encoding: "utf8" }).trim().split("\n");
  assert.match(log[0]!, /^Algorave Agent\|turn 1: List the skills/);
  ok(`commit exists: ${log[0]}`);
  const seqs = st.events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);
  ok(`${seqs.length} events, seq strictly increasing, no duplicates`);
  const f = readdirSync(capture).find((x) => x.startsWith(s.body.id));
  if (f) {
    const out = join(ROOT, "packages/adapters/claude-cli/fixtures/smoke-turn.raw.jsonl");
    const raw = readFileSync(join(capture, f), "utf8").split("\n").filter(Boolean)
      .filter((l) => !l.includes('"rate_limit_event"'))
      .map((l) => { const j = JSON.parse(l); if (j.type === "system" && j.subtype === "init") return JSON.stringify({ type: j.type, subtype: j.subtype, session_id: j.session_id, tools: j.tools, mcp_servers: j.mcp_servers, model: j.model, permissionMode: j.permissionMode, claude_code_version: j.claude_code_version }); return l; })
      .join("\n").replaceAll(gw.data, "/DATA").replaceAll("/home/eve", "/HOME");
    (await import("node:fs")).writeFileSync(out, raw + "\n");
    ok(`raw JSONL fixture saved (${raw.split("\n").length} lines)`);
  }
  await api(gw, "POST", `/api/sessions/${s.body.id}/stop`, {});
  st.close();
} finally {
  await gw.stop();
}
console.log(`\nsmoke:claude ${results.length} checks passed`);
