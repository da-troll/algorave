// ears unit tests: the four fixtures from plan section 7, plus the sandbox.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";

const root = new URL("..", import.meta.url).pathname;
process.env.EARS_DIST = join(root, "agent-kit/ears/dist");
const { checkDir } = await import("../agent-kit/ears/src/check.ts");

function song(mut: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), "ears-test-"));
  cpSync(join(root, "agent-kit/song-template"), d, { recursive: true });
  for (const [f, c] of Object.entries(mut)) writeFileSync(join(d, f), c);
  return d;
}

before(() => {
  if (!existsSync(join(root, "agent-kit/ears/dist/evaluator.mjs"))) execFileSync("node", [join(root, "scripts/build-ears.mjs")]);
});

test("clean song passes", async () => {
  const r = await checkDir(song());
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^CHECK OK/);
  assert.match(r.text, /drums, intro \(bar 1\): silent/);
  assert.match(r.text, /drums, drop \(bar 17/);
  assert.match(r.text, /intro 8@1 .* \| build 8@9 .* \| drop 16@17/);
  assert.ok(r.text.length < 2000);
});

test("out-of-key note is reported with its part", async () => {
  const r = await checkDir(song({ "parts/bass.js": `const bass = note("c2 e2 c2 eb2").s("sawtooth")\n` }));
  assert.equal(r.ok, false);
  assert.match(r.text, /out of key in bass: E2x/);
});

test("unknown sound is reported", async () => {
  const r = await checkDir(song({ "parts/fx.js": `const fx = s("zorblax*2").gain(0.2)\n` }));
  assert.equal(r.ok, false);
  assert.match(r.text, /unknown sound in fx: zorblax/);
});

test("syntax error in bass.js line 2 maps to parts/bass.js:2", async () => {
  const r = await checkDir(song({ "parts/bass.js": `const bass = note("c2 eb2")\n  .s("sawtooth").lpf(800))\n` }));
  assert.equal(r.ok, false);
  assert.equal(r.error?.file, "parts/bass.js");
  assert.equal(r.error?.line, 2);
  assert.match(r.text, /at: parts\/bass\.js:2/);
});

test("undefined function maps to its part and line", async () => {
  const r = await checkDir(song({ "parts/lead.js": `// lead\nconst lead = note("c4").s("sine").wobblify(3)\n` }));
  assert.equal(r.ok, false);
  assert.equal(r.error?.file, "parts/lead.js");
  assert.equal(r.error?.line, 2);
});

test("tempo set in a part conflicts with song.json", async () => {
  const r = await checkDir(song({ "parts/fx.js": `setcpm(140/4)\nconst fx = s("white").gain(0.1)\n` }));
  assert.match(r.text, /code sets 140 bpm but song.json says 128/);
});

test("sandbox: agent-written code cannot read household files, write, or spawn", async () => {
  // Single quotes on purpose: the Strudel transpiler turns double-quoted strings
  // into mini-notation, so a double-quoted path would fail to PARSE and prove nothing.
  const attempts = [
    `const fx = s(String(process.getBuiltinModule('fs').readFileSync('/home/eve/config/household.json','utf8').length))`,
    `process.getBuiltinModule('fs').writeFileSync('/tmp/algorave-ears-escape.txt','x'); const fx = s('white')`,
    `const fx = s(process.getBuiltinModule('child_process').execSync('id').toString())`,
    `const fx = s(Object.keys(process.env).join('_') || 'white')`,
  ];
  for (const code of attempts) {
    const r = await checkDir(song({ "parts/fx.js": code + "\n" }));
    if (code.includes("process.env")) {
      assert.match(r.text, /CHECK OK/, "empty env: the fallback sound is used, no keys leak");
      continue;
    }
    assert.equal(r.ok, false, `should fail: ${code}\n${r.text}`);
    assert.match(r.text, /ERR_ACCESS_DENIED|denied|Access to this API has been restricted|disabled in the ears sandbox/i, r.text);
  }
  assert.equal(existsSync("/tmp/algorave-ears-escape.txt"), false);
});

test("unused part is a problem", async () => {
  const r = await checkDir(song({ "parts/pad.js": `const pad = note("c3").s("sine").gain(0.2)\n` }));
  assert.equal(r.ok, false);
  assert.match(r.text, /unused part: parts\/pad\.js/);
});

test("harmonic minor and allow_notes accept the leading tone", async () => {
  const tmpl = JSON.parse((await import("node:fs")).readFileSync(join(root, "agent-kit/song-template/song.json"), "utf8"));
  const lead = `const lead = note("c4 d4 eb4 b3").s("triangle").gain(0.3)\n`;
  assert.match((await checkDir(song({ "parts/lead.js": lead }))).text, /out of key in lead: B3/);
  // Harmonic minor accepts B but (correctly) flags the template's Bb chord.
  const hm = await checkDir(song({ "parts/lead.js": lead, "song.json": JSON.stringify({ ...tmpl, scale: "harmonic minor" }) }));
  assert.doesNotMatch(hm.text, /out of key in lead/, hm.text);
  assert.match(hm.text, /out of key in chords: Bb/);
  assert.equal((await checkDir(song({ "parts/lead.js": lead, "song.json": JSON.stringify({ ...tmpl, allow_notes: ["B"] }) }))).ok, true);
});

// Network: the box has unauthenticated loopback endpoints that act (the bridge's
// /inject on 18790, ClawHive on 3498). Agent code must not reach ANY socket.
// Evidence is a listener we own counting connections, plus a positive control.
const NET_ATTEMPTS = (port: number) => [
  `fetch('http://127.0.0.1:${port}/health')`,
  `process.getBuiltinModule('net').connect(${port}, '127.0.0.1')`,
  `import('node:net').then((n) => n.connect(${port}, '127.0.0.1'))`,
  `import('node:http').then((h) => h.get('http://127.0.0.1:${port}/'))`,
  `process.binding('tcp_wrap')`,
];

test("sandbox: agent code cannot open a network connection", async () => {
  let hits = 0;
  const srv = createServer((c) => { hits++; c.destroy(); });
  await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res));
  const port = (srv.address() as { port: number }).port;
  try {
    for (const a of NET_ATTEMPTS(port)) {
      const r = await checkDir(song({ "parts/fx.js": `try { ${a} } catch (e) {}\nconst fx = s('white').gain(0.1)\n` }));
      assert.ok(r.text.length > 0);
    }
    // Eve's two named targets, by their real ports: must be refused in-sandbox.
    for (const a of [`fetch('http://127.0.0.1:18790/health')`, `process.getBuiltinModule('net').connect(3498, '127.0.0.1')`]) {
      const r = await checkDir(song({ "parts/fx.js": `${a}\nconst fx = s('white').gain(0.1)\n` }));
      assert.equal(r.ok, false, a);
      assert.match(r.text, /fetch is not defined|is disabled in the ears sandbox/, r.text);
    }
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(hits, 0, "no connection may reach the listener from inside the sandbox");

    // Positive control: the same attempts, run as plain Node outside the sandbox, DO connect.
    for (const a of NET_ATTEMPTS(port).slice(0, 4)) {
      spawnSync(process.execPath, ["--input-type=module", "-e", `try { await ${a} } catch {} ; setTimeout(() => process.exit(0), 150)`], { timeout: 5000 });
    }
    await new Promise((res) => setTimeout(res, 200));
    assert.ok(hits >= 4, `control: expected >= 4 connections outside the sandbox, got ${hits}`);
  } finally {
    srv.close();
  }
});

test("silent part is a problem (unknown chord symbol plays nothing)", async () => {
  const r = await checkDir(song({ "parts/chords.js": `const chords = chord("<Abmaj7>").voicing().s("square").gain(0.3)\n` }));
  assert.match(r.text, /silent part: chords/);
});
