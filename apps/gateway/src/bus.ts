// In-process pub/sub per session (no Redis). Durable events are published only
// after appendEvent committed. Terminal frames ride the same bus, never stored.
import type { AgentEvent, TerminalFrame, TerminalSize } from "@agent-gateway/protocol";

export type BusMessage = AgentEvent | TerminalFrame | TerminalSize;
type Listener = (m: BusMessage) => void;

export class Bus {
  private ls = new Map<string, Set<Listener>>();
  on(sessionId: string, l: Listener): () => void {
    let s = this.ls.get(sessionId);
    if (!s) this.ls.set(sessionId, (s = new Set()));
    s.add(l);
    return () => { s!.delete(l); };
  }
  publish(sessionId: string, m: BusMessage) {
    for (const l of this.ls.get(sessionId) ?? []) l(m);
  }
  /** global listeners (song service, review triggers) */
  private all = new Set<(sessionId: string, m: BusMessage) => void>();
  onAny(l: (sessionId: string, m: BusMessage) => void) { this.all.add(l); return () => this.all.delete(l); }
  publishAny(sessionId: string, m: BusMessage) { for (const l of this.all) l(sessionId, m); }
}
