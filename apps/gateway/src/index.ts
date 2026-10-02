// Algorave Room gateway: Hono + better-sqlite3 + WS. Serves the web app (out/)
// and /api/* on loopback and the docker bridge address only.
import { Hono, type Context } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { z } from "zod";
import { CreateSessionBody, resolveTheme, type UiConfig } from "@agent-gateway/protocol";
import { Store } from "@agent-gateway/persistence";
import { apiAuth } from "./auth.ts";
import { Bus } from "./bus.ts";
import { BIND, DATA_DIR, MODELS, DEFAULT_MODEL, PORT, SONGS_DIR, WEB_DIR } from "./config.ts";
import { SessionManager } from "./sessions.ts";
import { HttpError, SONG_MIGRATIONS, SongService, loadGenres, loadLessons } from "./songs.ts";
import { streamHandlers } from "./ws.ts";

const store = new Store(DATA_DIR, SONG_MIGRATIONS);
const bus = new Bus();
const songs = new SongService(store);
const sessions = new SessionManager(store, bus, songs);
sessions.reconcile();

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// ---------- errors ----------
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: "invalid-body", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "invalid-json", message: err.message }, 400);
  console.error(err);
  return c.json({ error: "internal", message: "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.use("/api/*", async (c, next) => (c.req.path === "/api/health" ? next() : apiAuth(c, next)));

const body = async <T,>(c: Context, schema: z.ZodType<T>): Promise<T> => schema.parse(await c.req.json());

// ---------- config ----------
app.get("/api/config/ui", (c) => {
  const cfg: UiConfig = { theme: resolveTheme({ name: "algorave-room", theme: { palette: "catppuccin", flavor: "mocha", accent: "mauve", initial: "dark" } }), adapters: { default: "claude-cli", enabled: ["claude-cli", "pty"] }, panels: { stock: ["conversation", "activity", "review", "terminal"], project: ["repl", "timeline", "visuals", "path", "genres", "record"] } };
  return c.json({ ...cfg, models: MODELS, defaultModel: DEFAULT_MODEL, user: c.req.header("x-authentik-username") });
});

// ---------- content ----------
app.get("/api/content/genres", (c) => c.json(loadGenres()));
app.get("/api/content/path", (c) => c.json(loadLessons()));

// ---------- songs ----------
app.get("/api/songs", async (c) => c.json(await songs.list()));
app.post("/api/songs", async (c) => c.json(await songs.create(await body(c, z.object({ title: z.string().max(80).optional(), genre: z.string().max(60).optional() }))), 201));
app.get("/api/songs/:slug", async (c) => c.json(await songs.detail(c.req.param("slug"))));
app.get("/api/songs/:slug/compiled", async (c) => c.json(await songs.compiled(c.req.param("slug"), c.req.query("commit") ?? undefined)));
app.put("/api/songs/:slug/files", async (c) => c.json(await songs.putFile(c.req.param("slug"), await body(c, z.object({ path: z.string(), content: z.string(), baseCommit: z.string() })))));
app.get("/api/songs/:slug/timeline", async (c) => c.json(await songs.timeline(c.req.param("slug"))));
app.get("/api/songs/:slug/commits/:sha", async (c) => c.json(await songs.show(c.req.param("slug"), c.req.param("sha"))));
app.post("/api/songs/:slug/branch", async (c) => { const b = await body(c, z.object({ from: z.string(), name: z.string().max(40) })); return c.json(await songs.branchFrom(c.req.param("slug"), b.from, b.name)); });
app.post("/api/songs/:slug/checkout", async (c) => c.json(await songs.checkout(c.req.param("slug"), (await body(c, z.object({ branch: z.string().max(80) }))).branch)));
app.post("/api/songs/:slug/rewind", async (c) => c.json(await songs.rewind(c.req.param("slug"), (await body(c, z.object({ to: z.string() }))).to)));
app.put("/api/songs/:slug/progress", async (c) => { songs.setProgress(c.req.param("slug"), (await body(c, z.object({ done: z.array(z.string()) }))).done); return c.json({ ok: true }); });
app.post("/api/songs/:slug/runtime-report", async (c) => {
  const slug = c.req.param("slug");
  const rec = songs.runtimeReport(slug, await body(c, z.object({ commit: z.string().optional(), ok: z.boolean(), error: z.string().optional(), warnings: z.array(z.string()).optional() })));
  const sid = songs.writerSession(slug);
  if (sid && !rec.ok) {
    const e = store.appendEvent(sid, { type: "artifact.created", payload: { artifact: { id: crypto.randomUUID(), sessionId: sid, kind: "log", pathOrUrl: ".runtime/last-eval.json", title: `browser: ${rec.error?.slice(0, 80)}`, createdAt: rec.at }, summary: `Browser evaluation failed: ${rec.error}`, body: JSON.stringify(rec, null, 2), ok: false } }, "system");
    bus.publish(sid, e);
  }
  return c.json(rec);
});
app.get("/api/songs/:slug/takes", (c) => c.json(songs.listTakes(c.req.param("slug"))));
app.post("/api/songs/:slug/takes", async (c) => { const b = await body(c, z.object({ wav: z.string().max(80_000_000), bars: z.number() })); return c.json(songs.saveTake(c.req.param("slug"), b.wav, b.bars), 201); });
app.get("/api/songs/:slug/takes/:name", (c) => {
  const p = songs.takePath(c.req.param("slug"), c.req.param("name"));
  return new Response(readFileSync(p), { headers: { "content-type": "audio/wav", "content-disposition": `inline; filename="${c.req.param("name")}"` } });
});
app.post("/api/songs/:slug/sessions", async (c) => {
  const b = await body(c, z.object({ kind: z.enum(["chat", "terminal"]), model: z.string().optional(), adapter: z.string().optional() }));
  return c.json(await sessions.createForSong(c.req.param("slug"), b), 201);
});

// ---------- sessions (GW-PLAN 7.4) ----------
app.get("/api/sessions", (c) => c.json(store.listSessions().map((s) => ({ ...s, live: sessions.isLive(s.id) }))));
app.post("/api/sessions", async (c) => {
  // Generic create: only song workspaces are allowed in this project.
  const b = await body(c, CreateSessionBody);
  const real = normalize(b.workspace.path);
  if (!real.startsWith(SONGS_DIR + "/")) throw new HttpError(403, "workspace-not-allowed", "sessions can only be created in song workspaces");
  const slug = real.slice(SONGS_DIR.length + 1).split("/")[0]!;
  const kind = b.adapter === "pty" ? "terminal" : "chat";
  return c.json(await sessions.createForSong(slug, { kind, model: b.model, adapter: b.adapter }), 201);
});
app.get("/api/sessions/:id", (c) => {
  const snap = store.snapshot(c.req.param("id"));
  if (!snap) throw new HttpError(404, "no-session", "no such session");
  return c.json({ ...snap, live: sessions.isLive(c.req.param("id")), runningTurn: store.runningTurn(c.req.param("id")) });
});
app.get("/api/sessions/:id/events", (c) => {
  const id = c.req.param("id");
  const snap = store.snapshot(id);
  if (!snap) throw new HttpError(404, "no-session", "no such session");
  const after = Number(c.req.query("afterSeq") ?? 0);
  const through = c.req.query("throughSeq") !== undefined ? Number(c.req.query("throughSeq")) : snap.lastSeq;
  if (!Number.isInteger(after) || after < 0 || after > snap.lastSeq || !Number.isInteger(through) || through > snap.lastSeq) throw new HttpError(400, "bad-cursor", `cursor out of range (0..${snap.lastSeq})`);
  const events = store.listEventsAfter(id, after, 500, through);
  const next = events.length ? events[events.length - 1]!.seq : after;
  return c.json({ events, nextAfterSeq: next, hasMore: next < through, highWaterSeq: snap.lastSeq });
});
app.get("/api/sessions/:id/artifacts", (c) => c.json(store.listArtifacts(c.req.param("id"))));
app.post("/api/sessions/:id/turns", async (c) => {
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8) throw new HttpError(400, "idempotency-key", "Idempotency-Key header required");
  const b = await body(c, z.object({ input: z.string().min(1).max(20000) }));
  const r = await sessions.submitTurn(c.req.param("id"), b.input, key);
  return c.json(r.body, r.status as 200 | 202);
});
app.post("/api/sessions/:id/interrupt", async (c) => c.json(await sessions.interrupt(c.req.param("id"))));
app.post("/api/sessions/:id/stop", async (c) => c.json(await sessions.stop(c.req.param("id"))));
app.post("/api/sessions/:id/resume", async (c) => c.json(await sessions.resume(c.req.param("id"))));
app.post("/api/sessions/:id/terminal/ownership", async (c) => { const b = await body(c, z.object({ clientId: z.string().min(8).max(80), steal: z.boolean().optional() })); return c.json(sessions.claimOwnership(c.req.param("id"), b.clientId, !!b.steal)); });
app.post("/api/sessions/:id/terminal/input", async (c) => { const b = await body(c, z.object({ clientId: z.string(), generation: z.number(), data: z.string().max(65536) })); await sessions.terminalInput(c.req.param("id"), b.clientId, b.generation, b.data); return c.json({ ok: true }); });
app.post("/api/sessions/:id/terminal/resize", async (c) => { const b = await body(c, z.object({ clientId: z.string(), generation: z.number(), cols: z.number().int().min(10).max(500), rows: z.number().int().min(4).max(300) })); await sessions.terminalResize(c.req.param("id"), b.clientId, b.generation, b.cols, b.rows); return c.json({ ok: true }); });
app.get("/api/sessions/:id/stream", upgradeWebSocket((c) => {
  const id = c.req.param("id")!;
  if (!store.getSession(id)) throw new HttpError(404, "no-session", "no such session");
  return streamHandlers(store, bus, sessions, id, (c.req.query("clientId") ?? crypto.randomUUID()).slice(0, 80));
}));

// unknown API routes are a 404, never the SPA shell
app.all("/api/*", (c) => c.json({ error: "not-found", message: `no route ${c.req.method} ${c.req.path}` }, 404));

// ---------- static web app ----------
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".wasm": "application/wasm", ".ico": "image/x-icon", ".txt": "text/plain" };
// Agent-written Strudel runs in the page. Limit where it can connect: self plus
// the sample/soundfont hosts the REPL loads (PROJECT.md section 10).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://raw.githubusercontent.com https://strudel.b-cdn.net https://felixroos.github.io https://cdn.freesound.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");
app.get("*", (c) => {
  const rel = normalize(decodeURIComponent(c.req.path)).replace(/^(\.\.(\/|$))+/, "");
  let p = join(WEB_DIR, rel);
  if (!p.startsWith(WEB_DIR) || !existsSync(p) || statSync(p).isDirectory()) p = join(WEB_DIR, "index.html");
  if (!existsSync(p)) return c.text("web app not built", 503);
  const type = TYPES[extname(p)] ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type, "x-content-type-options": "nosniff" };
  if (type.startsWith("text/html")) { headers["content-security-policy"] = CSP; headers["cache-control"] = "no-cache"; }
  else if (p.includes("/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
  return new Response(readFileSync(p), { headers });
});

const servers = BIND.map((hostname) => {
  const s = serve({ fetch: app.fetch, port: PORT, hostname });
  injectWebSocket(s);
  return s;
});
console.log(`algorave gateway on ${BIND.map((b) => `${b}:${PORT}`).join(", ")}; data ${DATA_DIR}`);

let closing = false;
async function shutdown(sig: string) {
  if (closing) return;
  closing = true;
  console.log(`${sig}: stopping sessions`);
  await sessions.shutdown();
  for (const s of servers) s.close();
  store.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
