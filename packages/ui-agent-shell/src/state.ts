// Session state derived ONLY from durable events (GW-PLAN 12): never from
// terminal bytes. A reload replays the log and rebuilds the same state.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AgentEvent, Session, TerminalFrame, TerminalSize, TerminalSnapshot } from "@agent-gateway/protocol";
import type { ConnectionState, GatewayClient } from "@agent-gateway/sdk";

export type ChatItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; text: string; streaming: boolean; turnId?: string; seq: number }
  | { kind: "tool"; id: string; name: string; input: unknown; output?: string; isError?: boolean; done: boolean; turnId?: string; seq: number }
  | { kind: "check"; id: string; ok: boolean; body: string; turnId?: string; seq: number }
  | { kind: "turn-end"; id: string; outcome: "completed" | "failed" | "interrupted"; detail?: string; turnId: string; seq: number };

export type SessionState = {
  session: Session | null;
  lastSeq: number;
  items: ChatItem[];
  activity: AgentEvent[];
  diff: { files: Array<{ path: string; status: string }>; diff: string; truncated: boolean } | null;
  runningTurnId: string | null;
  usage: { input: number; output: number; cost: number };
  unknown: number;
};

const initial: SessionState = { session: null, lastSeq: 0, items: [], activity: [], diff: null, runningTurnId: null, usage: { input: 0, output: 0, cost: 0 }, unknown: 0 };

type Action = { t: "snapshot"; session: Session; lastSeq: number } | { t: "event"; e: AgentEvent } | { t: "unknown" } | { t: "reset" };

function upsert(items: ChatItem[], id: string, f: (old: ChatItem | undefined) => ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return [...items, f(undefined)];
  const next = items.slice();
  next[i] = f(items[i]);
  return next;
}

export function reduce(s: SessionState, a: Action): SessionState {
  if (a.t === "reset") return initial;
  if (a.t === "unknown") return { ...s, unknown: s.unknown + 1 };
  if (a.t === "snapshot") return { ...s, session: a.session };
  const e = a.e;
  if (e.seq <= s.lastSeq) return s;
  const n: SessionState = { ...s, lastSeq: e.seq };
  const activityTypes = ["tool.started", "tool.completed", "approval.requested", "approval.resolved", "turn.started", "turn.completed", "turn.failed", "turn.interrupted", "session.status", "artifact.created", "usage.updated", "file.changed"];
  if (activityTypes.includes(e.type)) n.activity = [...s.activity.slice(-400), e];
  switch (e.type) {
    case "session.status":
      if (n.session) n.session = { ...n.session, status: e.payload.status, ...(e.payload.providerSessionId ? { providerSessionId: e.payload.providerSessionId } : {}) };
      break;
    case "turn.started": n.runningTurnId = e.payload.turnId; break;
    case "message.delta":
      n.items = upsert(s.items, e.payload.messageId, (o) => o && o.kind === "message" ? { ...o, text: o.text + e.payload.delta } : { kind: "message", id: e.payload.messageId, role: "assistant", text: e.payload.delta, streaming: true, turnId: e.turnId, seq: e.seq });
      break;
    case "message.completed":
      n.items = upsert(s.items, e.payload.messageId, () => ({ kind: "message", id: e.payload.messageId, role: e.payload.role, text: e.payload.text, streaming: false, turnId: e.turnId, seq: e.seq }));
      break;
    case "tool.started":
      n.items = upsert(s.items, e.payload.toolUseId, () => ({ kind: "tool", id: e.payload.toolUseId, name: e.payload.name, input: e.payload.input, done: false, turnId: e.turnId, seq: e.seq }));
      break;
    case "tool.output":
      n.items = upsert(s.items, e.payload.toolUseId, (o) => (o && o.kind === "tool" ? { ...o, output: e.payload.output } : o!));
      break;
    case "tool.completed":
      n.items = upsert(s.items, e.payload.toolUseId, (o) => (o && o.kind === "tool" ? { ...o, done: true, isError: e.payload.isError } : o!));
      break;
    case "artifact.created":
      if (e.payload.artifact.pathOrUrl === "ears://strudel_check") n.items = [...s.items, { kind: "check", id: e.payload.artifact.id, ok: !!e.payload.ok, body: e.payload.body ?? "", turnId: e.turnId, seq: e.seq }];
      break;
    case "diff.updated": n.diff = { files: e.payload.files, diff: e.payload.diff, truncated: e.payload.truncated }; break;
    case "usage.updated": n.usage = { input: s.usage.input + e.payload.inputTokens, output: s.usage.output + e.payload.outputTokens, cost: s.usage.cost + (e.payload.costUsd ?? 0) }; break;
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      n.runningTurnId = s.runningTurnId === e.payload.turnId ? null : s.runningTurnId;
      const outcome = e.type === "turn.completed" ? "completed" : e.type === "turn.failed" ? "failed" : "interrupted";
      const detail = e.type === "turn.failed" ? e.payload.error : e.type === "turn.interrupted" ? e.payload.reason : undefined;
      n.items = [...s.items.map((x) => (x.kind === "message" && x.streaming && x.turnId === e.payload.turnId ? { ...x, streaming: false } : x)), { kind: "turn-end", id: `end-${e.payload.turnId}`, outcome, detail, turnId: e.payload.turnId, seq: e.seq }];
      break;
    }
  }
  return n;
}

export type TerminalSink = (m: TerminalFrame | TerminalSnapshot | TerminalSize) => void;

export function clientId(): string {
  const k = "agent-gateway-client-id";
  try {
    let v = sessionStorage.getItem(k);
    if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(k, v); }
    return v;
  } catch { return crypto.randomUUID(); }
}

/** Connect to a session's stream; replay from 0 on mount, resume from lastSeq on reconnect. */
export function useSession(client: GatewayClient, sessionId: string | null) {
  const [state, dispatch] = useReducer(reduce, initial);
  const [conn, setConn] = useState<ConnectionState>("offline");
  const [errors, setErrors] = useState<string[]>([]);
  const termSinks = useRef(new Set<TerminalSink>());
  const termBacklog = useRef<Array<TerminalFrame | TerminalSnapshot | TerminalSize>>([]);
  const connRef = useRef<ReturnType<GatewayClient["sessions"]["connect"]> | null>(null);
  const cid = useMemo(() => clientId(), []);

  useEffect(() => {
    dispatch({ t: "reset" });
    termBacklog.current = [];
    if (!sessionId) return;
    const c = client.sessions.connect(sessionId, {
      afterSeq: 0, clientId: cid,
      onEvent: (e) => dispatch({ t: "event", e }),
      onSnapshot: (s) => dispatch({ t: "snapshot", session: s.session, lastSeq: s.lastSeq }),
      onUnknown: () => dispatch({ t: "unknown" }),
      onState: (s) => setConn(s),
      onError: (code, message) => setErrors((x) => [...x.slice(-4), `${code}: ${message}`]),
      onTerminal: (m) => {
        if (m.type === "terminal.snapshot") termBacklog.current = [m];
        else termBacklog.current.push(m);
        if (termBacklog.current.length > 4000) termBacklog.current = termBacklog.current.slice(-2000);
        for (const s of termSinks.current) s(m);
      },
    });
    connRef.current = c;
    return () => { c.close(); connRef.current = null; };
  }, [client, sessionId, cid]);

  return {
    state, conn, errors, clientId: cid,
    send: (m: unknown) => connRef.current?.send(m),
    reconnect: () => connRef.current?.reconnect(),
    /** subscribe to terminal transport; replays the latest snapshot + tail first */
    onTerminal: (sink: TerminalSink) => {
      for (const m of termBacklog.current) sink(m);
      termSinks.current.add(sink);
      return () => { termSinks.current.delete(sink); };
    },
  };
}
export type SessionHandle = ReturnType<typeof useSession>;
