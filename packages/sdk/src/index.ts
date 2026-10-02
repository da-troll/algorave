// @agent-gateway/sdk: browser client. Same-origin, the edge supplies identity;
// every mutation carries the CSRF header and a JSON body.
import { parseEvent, type AgentEvent, type Session, type SubmitTurnResult, type TerminalFrame, type TerminalSize, type TerminalSnapshot } from "@agent-gateway/protocol";

export class GatewayError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown>) { super(message); }
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export type ConnectOptions = {
  afterSeq?: number;
  clientId: string;
  onEvent: (e: AgentEvent) => void;
  onSnapshot?: (s: { session: Session; lastSeq: number }) => void;
  onUnknown?: (type: string, seq: number) => void;
  onTerminal?: (m: TerminalFrame | TerminalSnapshot | TerminalSize) => void;
  onState?: (s: ConnectionState, detail?: string) => void;
  onError?: (code: string, message: string) => void;
  onAck?: (requestId: string, result: unknown) => void;
};

export type Connection = { close: () => void; send: (m: unknown) => void; lastSeq: () => number; reconnect: () => void };

export function createGatewayClient({ baseUrl }: { baseUrl: string }) {
  const url = (p: string) => baseUrl.replace(/\/$/, "") + p;

  async function req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const r = await fetch(url(path), {
      method,
      headers: method === "GET" ? headers : { "content-type": "application/json", "x-algorave": "1", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      credentials: "same-origin",
    });
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try { j = text ? JSON.parse(text) : {}; } catch { j = { message: text.slice(0, 200) }; }
    if (!r.ok) throw new GatewayError(r.status, String(j.error ?? r.status), String(j.message ?? r.statusText), j);
    return j as T;
  }

  function connect(sessionId: string, o: ConnectOptions): Connection {
    let ws: WebSocket | null = null;
    let last = o.afterSeq ?? 0;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      if (closed) return;
      o.onState?.(attempt ? "reconnecting" : "connecting");
      const wsUrl = new URL(url(`/api/sessions/${sessionId}/stream?clientId=${encodeURIComponent(o.clientId)}`), location.href);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(wsUrl);
      ws.onopen = () => ws!.send(JSON.stringify({ type: "hello", protocolVersion: 1, afterSeq: last }));
      ws.onmessage = (m) => {
        const raw = JSON.parse(String(m.data));
        if (raw.type === "snapshot") { o.onSnapshot?.(raw); return; }
        if (raw.type === "replay.done") { attempt = 0; o.onState?.("live"); return; }
        if (raw.type === "ack") { o.onAck?.(raw.requestId, raw.result); return; }
        if (raw.type === "error") { o.onError?.(raw.code, raw.message); return; }
        if (raw.type === "terminal.output" || raw.type === "terminal.snapshot" || raw.type === "terminal.resize") { o.onTerminal?.(raw); return; }
        if (typeof raw.seq !== "number") return;
        if (raw.seq <= last) return; // dedupe by sequence
        const p = parseEvent(raw);
        if (p.kind === "incompatible") { o.onError?.("incompatible-protocol", `server speaks protocol ${String(p.protocolVersion)}; reload the app`); closed = true; ws?.close(); return; }
        last = raw.seq;
        if (p.kind === "unknown") { o.onUnknown?.(p.envelope.type, p.envelope.seq); return; }
        o.onEvent(p.event);
      };
      ws.onclose = () => {
        if (closed) { o.onState?.("offline"); return; }
        attempt += 1;
        const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
        o.onState?.("reconnecting", `retry in ${Math.round(delay / 1000)}s`);
        timer = setTimeout(open, delay);
      };
    };
    open();
    return {
      close: () => { closed = true; if (timer) clearTimeout(timer); ws?.close(); },
      send: (m) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); else throw new Error("not connected"); },
      lastSeq: () => last,
      reconnect: () => { if (timer) clearTimeout(timer); attempt = 0; ws?.close(); if (closed) { closed = false; open(); } },
    };
  }

  return {
    req,
    config: { ui: () => req<Record<string, unknown>>("GET", "/api/config/ui") },
    sessions: {
      list: () => req<Array<Session & { live: boolean }>>("GET", "/api/sessions"),
      get: (id: string) => req<{ session: Session; lastSeq: number; live: boolean }>("GET", `/api/sessions/${id}`),
      submitTurn: (id: string, input: string, requestId: string) => req<SubmitTurnResult>("POST", `/api/sessions/${id}/turns`, { input }, { "idempotency-key": requestId }),
      interrupt: (id: string) => req<{ ok: boolean }>("POST", `/api/sessions/${id}/interrupt`),
      stop: (id: string) => req<Session>("POST", `/api/sessions/${id}/stop`),
      resume: (id: string) => req<Session>("POST", `/api/sessions/${id}/resume`),
      claimTerminal: (id: string, clientId: string, steal = false) => req<{ generation: number }>("POST", `/api/sessions/${id}/terminal/ownership`, { clientId, steal }),
      connect,
    },
    files: {
      read: async (_sessionId: string, _path: string): Promise<string> => { throw new GatewayError(403, "files-not-enabled", "this project serves no workspace files to panels", {}); },
    },
  };
}
export type GatewayClient = ReturnType<typeof createGatewayClient>;
