// Test harness: start a gateway on a scratch port + data dir, call it the way the
// edge does (Authentik identity header, Origin, CSRF header), follow the event stream.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export type Gw = { port: number; base: string; data: string; proc: ChildProcess; stop: () => Promise<void> };

/** An OS-assigned free loopback port (a random pick in a fixed range collided when test files ran in parallel). */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}

export async function startGateway(opts: { port?: number; data?: string; env?: Record<string, string> } = {}): Promise<Gw> {
  const port = opts.port ?? (await freePort());
  // NOT under /tmp: the song template denies agent edits in /tmp (security test b).
  mkdirSync(join(ROOT, "data", "test-runs"), { recursive: true });
  const data = opts.data ?? mkdtempSync(join(ROOT, "data", "test-runs", "gw-"));
  const proc = spawn(process.execPath, [join(ROOT, "apps/gateway/dist/gateway.mjs")], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/home/eve", PORT: String(port), ALGORAVE_BIND: "127.0.0.1", ALGORAVE_DATA: data, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout!.on("data", (d) => (log += d));
  proc.stderr!.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 49) throw new Error(`gateway did not start: ${log}`);
  }
  return {
    port, base, data, proc,
    stop: () => new Promise<void>((res) => { if (proc.exitCode !== null) return res(); proc.once("exit", () => res()); proc.kill("SIGTERM"); }),
  };
}

export function headers(gw: Gw, extra: Record<string, string> = {}): Record<string, string> {
  return { host: `127.0.0.1:${gw.port}`, origin: `http://127.0.0.1:${gw.port}`, "x-authentik-username": "daniel", "x-algorave": "1", "content-type": "application/json", ...extra };
}

export async function api<T = any>(gw: Gw, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const r = await fetch(gw.base + path, { method, headers: headers(gw, extra), body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body) });
  const text = await r.text();
  let b: any = text;
  try { b = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, body: b };
}

export type Stream = { events: any[]; frames: any[]; ws: WebSocket; waitFor: (pred: (e: any) => boolean, ms?: number, what?: string) => Promise<any>; close: () => void };

export function connect(gw: Gw, sessionId: string, afterSeq = 0, clientId = "harness-client-1"): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/api/sessions/${sessionId}/stream?clientId=${clientId}`, { headers: { origin: `http://127.0.0.1:${gw.port}`, "x-authentik-username": "daniel", host: `127.0.0.1:${gw.port}` } } as any);
    const events: any[] = [];
    const frames: any[] = [];
    const waiters: Array<{ pred: (e: any) => boolean; res: (e: any) => void }> = [];
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data));
      if (typeof e.seq === "number") events.push(e); else frames.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.res(e); }
    };
    ws.onerror = (e) => reject(new Error(`ws error ${String((e as any).message ?? e)}`));
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, afterSeq }));
      resolve({
        events, frames, ws, close: () => ws.close(),
        waitFor: (pred, ms = 180_000, what = "event") => {
          const hit = [...events, ...frames].find(pred);
          if (hit) return Promise.resolve(hit);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error(`timeout waiting for ${what}`)), ms);
            waiters.push({ pred, res: (e) => { clearTimeout(t); res(e); } });
          });
        },
      });
    };
  });
}

export function rid(): string { return crypto.randomUUID(); }
