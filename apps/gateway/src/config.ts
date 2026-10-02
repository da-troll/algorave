// Gateway configuration from the environment. Nothing secret lives here.
import { realpathSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findAppRoot(): string {
  if (process.env.ALGORAVE_ROOT) return resolve(process.env.ALGORAVE_ROOT);
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    d = dirname(d);
  }
  throw new Error("cannot find the app root (pnpm-workspace.yaml); set ALGORAVE_ROOT");
}

export const APP_ROOT = realpathSync(findAppRoot());
export const PORT = Number(process.env.PORT ?? 3553);
/** loopback for host tools + the docker bridge address Caddy reaches as host.docker.internal */
export const BIND = (process.env.ALGORAVE_BIND ?? "127.0.0.1,172.17.0.1").split(",").map((s) => s.trim()).filter(Boolean);
export const DATA_DIR = resolve(process.env.ALGORAVE_DATA ?? join(APP_ROOT, "data"));
export const SONGS_DIR = join(DATA_DIR, "songs");
export const MCP_DIR = join(DATA_DIR, "mcp");
export const WEB_DIR = join(APP_ROOT, "out");
export const EARS_DIST = join(APP_ROOT, "agent-kit/ears/dist");
export const SKILLS_DIR = join(APP_ROOT, "agent-kit/skills");
export const TEMPLATE_DIR = join(APP_ROOT, "agent-kit/song-template");
export const CONTENT_DIR = join(APP_ROOT, "content");
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/home/eve/.local/bin/claude";
export const NODE_BIN = process.execPath;
export const ALLOWED_USER = process.env.ALGORAVE_USER ?? "daniel";
export const PUBLIC_HOST = process.env.ALGORAVE_PUBLIC_HOST ?? "mvp.trollefsen.com";
export const DEFAULT_MODEL = process.env.ALGORAVE_MODEL ?? "claude-sonnet-5-5";
export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];
/** the ONLY environment a provider child gets (GW-PLAN 9 step 5; HIVE-751) */
export const CHILD_ENV: Record<string, string> = {
  HOME: process.env.HOME ?? "/home/eve",
  PATH: `${dirname(CLAUDE_BIN)}:/usr/local/bin:/usr/bin:/bin`,
  LANG: "C.UTF-8",
};
export const ALLOWED_HOSTS = new Set([PUBLIC_HOST, ...BIND.map((b) => `${b}:${PORT}`), `localhost:${PORT}`, `host.docker.internal:${PORT}`]);
export const ALLOWED_ORIGINS = new Set([`https://${PUBLIC_HOST}`, ...BIND.map((b) => `http://${b}:${PORT}`), `http://localhost:${PORT}`]);
