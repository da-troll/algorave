// Song service (app-specific, plan section 6). One git repo per song under
// data/songs/<slug>. This is project code, not gateway-template code.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Store } from "@agent-gateway/persistence";
import { compileFiles, readSongFiles, type SongFiles } from "@algorave/ears/compile";
import { CONTENT_DIR, SONGS_DIR, TEMPLATE_DIR } from "./config.ts";
import { AGENT, USER, branch as gitBranch, git, head as gitHead } from "./git.ts";

export const SONG_MIGRATIONS = [
  `CREATE TABLE songs (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL, genre TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    last_session_id TEXT, head_commit TEXT, path_progress_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE commit_checks (
    slug TEXT NOT NULL, commit_sha TEXT NOT NULL, ok INTEGER NOT NULL, summary TEXT NOT NULL, text TEXT NOT NULL,
    PRIMARY KEY (slug, commit_sha)
  );`,
];

export class HttpError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 422, readonly code: string, message: string, readonly extra?: Record<string, unknown>) { super(message); }
}

const EDITABLE = /^(parts\/[A-Za-z_$][\w$]*\.js|arrange\.js|song\.json)$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;

export type Genre = {
  id: string; name: string; bpm_range: [number, number]; key_tendency: string; signature: string[]; listen_for: string; artists_reference: string[];
  starter: { bpm: number; key: string; scale: string; sections: Array<{ name: string; bars: number }>; parts: Record<string, string>; arrange: string };
};
export type Lesson = { id: string; order: number; title: string; goal: string; explain: string; reference_snippet: string; try_prompt: string };

export function loadGenres(): Genre[] {
  const d = join(CONTENT_DIR, "genres");
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(d, f), "utf8")) as Genre).sort((a, b) => a.name.localeCompare(b.name));
}
export function loadLessons(): Lesson[] {
  const d = join(CONTENT_DIR, "path");
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(d, f), "utf8")) as Lesson).sort((a, b) => a.order - b.order);
}

export type SongRow = { slug: string; title: string; genre: string | null; createdAt: string; updatedAt: string; lastSessionId: string | null; headCommit: string | null; progress: string[] };

export class SongService {
  /** set by the session manager: is an agent turn running in this song? */
  turnRunning: (slug: string) => boolean = () => false;
  /** set by the session manager: is any writer session holding this song? */
  writerSession: (slug: string) => string | null = () => null;

  constructor(private store: Store) {
    mkdirSync(SONGS_DIR, { recursive: true });
  }

  dir(slug: string): string {
    if (!SLUG.test(slug)) throw new HttpError(400, "bad-slug", "invalid song id");
    const d = join(SONGS_DIR, slug);
    if (!existsSync(join(d, "song.json"))) throw new HttpError(404, "no-song", `no song ${slug}`);
    return realpathSync(d);
  }

  private row(r: Record<string, unknown>): SongRow {
    return { slug: r.slug as string, title: r.title as string, genre: (r.genre as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string, lastSessionId: (r.last_session_id as string) ?? null, headCommit: (r.head_commit as string) ?? null, progress: JSON.parse((r.path_progress_json as string) || "[]") };
  }
  get(slug: string): SongRow {
    const r = this.store.db.prepare("SELECT * FROM songs WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
    if (!r) throw new HttpError(404, "no-song", `no song ${slug}`);
    return this.row(r);
  }
  touch(slug: string, patch: { headCommit?: string; lastSessionId?: string }) {
    const now = new Date().toISOString();
    if (patch.headCommit) this.store.db.prepare("UPDATE songs SET head_commit = ?, updated_at = ? WHERE slug = ?").run(patch.headCommit, now, slug);
    if (patch.lastSessionId) this.store.db.prepare("UPDATE songs SET last_session_id = ?, updated_at = ? WHERE slug = ?").run(patch.lastSessionId, now, slug);
  }

  async list() {
    const rows = (this.store.db.prepare("SELECT * FROM songs ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map((r) => this.row(r));
    return Promise.all(rows.map(async (s) => {
      const d = join(SONGS_DIR, s.slug);
      let meta: Record<string, unknown> = {};
      let br = "";
      let last = "";
      try { meta = JSON.parse(readFileSync(join(d, "song.json"), "utf8")); br = await gitBranch(d); last = (await git(d, ["log", "-1", "--format=%aI"])).trim(); } catch { /* broken song dir */ }
      return { ...s, bpm: meta.bpm, key: meta.key, scale: meta.scale, genre: (meta.genre as string) ?? s.genre, branch: br, lastChange: last || s.updatedAt };
    }));
  }

  async create(opts: { title?: string; genre?: string }): Promise<SongRow> {
    const genre = opts.genre ? loadGenres().find((g) => g.id === opts.genre) : undefined;
    if (opts.genre && !genre) throw new HttpError(404, "no-genre", `no genre ${opts.genre}`);
    const title = (opts.title?.trim() || (genre ? `${genre.name} jam` : "New song")).slice(0, 80);
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "song";
    const slug = `${base}-${randomBytes(2).toString("hex")}`;
    const d = join(SONGS_DIR, slug);
    cpSync(TEMPLATE_DIR, d, { recursive: true, verbatimSymlinks: true });
    const song = JSON.parse(readFileSync(join(d, "song.json"), "utf8"));
    song.title = title;
    if (genre) {
      const s = genre.starter;
      Object.assign(song, { bpm: s.bpm, key: s.key, scale: s.scale, genre: genre.name, sections: s.sections });
      for (const f of readdirSync(join(d, "parts"))) rmSync(join(d, "parts", f));
      for (const [name, code] of Object.entries(s.parts)) writeFileSync(join(d, "parts", `${name}.js`), code.trimEnd() + "\n");
      writeFileSync(join(d, "arrange.js"), s.arrange.trimEnd() + "\n");
    }
    writeFileSync(join(d, "song.json"), JSON.stringify(song, null, 2) + "\n");
    await git(d, ["init", "-q", "-b", "main"]);
    await git(d, ["add", "-A"]);
    await git(d, ["commit", "-q", "-m", genre ? `new song (${genre.name} starter)` : "new song"], { author: AGENT });
    const now = new Date().toISOString();
    this.store.db.prepare("INSERT INTO songs (slug,title,genre,created_at,updated_at,head_commit) VALUES (?,?,?,?,?,?)").run(slug, title, genre?.name ?? song.genre ?? null, now, now, await gitHead(d));
    return this.get(slug);
  }

  async detail(slug: string) {
    const d = this.dir(slug);
    const files = readSongFiles(d);
    return {
      song: this.get(slug), meta: JSON.parse(files.songJson), parts: files.parts, arrange: files.arrange,
      branch: await gitBranch(d), head: await gitHead(d), branches: (await git(d, ["branch", "--format=%(refname:short)"])).trim().split("\n").filter(Boolean),
      writerSession: this.writerSession(slug), turnRunning: this.turnRunning(slug),
    };
  }

  /** Files at a commit, read with git (never checking it out). */
  async filesAt(slug: string, commit: string): Promise<SongFiles> {
    const d = this.dir(slug);
    if (!/^[0-9a-f]{4,40}$|^HEAD$/.test(commit)) throw new HttpError(400, "bad-commit", "invalid commit");
    const names = (await git(d, ["ls-tree", "-r", "--name-only", commit])).trim().split("\n");
    const parts: Record<string, string> = {};
    for (const n of names) {
      const m = /^parts\/([A-Za-z_$][\w$]*)\.js$/.exec(n);
      if (m) parts[m[1]!] = await git(d, ["show", `${commit}:${n}`]);
    }
    return { songJson: await git(d, ["show", `${commit}:song.json`]), parts, arrange: names.includes("arrange.js") ? await git(d, ["show", `${commit}:arrange.js`]) : "" };
  }

  async compiled(slug: string, commit?: string) {
    const d = this.dir(slug);
    const files = commit && commit !== "WORKTREE" ? await this.filesAt(slug, commit) : readSongFiles(d);
    const c = compileFiles(files);
    return { code: c.code, offsets: c.offsets, parts: c.parts, meta: c.meta, commit: commit && commit !== "WORKTREE" ? (await git(d, ["rev-parse", commit])).trim() : await gitHead(d) };
  }

  async putFile(slug: string, body: { path: string; content: string; baseCommit: string }) {
    const d = this.dir(slug);
    if (!EDITABLE.test(body.path)) throw new HttpError(403, "not-editable", "only parts/*.js, arrange.js and song.json can be edited");
    if (typeof body.content !== "string" || body.content.length > 100_000) throw new HttpError(413, "too-big", "content too large");
    if (this.turnRunning(slug)) throw new HttpError(409, "turn-running", "the agent is working on this song; wait for the turn to finish");
    const h = await gitHead(d);
    if (body.baseCommit !== h) throw new HttpError(409, "stale-base", "the song changed since you loaded it", { head: h });
    if (body.path === "song.json") JSON.parse(body.content);
    writeFileSync(join(d, body.path), body.content.endsWith("\n") ? body.content : body.content + "\n");
    await git(d, ["add", "--", body.path]);
    const staged = (await git(d, ["diff", "--cached", "--name-only"])).trim();
    if (!staged) return { head: h, committed: false };
    await git(d, ["commit", "-q", "-m", `edit: ${body.path}`], { author: USER });
    const nh = await gitHead(d);
    this.touch(slug, { headCommit: nh });
    return { head: nh, committed: true };
  }

  async timeline(slug: string, limit = 100) {
    const d = this.dir(slug);
    const raw = await git(d, ["log", `-${limit}`, "--format=%x1e%H%x1f%an%x1f%aI%x1f%s", "--name-only"]);
    const checks = new Map((this.store.db.prepare("SELECT commit_sha, ok, summary FROM commit_checks WHERE slug = ?").all(slug) as Array<{ commit_sha: string; ok: number; summary: string }>).map((r) => [r.commit_sha, r]));
    return raw.split("\x1e").filter((x) => x.trim()).map((rec) => {
      const [line, ...files] = rec.trim().split("\n");
      const [sha, author, date, subject] = line!.split("\x1f");
      const ck = checks.get(sha!);
      return { sha: sha!, author: author!, date: date!, subject: subject!, files: files.filter(Boolean), check: ck ? { ok: !!ck.ok, summary: ck.summary } : null };
    });
  }

  async show(slug: string, commit: string) {
    const d = this.dir(slug);
    if (!/^[0-9a-f]{4,40}$/.test(commit)) throw new HttpError(400, "bad-commit", "invalid commit");
    const diff = await git(d, ["show", "--no-ext-diff", "--no-textconv", "--format=", "--patch", commit], { maxBuffer: 1024 * 1024 });
    const ck = this.store.db.prepare("SELECT ok, text FROM commit_checks WHERE slug = ? AND commit_sha = ?").get(slug, (await git(d, ["rev-parse", commit])).trim()) as { ok: number; text: string } | undefined;
    return { diff: diff.slice(0, 200_000), truncated: diff.length > 200_000, check: ck ? { ok: !!ck.ok, text: ck.text } : null };
  }

  recordCheck(slug: string, commit: string, ok: boolean, text: string) {
    const summary = text.split("\n")[0]!.slice(0, 120);
    this.store.db.prepare("INSERT OR REPLACE INTO commit_checks (slug, commit_sha, ok, summary, text) VALUES (?,?,?,?,?)").run(slug, commit, ok ? 1 : 0, summary, text.slice(0, 4000));
  }

  private assertIdle(slug: string) {
    if (this.turnRunning(slug)) throw new HttpError(409, "turn-running", "the agent is working on this song");
  }

  async branchFrom(slug: string, from: string, name: string) {
    const d = this.dir(slug);
    this.assertIdle(slug);
    const clean = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!clean) throw new HttpError(400, "bad-name", "branch name required");
    if (!/^[0-9a-f]{4,40}$/.test(from)) throw new HttpError(400, "bad-commit", "invalid commit");
    if ((await git(d, ["status", "--porcelain"])).trim()) throw new HttpError(409, "dirty", "the song has uncommitted changes");
    await git(d, ["checkout", "-q", "-b", `idea/${clean}`, from]);
    const h = await gitHead(d);
    this.touch(slug, { headCommit: h });
    return { branch: `idea/${clean}`, head: h };
  }

  async checkout(slug: string, br: string) {
    const d = this.dir(slug);
    this.assertIdle(slug);
    const branches = (await git(d, ["branch", "--format=%(refname:short)"])).trim().split("\n");
    if (!branches.includes(br)) throw new HttpError(404, "no-branch", `no branch ${br}`);
    if ((await git(d, ["status", "--porcelain"])).trim()) throw new HttpError(409, "dirty", "the song has uncommitted changes");
    await git(d, ["checkout", "-q", br]);
    const h = await gitHead(d);
    this.touch(slug, { headCommit: h });
    return { branch: br, head: h };
  }

  /** Rewind = a NEW commit restoring the tree of `to`. History is never rewritten. */
  async rewind(slug: string, to: string) {
    const d = this.dir(slug);
    this.assertIdle(slug);
    if (!/^[0-9a-f]{4,40}$/.test(to)) throw new HttpError(400, "bad-commit", "invalid commit");
    if ((await git(d, ["status", "--porcelain"])).trim()) throw new HttpError(409, "dirty", "the song has uncommitted changes");
    const full = (await git(d, ["rev-parse", to])).trim();
    await git(d, ["read-tree", "-u", "--reset", full]);
    if (!(await git(d, ["diff", "--cached", "--name-only"])).trim()) return { head: await gitHead(d), committed: false };
    await git(d, ["commit", "-q", "-m", `rewind to ${full.slice(0, 7)}`], { author: USER });
    const h = await gitHead(d);
    this.touch(slug, { headCommit: h });
    return { head: h, committed: true };
  }

  runtimeReport(slug: string, body: { commit?: string; ok: boolean; error?: string; warnings?: string[] }) {
    const d = this.dir(slug);
    mkdirSync(join(d, ".runtime"), { recursive: true });
    const rec = { commit: String(body.commit ?? "").slice(0, 40), at: new Date().toISOString(), ok: !!body.ok, error: body.error ? String(body.error).slice(0, 1000) : null, warnings: (body.warnings ?? []).slice(0, 20).map((w) => String(w).slice(0, 300)) };
    writeFileSync(join(d, ".runtime", "last-eval.json"), JSON.stringify(rec, null, 2) + "\n");
    return rec;
  }

  setProgress(slug: string, done: string[]) {
    this.get(slug);
    this.store.db.prepare("UPDATE songs SET path_progress_json = ? WHERE slug = ?").run(JSON.stringify(done.slice(0, 50).map(String)), slug);
  }

  // ---------- takes (gitignored) ----------
  saveTake(slug: string, wavBase64: string, bars: number) {
    const d = this.dir(slug);
    const buf = Buffer.from(wavBase64, "base64");
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new HttpError(422, "not-wav", "not a WAV file");
    mkdirSync(join(d, "takes"), { recursive: true });
    const name = `take-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.round(bars) || 0}bars.wav`;
    writeFileSync(join(d, "takes", name), buf);
    return { name, bytes: buf.length };
  }
  listTakes(slug: string) {
    const d = join(this.dir(slug), "takes");
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => f.endsWith(".wav")).map((f) => ({ name: f, bytes: statSync(join(d, f)).size, at: statSync(join(d, f)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at));
  }
  takePath(slug: string, name: string): string {
    if (!/^take-[\w-]+\.wav$/.test(name)) throw new HttpError(400, "bad-name", "invalid take");
    const p = join(this.dir(slug), "takes", name);
    if (!existsSync(p)) throw new HttpError(404, "no-take", "no such take");
    return p;
  }
}
