// Content tests: every genre starter, every Guided Path lesson snippet and every
// ```js block in the agent skills must pass the same checker the agent uses
// (agent-kit/ears strudel_check). Run: node --test tests/content.test.ts
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
process.env.EARS_DIST = join(root, "agent-kit/ears/dist");
if (!existsSync(join(root, "agent-kit/ears/dist/evaluator.mjs"))) {
  execFileSync("node", [join(root, "scripts/build-ears.mjs")], { stdio: "inherit" });
}
const { checkFiles, runSandboxed } = await import("../agent-kit/ears/src/check.ts");
const { compileFiles } = await import("../agent-kit/ears/src/compile-core.ts");

const GENRES = join(root, "content/genres");
const PATH = join(root, "content/path");
const SKILLS = join(root, "agent-kit/skills");
const LESSON_SONG = JSON.stringify({ title: "lesson", bpm: 128, key: "C", scale: "minor", sections: [] });

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const genreFiles = readdirSync(GENRES).filter((f) => f.endsWith(".json")).sort();
const lessonFiles = readdirSync(PATH).filter((f) => f.endsWith(".json")).sort();

function walkMd(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    // do not follow the genres symlink (JSON, not markdown) or sounds.json
    const st = statSync(p);
    if (st.isDirectory()) {
      if (f === "genres") continue;
      walkMd(p, out);
    } else if (f.endsWith(".md")) out.push(p);
  }
  return out;
}

function jsBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /```js\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push(m[1]!);
  return out;
}

/**
 * Check a free-standing snippet (lesson or skill example). checkFiles with no
 * parts never inspects sounds (unknown sounds are counted per part), so the
 * snippet is ALSO evaluated as a single probe "part" whose code is the whole
 * snippet; that is what makes an unknown sound fail here.
 */
async function checkSnippet(code: string) {
  const [r, probe] = await Promise.all([
    checkFiles({ songJson: LESSON_SONG, parts: {}, arrange: code }),
    (async () => {
      const c = compileFiles({ songJson: LESSON_SONG, parts: {}, arrange: code });
      return runSandboxed({ code: c.code, probes: { snippet: c.code }, parts: ["snippet"], offsets: c.offsets, meta: c.meta });
    })(),
  ]);
  return { r, probe };
}

function assertSnippetOk(label: string, code: string, res: Awaited<ReturnType<typeof checkSnippet>>) {
  const { r, probe } = res;
  assert.equal(r.error, undefined, `${label}: ${r.text}\n---\n${code}`);
  assert.ok(!r.problems.some((p) => p.startsWith("unknown sound")), `${label}: ${r.text}`);
  assert.equal(probe.ok, true, `${label}: probe failed: ${!probe.ok ? probe.error : ""}`);
  if (probe.ok) {
    assert.deepEqual(probe.unknownSounds, {}, `${label}: unknown sounds ${JSON.stringify(probe.unknownSounds)}\n---\n${code}`);
    assert.ok(probe.totalEvents > 0, `${label}: snippet is silent (0 events)\n---\n${code}`);
  }
}

before(() => {
  assert.ok(existsSync(join(root, "agent-kit/ears/dist/evaluator.mjs")), "ears dist not built");
});

// -- shape ------------------------------------------------------------------
test("at least 10 genre cards with every field", () => {
  assert.ok(genreFiles.length >= 10, `only ${genreFiles.length} genres`);
  for (const f of genreFiles) {
    const g = readJson(join(GENRES, f));
    assert.equal(`${g.id}.json`, f, `${f}: id must match file name`);
    for (const k of ["id", "name", "bpm_range", "key_tendency", "signature", "listen_for", "artists_reference", "starter"]) {
      assert.ok(g[k] !== undefined && g[k] !== "", `${f}: missing ${k}`);
    }
    assert.ok(Array.isArray(g.bpm_range) && g.bpm_range.length === 2 && g.bpm_range[0] <= g.bpm_range[1], `${f}: bpm_range`);
    assert.ok(Array.isArray(g.signature) && g.signature.length >= 4 && g.signature.length <= 6, `${f}: signature needs 4 to 6 bullets`);
    assert.ok(Array.isArray(g.artists_reference) && g.artists_reference.length > 0, `${f}: artists_reference`);
    const st = g.starter;
    for (const k of ["bpm", "key", "scale", "sections", "parts", "arrange"]) assert.ok(st[k] !== undefined, `${f}: starter.${k}`);
    assert.ok(st.bpm >= g.bpm_range[0] && st.bpm <= g.bpm_range[1], `${f}: starter bpm ${st.bpm} outside bpm_range`);
    for (const [name, code] of Object.entries(st.parts as Record<string, string>)) {
      assert.match(name, /^[A-Za-z_$][A-Za-z0-9_$]*$/, `${f}: part name ${name}`);
      const decls = code.match(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm) ?? [];
      assert.equal(decls.length, 1, `${f}: part ${name} must declare exactly one const`);
      assert.match(code, new RegExp(`^const ${name} =`, "m"), `${f}: part ${name} must be "const ${name} = ..."`);
    }
  }
});

test("exactly 10 lessons, ordered 1..10, with every field", () => {
  assert.equal(lessonFiles.length, 10);
  const orders = lessonFiles.map((f) => readJson(join(PATH, f)).order).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const f of lessonFiles) {
    const l = readJson(join(PATH, f));
    for (const k of ["id", "order", "title", "goal", "explain", "reference_snippet", "try_prompt"]) assert.ok(l[k], `${f}: missing ${k}`);
    assert.equal(f, `${String(l.order).padStart(2, "0")}-${l.id}.json`, `${f}: file name must be NN-id.json`);
    assert.doesNotMatch(l.reference_snippet, /setc[pP]m|setc[pP]s/, `${f}: lessons must not set tempo`);
  }
});

test("no em dashes or CJK in content or skills", () => {
  const files = [
    ...genreFiles.map((f) => join(GENRES, f)),
    ...lessonFiles.map((f) => join(PATH, f)),
    ...walkMd(SKILLS),
  ];
  for (const p of files) {
    const t = readFileSync(p, "utf8");
    assert.ok(!t.includes("\u2014"), `${relative(root, p)}: em dash`);
    assert.ok(!/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(t), `${relative(root, p)}: CJK`);
  }
});

// -- genre starters: full check must be OK ------------------------------------
for (const f of genreFiles) {
  test(`genre starter passes strudel_check: ${f}`, async () => {
    const g = readJson(join(GENRES, f));
    const st = g.starter;
    const songJson = JSON.stringify({ title: g.name, bpm: st.bpm, key: st.key, scale: st.scale, genre: g.name, sections: st.sections });
    const r = await checkFiles({ songJson, parts: st.parts, arrange: st.arrange });
    assert.equal(r.ok, true, r.text);
    assert.ok(r.result && r.result.ok, r.text);
    if (r.result && r.result.ok) {
      assert.equal(r.result.arranged, true, `${f}: arrange.js must use arrange(...)`);
      const actual = r.result.sections.map((s: { name: string; bars: number }) => `${s.name}:${s.bars}`).join(" ");
      const declared = st.sections.map((s: { name: string; bars: number }) => `${s.name}:${s.bars}`).join(" ");
      assert.equal(actual, declared, `${f}: sections in arrange do not match starter.sections\n${r.text}`);
      for (const p of r.result.parts) assert.ok((p.eventsPerCycle?.max ?? 0) > 0, `${f}: part ${p.part} is silent`);
    }
  });
}

// -- lessons -----------------------------------------------------------------
for (const f of lessonFiles) {
  test(`lesson snippet evaluates with known sounds: ${f}`, async () => {
    const l = readJson(join(PATH, f));
    assertSnippetOk(f, l.reference_snippet, await checkSnippet(l.reference_snippet));
  });
}

// -- skill code blocks ---------------------------------------------------------
const mdFiles = existsSync(SKILLS) ? walkMd(SKILLS) : [];
test("skills have js examples to check", () => {
  const n = mdFiles.reduce((a, p) => a + jsBlocks(readFileSync(p, "utf8")).length, 0);
  assert.ok(n >= 20, `only ${n} js blocks found in skills`);
});
for (const p of mdFiles) {
  const blocks = jsBlocks(readFileSync(p, "utf8"));
  if (!blocks.length) continue;
  test(`skill examples pass strudel_check: ${relative(SKILLS, p)} (${blocks.length} blocks)`, async () => {
    const results = await Promise.all(blocks.map((b) => checkSnippet(b)));
    blocks.forEach((b, i) => assertSnippetOk(`${relative(SKILLS, p)} block ${i + 1}`, b, results[i]!));
  });
}
