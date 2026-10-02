// WS /api/sessions/:id/stream, replay contract (GW-PLAN 7.4 steps 1-4):
// register a bounded live buffer, read snapshot + high-water H in one
// transaction, send snapshot, replay (afterSeq, H] in pages, drain buffered
// events with seq > H in order, then tail. Terminal frames reset the display
// from a fresh snapshot on every attach.
import type { WSContext } from "hono/ws";
import { ClientMessage, type AgentEvent, type ServerMessage } from "@agent-gateway/protocol";
import type { Store } from "@agent-gateway/persistence";
import type { Bus, BusMessage } from "./bus.ts";
import type { SessionManager } from "./sessions.ts";
import { HttpError } from "./songs.ts";

const BUFFER_MAX = 5000;
const PAGE = 500;

export function streamHandlers(store: Store, bus: Bus, sessions: SessionManager, sessionId: string, clientId: string) {
  let off: (() => void) | null = null;
  let phase: "waiting" | "replaying" | "live" = "waiting";
  const buffer: BusMessage[] = [];
  let lastSent = 0;

  const send = (ws: WSContext, m: ServerMessage) => ws.send(JSON.stringify(m));
  const sendEvent = (ws: WSContext, e: AgentEvent) => {
    if (e.seq <= lastSent) return; // dedupe across the replay/live boundary
    lastSent = e.seq;
    send(ws, e);
  };
  const isEvent = (m: BusMessage): m is AgentEvent => "seq" in m;

  return {
    onOpen() { /* wait for hello */ },
    async onMessage(evt: MessageEvent, ws: WSContext) {
      let msg: ClientMessage;
      try {
        msg = ClientMessage.parse(JSON.parse(String(evt.data)));
      } catch (e) {
        send(ws, { type: "error", code: "bad-message", message: String((e as Error).message).slice(0, 200) });
        return;
      }
      if (msg.type === "hello") {
        if (phase !== "waiting") return;
        // 1. buffer first, then snapshot + H in one read transaction
        off = bus.on(sessionId, (m) => {
          if (phase === "live") {
            if (isEvent(m)) sendEvent(ws, m);
            else ws.send(JSON.stringify(m));
            return;
          }
          buffer.push(m);
          if (buffer.length > BUFFER_MAX) {
            send(ws, { type: "error", code: "slow-client", message: "replay buffer overflow; reconnect with your last seq", resumable: true });
            ws.close(4008, "slow client");
          }
        });
        const snap = store.snapshot(sessionId);
        if (!snap) { send(ws, { type: "error", code: "no-session", message: "no such session" }); ws.close(4004); return; }
        phase = "replaying";
        send(ws, { type: "snapshot", protocolVersion: 1, session: { ...snap.session, status: sessions.isLive(sessionId) ? snap.session.status : snap.session.status }, lastSeq: snap.lastSeq });
        // 2. replay (afterSeq, H] in pages
        let after = msg.afterSeq ?? 0;
        if (after > snap.lastSeq) { send(ws, { type: "error", code: "future-cursor", message: `afterSeq ${after} is beyond the log (${snap.lastSeq})` }); after = snap.lastSeq; }
        lastSent = after;
        for (;;) {
          const page = store.listEventsAfter(sessionId, after, PAGE, snap.lastSeq);
          for (const e of page) sendEvent(ws, e);
          if (page.length < PAGE) break;
          after = page[page.length - 1]!.seq;
        }
        send(ws, { type: "replay.done", throughSeq: snap.lastSeq });
        // terminal: fresh display snapshot, then frames after its offset
        const ts = await sessions.ptySnapshot(sessionId);
        let termFrom = -1;
        if (ts) { send(ws, { type: "terminal.snapshot", sessionId, ...ts }); termFrom = ts.throughOffset; }
        // 3. drain buffered events with seq > H, in order, then go live
        for (const m of buffer) {
          if (isEvent(m)) sendEvent(ws, m);
          else if (m.type === "terminal.output") { if (m.offset >= termFrom) ws.send(JSON.stringify(m)); }
          else ws.send(JSON.stringify(m));
        }
        buffer.length = 0;
        phase = "live";
        return;
      }
      try {
        if (msg.type === "turn.submit") {
          const r = await sessions.submitTurn(sessionId, msg.input, msg.requestId);
          send(ws, { type: "ack", requestId: msg.requestId, result: r.body });
        } else if (msg.type === "interrupt") {
          const acc = store.acceptRequest(`interrupt:${sessionId}`, msg.requestId, {});
          if (acc.state === "duplicate") { send(ws, { type: "ack", requestId: msg.requestId, result: acc.result }); return; }
          const r = await sessions.interrupt(sessionId);
          store.completeRequest(`interrupt:${sessionId}`, msg.requestId, "completed", r);
          send(ws, { type: "ack", requestId: msg.requestId, result: r });
        } else if (msg.type === "terminal.input") {
          await sessions.terminalInput(sessionId, clientId, msg.ownershipGeneration, msg.data);
        } else if (msg.type === "terminal.resize") {
          await sessions.terminalResize(sessionId, clientId, msg.ownershipGeneration, msg.cols, msg.rows);
        } else if (msg.type === "approval.decision") {
          send(ws, { type: "error", requestId: msg.requestId, code: "no-pending-approval", message: "this adapter resolves permissions itself; there is nothing to approve" });
        }
      } catch (e) {
        const he = e instanceof HttpError ? e : null;
        send(ws, { type: "error", requestId: "requestId" in msg ? (msg as { requestId?: string }).requestId : undefined, code: he?.code ?? "error", message: (e as Error).message });
      }
    },
    onClose() { off?.(); },
  };
}
