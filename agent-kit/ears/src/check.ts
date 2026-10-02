// strudel_check: compile the song, evaluate it in a sandboxed child process,
// map errors back to part files, and format a compact report (< ~2 KB) that
// goes into the model's context every turn.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSongFiles, compileFiles, unusedParts, mapLine, type CompiledSong } from "./compile-song.ts";
import type { SongFiles } from "./compile-core.ts";
import type { CheckReport, EvalRequest, EvalResult } from "./report-types.ts";

const TIMEOUT_MS = 20_000;

/** Directory holding evaluator.mjs and sounds.json (the built dist). */
export function earsDistDir(): string {
  return process.env.EARS_DIST ?? dirname(fileURLToPath(import.meta.url));
}

export function runSandboxed(req: EvalRequest, distDir = earsDistDir()): Promise<EvalResult> {
  return new Promise((resolve) => {
    // Node permission model: read only the ears dist; no writes, no child
    // processes, no workers, no native addons; empty environment.
    const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${distDir}`, join(distDir, "evaluator.mjs")], {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(line) as EvalResult);
      } catch {
        resolve({ ok: false, error: `evaluator failed${out || err ? `: ${(err || out).trim().split("\n").pop()?.slice(0, 200)}` : " (timeout or crash)"}`, tempoCalls: [], browserOnly: [] });
      }
    });
    child.stdin.end(JSON.stringify(req));
  });
}

export function requestFor(c: CompiledSong): EvalRequest {
  const probes: Record<string, string> = {};
  for (const p of c.parts) probes[p] = c.partProbe(p);
  return { code: c.code, probes, parts: c.parts, offsets: c.offsets, meta: c.meta };
}

export async function checkDir(dir: string, distDir?: string): Promise<CheckReport> {
  let files: SongFiles;
  try {
    files = readSongFiles(dir);
  } catch (e) {
    const message = String((e as Error).message);
    return { ok: false, problems: [message], error: { message }, text: `CHECK FAILED\n${message}` };
  }
  return checkFiles(files, distDir);
}

export async function checkFiles(files: SongFiles, distDir?: string): Promise<CheckReport> {
  try {
    return await checkCompiled(compileFiles(files), distDir, unusedParts(files));
  } catch (e) {
    const message = String((e as Error).message);
    return { ok: false, problems: [message], error: { message }, text: `CHECK FAILED\n${message}` };
  }
}

export async function checkCompiled(compiled: CompiledSong, distDir?: string, unused: string[] = []): Promise<CheckReport> {
  const result = await runSandboxed(requestFor(compiled), distDir);
  if (!result.ok) {
    const loc = result.compiledLine ? mapLine(compiled.offsets, result.compiledLine) : null;
    const where = loc ? `${loc.file}:${loc.line}` : result.compiledLine && result.compiledLine <= 2 ? "song.json (tempo line)" : "unknown location";
    const text = `CHECK FAILED\nerror: ${result.error}\nat: ${where}\nFix it before ending the turn. The browser keeps playing the previous version until this passes.`;
    return { ok: false, problems: [`${where}: ${result.error}`], error: { message: result.error, file: loc?.file, line: loc?.line }, result, text };
  }
  const problems = problemsOf(result, unused);
  return { ok: problems.length === 0, problems, result, text: formatReport(result, unused) };
}

function problemsOf(r: Extract<EvalResult, { ok: true }>, unused: string[] = []): string[] {
  const p: string[] = [];
  for (const u of unused) p.push(`unused part: parts/${u}.js is never reached by arrange.js, so it is silent`);
  for (const [part, notes] of Object.entries(r.outOfKey)) {
    p.push(`out of key in ${part}: ${Object.entries(notes).map(([n, c]) => `${n}x${c}`).join(" ")}`);
  }
  for (const [part, s] of Object.entries(r.unknownSounds)) p.push(`unknown sound in ${part}: ${s.join(", ")} (the browser plays silence for these)`);
  for (const ps of r.parts) if (ps.error) p.push(`part ${ps.part} does not evaluate alone: ${ps.error}`);
  for (const ps of r.parts) if (!ps.error && ps.eventsPerCycle && ps.eventsPerCycle.max === 0) p.push(`silent part: ${ps.part} produces 0 events (Strudel plays unknown chord symbols like Abmaj7 or scale names like minor_pentatonic as silence; use Ab^7, C3:minor:pentatonic)`);
  if (r.tempo.code !== null && Math.abs(r.tempo.code - r.tempo.songJson) > 0.01) p.push(`tempo: code sets ${r.tempo.code} bpm but song.json says ${r.tempo.songJson}; change song.json instead of calling setcpm/setcps in parts`);
  return p;
}

export function formatReport(r: Extract<EvalResult, { ok: true }>, unused: string[] = []): string {
  const L: string[] = [];
  const probs = problemsOf(r, unused);
  L.push(probs.length ? `CHECK: ${probs.length} problem(s)` : "CHECK OK");
  L.push(`tempo ${r.tempo.songJson} bpm (code ${r.tempo.code ?? r.tempo.songJson}) · key ${r.key.key} ${r.key.scale} [${r.key.notes.join(" ")}] · ${r.cyclesAnalysed} bars analysed${r.arranged ? " (arranged)" : " (loop)"} · ${r.totalEvents} events`);
  for (const pr of probs) L.push(`! ${pr}`);
  L.push("parts (events/bar min/avg/max · sounds · range):");
  for (const p of r.parts) {
    if (p.error) { L.push(`  ${p.part}: ERROR ${p.error}`); continue; }
    const e = p.eventsPerCycle!;
    L.push(`  ${p.part}: ${e.min}/${e.avg}/${e.max} · ${p.sounds!.join(",") || "-"}${p.noteRange ? ` · ${p.noteRange} {${p.pitchClasses!.join(" ")}}` : ""}`);
  }
  for (const g of r.drumGrids) {
    if (!Object.keys(g.rows).length) { L.push(`drums, ${g.name} (bar ${g.bar}): silent`); continue; }
    L.push(`drums, ${g.name} (bar ${g.bar}, 16 steps):`);
    for (const [s, row] of Object.entries(g.rows).slice(0, 6)) L.push(`  ${s.padEnd(14).slice(0, 14)} ${row.slice(0, 4)} ${row.slice(4, 8)} ${row.slice(8, 12)} ${row.slice(12)}`);
  }
  if (r.sections.length) {
    L.push("sections (bars @start · events/bar):");
    L.push("  " + r.sections.map((s) => `${s.name} ${s.bars}@${s.startBar} ${s.eventsPerCycle}`).join(" | "));
    const declared = r.sectionsDeclared.map((s) => s.bars).join(" ");
    const actual = r.arrangedSections.map((s) => s.bars).join(" ");
    if (declared && declared !== actual) L.push(`  note: song.json section bars (${declared}) differ from arrange.js (${actual}); keep them in sync`);
    const total = r.arrangedSections.reduce((a, s) => a + s.bars, 0);
    if (total > r.cyclesAnalysed) L.push(`  (analysis covers bars 1-${r.cyclesAnalysed} of ${total})`);
  }
  if (r.browserOnly.length) L.push(`visual/browser-only (not checked): ${r.browserOnly.join(", ")}`);
  let text = L.join("\n");
  if (text.length > 2000) text = text.slice(0, 1990) + "\n…";
  return text;
}
