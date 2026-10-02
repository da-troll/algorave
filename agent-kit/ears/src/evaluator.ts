// The sandboxed half of strudel_check. Runs as its own Node process under
// `node --permission --allow-fs-read=<ears dist>` with an EMPTY environment
// (see sandbox.ts). Agent-written Strudel is JavaScript; evaluating it here
// cannot read the host's files, write anywhere, spawn processes or load
// addons. Network is NOT restricted by Node 22's permission model (residual,
// documented in PROJECT.md section 10).
//
// stdin: EvalRequest JSON. stdout: one EvalResult JSON line.
import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonalMod from "@strudel/tonal";
import { evaluate } from "@strudel/transpiler";
import { Scale, Note } from "@tonaljs/tonal";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockdown } from "./lockdown.ts";
import type { EvalRequest, EvalResult, PartStats, SectionStats } from "./report-types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sounds = JSON.parse(readFileSync(join(here, "sounds.json"), "utf8")) as {
  synths: string[]; soundfonts: string[]; samples: string[]; bankAliases: Record<string, string>;
};
const known = new Set<string>([...sounds.synths, ...sounds.soundfonts, ...sounds.samples]);
const synthSet = new Set(sounds.synths);
const sfSet = new Set(sounds.soundfonts);
const MAX_HAPS = 40000;
// tidal-drum-machines-alias.json maps FULL bank name -> alias (string or list).
// .bank() accepts either; resolve aliases back to the full name.
const aliasToBank = new Map<string, string>();
for (const [full, alias] of Object.entries(sounds.bankAliases as Record<string, string | string[]>)) {
  for (const a of Array.isArray(alias) ? alias : [alias]) aliasToBank.set(a.toLowerCase(), full);
  aliasToBank.set(full.toLowerCase(), full);
}

// Browser-only functions the REPL provides. Here they are no-ops; usage is
// recorded so the report can say "visual only, not checked".
const tempoCalls: Array<{ fn: string; value: number }> = [];
const browserOnly = new Set<string>();
function noop(name: string) {
  return (..._a: unknown[]) => { browserOnly.add(name); return undefined; };
}

async function setup() {
  await core.evalScope(core, mini, tonalMod);
  const g = globalThis as Record<string, unknown>;
  const cps = (fn: string, f: (v: number) => number) => (v: unknown) => { tempoCalls.push({ fn, value: f(Number(v)) }); };
  g.setcpm = cps("setcpm", (v) => v * 4); g.setCpm = g.setcpm;
  g.setcps = cps("setcps", (v) => v * 60 * 4); g.setCps = g.setcps;
  for (const n of ["samples", "initHydra", "H", "hush", "soundAlias", "aliasBank", "registerSound", "loadSoundfont", "getAudioContext", "registerSynthSounds"]) g[n] = noop(n);
  const P = core.Pattern.prototype as unknown as Record<string, unknown>;
  for (const n of ["pianoroll", "_pianoroll", "punchcard", "_punchcard", "scope", "_scope", "tscope", "_tscope", "fscope", "_fscope", "spectrum", "_spectrum", "spiral", "_spiral", "markcss", "piano", "hydra"]) {
    if (typeof P[n] !== "function") {
      P[n] = function (this: unknown) { browserOnly.add(`.${n}()`); return this; };
    }
  }
  // .piano() exists in the browser via prebake; mirror its sound so the check knows the sound.
  P.piano = function (this: { s: (x: string) => unknown }) { return this.s("piano"); };
}

type Hap = { whole?: { begin: { valueOf(): number } }; part: { begin: { valueOf(): number } }; value: unknown; hasOnset?: () => boolean };

function onsets(haps: Hap[]): Hap[] {
  return haps.filter((h) => (typeof h.hasOnset === "function" ? h.hasOnset() : !!h.whole));
}

function resolveSound(v: Record<string, unknown>): { name: string; kind: "synth" | "soundfont" | "sample" | "unknown" } | null {
  let s = v.s as unknown;
  if (s === undefined) {
    if (v.note !== undefined || v.freq !== undefined) return { name: "triangle", kind: "synth" };
    return null;
  }
  if (typeof s !== "string") return null;
  s = s.split(":")[0];
  let name = s as string;
  if (typeof v.bank === "string") {
    const bank = aliasToBank.get(v.bank.toLowerCase()) ?? v.bank;
    name = `${bank}_${name}`;
  }
  if (synthSet.has(name)) return { name, kind: "synth" };
  if (sfSet.has(name)) return { name, kind: "soundfont" };
  if (known.has(name)) return { name, kind: "sample" };
  return { name, kind: "unknown" };
}

function midiOf(v: Record<string, unknown>): number | null {
  const n = v.note;
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string") {
    const m = Note.midi(n);
    if (m !== null) return m;
  }
  if (typeof v.freq === "number") return Math.round(12 * Math.log2(v.freq / 440) + 69);
  return null;
}

const PC = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const noteName = (m: number) => `${PC[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

function errLine(e: unknown, code: string): number | undefined {
  const err = e as { loc?: { line: number }; message?: string; name?: string };
  if (err?.loc?.line) return err.loc.line;
  const msg = String(err?.message ?? "");
  const mini = /parse error at line (\d+)/.exec(msg);
  if (mini) return Number(mini[1]);
  const lines = code.split("\n");
  // ReferenceError: foo is not defined  /  TypeError: x.foo is not a function
  let ident = /^([A-Za-z_$][\w$]*) is not defined/.exec(msg)?.[1];
  if (ident) {
    const re = new RegExp(`(^|[^\\w$.])${ident.replace(/\$/g, "\\$")}\\s*\\(?`);
    const i = lines.findIndex((l) => re.test(l) && !l.trim().startsWith("//"));
    if (i >= 0) return i + 1;
  }
  ident = /\.?([A-Za-z_$][\w$]*) is not a function/.exec(msg)?.[1];
  if (ident) {
    const i = lines.findIndex((l) => l.includes(`.${ident}(`) && !l.trim().startsWith("//"));
    if (i >= 0) return i + 1;
  }
  return undefined;
}

async function evalCode(code: string): Promise<{ pattern: { queryArc: (a: number, b: number) => Hap[] } }> {
  const r = (await evaluate(code)) as { pattern?: unknown };
  if (!r || !r.pattern || typeof (r.pattern as { queryArc?: unknown }).queryArc !== "function") {
    throw new Error("the last expression does not evaluate to a pattern (arrange.js must end with arrange(...) or stack(...))");
  }
  return r as { pattern: { queryArc: (a: number, b: number) => Hap[] } };
}

function queryCapped(p: { queryArc: (a: number, b: number) => Hap[] }, from: number, to: number): Hap[] {
  const out: Hap[] = [];
  for (let c = from; c < to; c++) {
    const h = p.queryArc(c, c + 1);
    out.push(...h);
    if (out.length > MAX_HAPS) throw new Error(`more than ${MAX_HAPS} events in ${c - from + 1} cycles: the pattern is too dense to analyse`);
  }
  return out;
}

async function run(req: EvalRequest): Promise<EvalResult> {
  await setup();
  lockdown();
  // 1. full song, capturing arrange() sections
  let captured: Array<{ cycles: number }> | null = null;
  const g = globalThis as Record<string, unknown>;
  const realArrange = g.arrange as (...s: unknown[]) => unknown;
  g.arrange = (...sections: unknown[]) => {
    captured = sections.map((s) => ({ cycles: Number((s as unknown[])[0]) }));
    return realArrange(...sections);
  };
  let song;
  try {
    song = await evalCode(req.code);
  } catch (e) {
    // find which part broke: evaluate each part probe in order
    let line = errLine(e, req.code);
    if (line === undefined) {
      for (const p of req.parts) {
        try { await evalCode(req.probes[p]!); } catch (e2) { line = errLine(e2, req.probes[p]!); if (line === undefined) { const o = req.offsets.find((x) => x.file === `parts/${p}.js`); line = o?.start; } break; }
      }
    }
    return { ok: false, error: String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 300), compiledLine: line, tempoCalls, browserOnly: [...browserOnly] };
  }
  const arranged = captured as Array<{ cycles: number }> | null;
  const songBars = (req.meta.sections ?? []).reduce((a, s) => a + (s.bars || 0), 0);
  const total = Math.min(64, Math.max(1, arranged ? arranged.reduce((a, s) => a + s.cycles, 0) : songBars || 8));

  const songHaps = onsets(queryCapped(song.pattern, 0, total));

  // 2. per part
  const partStats: PartStats[] = [];
  const scaleNotes = Scale.get(`${req.meta.key} ${req.meta.scale}`).notes;
  const scaleChroma = new Set([...scaleNotes, ...(req.meta.allow_notes ?? [])].map((n) => Note.chroma(n)).filter((c): c is number => c !== undefined && c !== null && !Number.isNaN(c)));
  const outOfKey: Record<string, Record<string, number>> = {};
  const unknownSounds: Record<string, string[]> = {};
  const drumSounds = new Set<string>();
  const K = Math.min(total, 16);
  for (const p of req.parts) {
    let pat;
    try { pat = await evalCode(req.probes[p]!); } catch (e) {
      partStats.push({ part: p, error: String((e as Error).message).slice(0, 160) });
      continue;
    }
    const haps = onsets(queryCapped(pat.pattern, 0, K));
    const perCycle = Array.from({ length: K }, () => 0);
    const soundsUsed = new Set<string>();
    const pcs = new Set<string>();
    let lo = Infinity, hi = -Infinity;
    for (const h of haps) {
      const c = Math.floor(h.whole!.begin.valueOf());
      if (c >= 0 && c < K) perCycle[c]!++;
      const v = (h.value ?? {}) as Record<string, unknown>;
      const snd = resolveSound(v);
      if (snd) {
        soundsUsed.add(snd.name);
        if (snd.kind === "unknown") (unknownSounds[p] ??= []).includes(snd.name) || unknownSounds[p]!.push(snd.name);
      }
      const m = midiOf(v);
      if (m !== null && !(snd && snd.kind === "sample" && v.note === undefined)) {
        lo = Math.min(lo, m); hi = Math.max(hi, m);
        const pc = PC[((Math.round(m) % 12) + 12) % 12]!;
        pcs.add(pc);
        if (scaleChroma.size && !scaleChroma.has(((Math.round(m) % 12) + 12) % 12)) {
          const nm = noteName(m);
          (outOfKey[p] ??= {})[nm] = ((outOfKey[p] ??= {})[nm] ?? 0) + 1;
        }
      }
    }
    if (p === "drums") for (const n of soundsUsed) drumSounds.add(n);
    partStats.push({
      part: p,
      eventsPerCycle: { min: Math.min(...perCycle), avg: +(perCycle.reduce((a, b) => a + b, 0) / K).toFixed(1), max: Math.max(...perCycle) },
      sounds: [...soundsUsed].slice(0, 8),
      noteRange: Number.isFinite(lo) ? `${noteName(lo)}-${noteName(hi)}` : undefined,
      pitchClasses: [...pcs],
    });
  }

  // 3. sections
  const sections: SectionStats[] = [];
  const names = (req.meta.sections ?? []).map((s) => s.name);
  if (arranged) {
    let start = 0;
    arranged.forEach((s, i) => {
      const end = Math.min(start + s.cycles, total);
      if (start < total) {
        const n = songHaps.filter((h) => { const b = h.whole!.begin.valueOf(); return b >= start && b < end; }).length;
        sections.push({ name: names[i] ?? `section ${i + 1}`, bars: s.cycles, startBar: start + 1, eventsPerCycle: +(n / Math.max(1, end - start)).toFixed(1) });
      }
      start += s.cycles;
    });
  }

  // Drum grid: the first bar of each section (cap 3), drums part sounds only.
  const gridBars = (arranged ? sections.map((x) => ({ name: x.name, bar: x.startBar - 1 })) : [{ name: "bar 1", bar: 0 }]).slice(0, 3);
  const drumGrids: Array<{ name: string; bar: number; rows: Record<string, string> }> = [];
  if (drumSounds.size) {
    for (const gb of gridBars) {
      const rows: Record<string, string> = {};
      for (const h of songHaps) {
        const b = h.whole!.begin.valueOf() - gb.bar;
        if (b < 0 || b >= 1) continue;
        const snd = resolveSound((h.value ?? {}) as Record<string, unknown>);
        if (!snd || !drumSounds.has(snd.name)) continue;
        const row = (rows[snd.name] ??= ".".repeat(16));
        const i = Math.min(15, Math.floor(b * 16 + 1e-9));
        rows[snd.name] = row.slice(0, i) + "x" + row.slice(i + 1);
      }
      drumGrids.push({ name: gb.name, bar: gb.bar + 1, rows });
    }
  }
  const codeBpm = tempoCalls.length ? tempoCalls[tempoCalls.length - 1]!.value : null;
  return {
    ok: true,
    cyclesAnalysed: total,
    arranged: !!arranged,
    totalEvents: songHaps.length,
    tempo: { songJson: req.meta.bpm, code: codeBpm === null ? null : +codeBpm.toFixed(2), calls: tempoCalls.length },
    key: { key: req.meta.key, scale: req.meta.scale, notes: scaleNotes },
    parts: partStats,
    outOfKey,
    unknownSounds,
    drumGrids,
    sections,
    sectionsDeclared: req.meta.sections ?? [],
    arrangedSections: arranged ? arranged.map((x, i) => ({ name: names[i] ?? `section ${i + 1}`, bars: x.cycles })) : [],
    browserOnly: [...browserOnly],
    tempoCalls,
  };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  // Strudel logs to console; keep stdout for the one result line.
  const origLog = console.log;
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  let result: EvalResult;
  try {
    result = await run(JSON.parse(input) as EvalRequest);
  } catch (e) {
    result = { ok: false, error: `check crashed: ${String((e as Error)?.message ?? e).slice(0, 300)}`, tempoCalls, browserOnly: [...browserOnly] };
  }
  origLog(JSON.stringify(result));
  // Linger briefly so any async network attempt made by agent code actually
  // runs (and is refused) before exit, rather than being cut off by exit.
  setTimeout(() => process.exit(0), 200);
});
