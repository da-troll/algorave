// Stub (GW-PLAN 7.3 / 11): implements SessionAdapter and refuses clearly.
import { AdapterNotImplementedError, type SessionAdapter } from "@agent-gateway/adapter-core";
import type { Capability } from "@agent-gateway/protocol";

export class AcpAdapter implements SessionAdapter {
  readonly name = "acp" as const;
  readonly capabilities: Capability[] = [];
  async start(): Promise<void> { throw new AdapterNotImplementedError(this.name); }
  async sendInput(): Promise<void> { throw new AdapterNotImplementedError(this.name); }
  async interrupt(): Promise<void> { throw new AdapterNotImplementedError(this.name); }
  subscribe(): () => void { return () => {}; }
  async terminate(): Promise<void> {}
}
