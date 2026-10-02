// compileSong: the ONE compiler. Used by the ears server (what the agent "hears"),
// by the gateway (what the browser plays) and by the browser for unsaved scratch
// evaluation. Pure: no fs, no node imports, so every caller gets the same string.

export type SongSection = { name: string; bars: number };
export type SongMeta = {
  title: string;
  bpm: number;
  key: string;
  scale: string;
  genre?: string;
  sections?: SongSection[];
  notes?: string;
  /** pitch classes accepted as in-key on top of the scale, e.g. ["B"] for a leading tone */
  allow_notes?: string[];
};

export type SongFiles = {
  /** song.json contents (raw text) */
  songJson: string;
  /** parts/<name>.js contents keyed by part name (file stem) */
  parts: Record<string, string>;
  /** arrange.js contents */
  arrange: string;
};

export type OffsetEntry = {
  /** repo-relative path, e.g. parts/bass.js */
  file: string;
  /** 1-based line in the compiled code where this file's first line sits */
  start: number;
  /** number of lines the file contributes */
  lines: number;
};

export type CompiledSong = {
  code: string;
  meta: SongMeta;
  /** parts in compile order */
  parts: string[];
  offsets: OffsetEntry[];
  /** the code with arrange.js replaced by a single part name, for per-part queries */
  partProbe: (part: string) => string;
};

export const PART_ORDER = ["drums", "bass", "chords", "lead", "fx"];
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function orderParts(names: string[]): string[] {
  const known = PART_ORDER.filter((p) => names.includes(p));
  const rest = names.filter((n) => !PART_ORDER.includes(n)).sort();
  return [...known, ...rest];
}

export function parseSongJson(raw: string): SongMeta {
  const j = JSON.parse(raw) as Partial<SongMeta>;
  const bpm = Number(j.bpm);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 300) throw new Error(`song.json: bpm must be a number 20..300, got ${j.bpm}`);
  return {
    title: String(j.title ?? "Untitled"),
    bpm,
    key: String(j.key ?? "C"),
    scale: String(j.scale ?? "minor"),
    genre: j.genre,
    sections: Array.isArray(j.sections) ? j.sections.map((s) => ({ name: String(s.name), bars: Number(s.bars) })) : [],
    notes: j.notes,
    allow_notes: Array.isArray(j.allow_notes) ? j.allow_notes.map(String) : undefined,
  };
}

/** setcpm(bpm/4): one cycle is one 4/4 bar. Verified in @strudel/core 1.2.6 repl.mjs (setcpm alias setCpm). */
export function tempoLine(bpm: number): string {
  return `setcpm(${bpm}/4)`;
}

export function compileFiles(files: SongFiles): CompiledSong {
  const meta = parseSongJson(files.songJson);
  const names = Object.keys(files.parts);
  for (const n of names) if (!IDENT.test(n)) throw new Error(`parts/${n}.js: a part file name must be a valid JS identifier`);
  const parts = orderParts(names);
  const lines: string[] = [];
  const offsets: OffsetEntry[] = [];
  lines.push(`// ${meta.title}: compiled by Algorave Room (song.json, parts/*, arrange.js)`);
  lines.push(tempoLine(meta.bpm));
  const push = (file: string, text: string) => {
    const body = text.replace(/\s+$/, "").split("\n");
    lines.push(`// ── ${file}`);
    offsets.push({ file, start: lines.length + 1, lines: body.length });
    lines.push(...body);
  };
  for (const p of parts) push(`parts/${p}.js`, files.parts[p] ?? "");
  const head = lines.join("\n");
  push("arrange.js", files.arrange);
  const code = lines.join("\n") + "\n";
  return {
    code,
    meta,
    parts,
    offsets,
    partProbe: (part: string) => `${head}\n// ── probe\n${part}\n`,
  };
}

/** Parts declared in parts/ but never referenced by arrange.js or another part. */
export function unusedParts(files: SongFiles): string[] {
  const strip = (t: string) => t.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.keys(files.parts).filter((p) => {
    const re = new RegExp(`(^|[^\\w$.])${p}(?![\\w$])`);
    if (re.test(strip(files.arrange))) return false;
    return !Object.entries(files.parts).some(([q, t]) => q !== p && re.test(strip(t)));
  });
}

/** Map a 1-based compiled line back to {file, line}. */
export function mapLine(offsets: OffsetEntry[], compiledLine: number): { file: string; line: number } | null {
  for (const o of offsets) {
    if (compiledLine >= o.start && compiledLine < o.start + o.lines) return { file: o.file, line: compiledLine - o.start + 1 };
  }
  return null;
}
