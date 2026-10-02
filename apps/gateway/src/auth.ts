// Access control (GW-PLAN 10, adapted to this deployment). The edge (Caddy +
// Authentik forward_auth) authenticates the user and copies X-authentik-Username
// upstream. The gateway trusts that header ONLY from a loopback or docker-bridge
// peer, validates Host on every request, and Origin + a custom header + JSON on
// every mutation and WS upgrade (CSRF). The bootstrap-cookie flow is replaced
// by the edge identity here; see PROJECT.md section 10 for the residual.
import type { Context, Next } from "hono";
import type { IncomingMessage } from "node:http";
import { ALLOWED_HOSTS, ALLOWED_ORIGINS, ALLOWED_USER, DEMO } from "./config.ts";

export function trustedPeer(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, "");
  if (a === "127.0.0.1" || a === "::1") return true;
  const m = /^172\.(\d+)\.\d+\.\d+$/.exec(a);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

export type AuthVerdict = { ok: true } | { ok: false; status: 401 | 403 | 400; code: string; message: string };

export function checkRequest(opts: { method: string; host?: string | null; origin?: string | null; user?: string | null; peer?: string; csrf?: string | null; contentType?: string | null; upgrade?: boolean }): AuthVerdict {
  if (!opts.host || !ALLOWED_HOSTS.has(opts.host)) return { ok: false, status: 400, code: "bad-host", message: "Host not allowed" };
  if (!trustedPeer(opts.peer)) return { ok: false, status: 403, code: "untrusted-peer", message: "requests must come through the edge proxy" };
  if (!opts.user || opts.user !== ALLOWED_USER) return { ok: false, status: 401, code: "unauthenticated", message: "no authenticated edge identity" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(opts.method) || opts.upgrade;
  if (opts.origin !== undefined && opts.origin !== null && !ALLOWED_ORIGINS.has(opts.origin)) return { ok: false, status: 403, code: "bad-origin", message: "cross-site request refused" };
  if (mutating) {
    if (!opts.origin) return { ok: false, status: 403, code: "missing-origin", message: "Origin required" };
    if (!opts.upgrade) {
      if (opts.csrf !== "1") return { ok: false, status: 403, code: "csrf", message: "X-Algorave header required" };
      if (opts.method !== "DELETE" && !(opts.contentType ?? "").startsWith("application/json")) return { ok: false, status: 400, code: "json-only", message: "JSON body required" };
    }
  }
  return { ok: true };
}

function peerOf(c: Context): string | undefined {
  const inc = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return inc?.socket?.remoteAddress;
}

/** Routes that start or drive an agent or a terminal: refused outright in the demo twin. */
const AGENT_ROUTES = [/^\/api\/songs\/[^/]+\/sessions$/, /^\/api\/sessions$/, /^\/api\/sessions\/[^/]+\/(turns|resume|interrupt|terminal\/.*|stream)$/];

export async function apiAuth(c: Context, next: Next) {
  if (DEMO && c.req.method !== "GET" && AGENT_ROUTES.some((r) => r.test(c.req.path))) {
    return c.json({ error: "demo-mode", message: "This is the demo twin: it never starts an agent or a terminal." }, 403);
  }
  const upgrade = (c.req.header("upgrade") ?? "").toLowerCase() === "websocket";
  const v = checkRequest({
    method: c.req.method, host: c.req.header("host"), origin: c.req.header("origin") ?? null,
    user: c.req.header("x-authentik-username") ?? (DEMO ? ALLOWED_USER : null), peer: peerOf(c), csrf: c.req.header("x-algorave") ?? null,
    contentType: c.req.header("content-type") ?? null, upgrade,
  });
  if (!v.ok) return c.json({ error: v.code, message: v.message }, v.status);
  await next();
}
