// SessionAdapter (GW-PLAN 7.3). Adapters never import React and never assign
// session identity, event ids or seq: they emit AdapterEvents; the gateway stamps them.
import type { AdapterEvent, AdapterName, Capability, ProjectConfig, Session } from "@agent-gateway/protocol";
import type { ChildProcess } from "node:child_process";

export type UserInput = { text: string; turnId?: string };

/** Spawn/cwd/env/kill/onExit; adapters never call child_process themselves. */
export interface RuntimeHandle {
  readonly cwd: string;
  /** minimal, explicit environment for provider children (never the gateway's own env) */
  readonly env: Record<string, string>;
  spawn(command: string, args: string[], opts?: { stdin?: boolean }): ChildProcess;
  /** kill the process group of everything this handle spawned */
  kill(signal?: NodeJS.Signals): void;
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  /** verified identity of the live writer (pid + start time), for the workspace lock */
  identity(): { pid: number; startTime: string; bootId: string } | null;
}

export type PolicyEvaluator = { describe(): string };

export type AdapterContext = {
  session: Session;
  runtime: RuntimeHandle;
  project: ProjectConfig;
  policy: PolicyEvaluator;
};

export interface SessionAdapter {
  readonly name: AdapterName;
  readonly capabilities: Capability[];
  start(ctx: AdapterContext): Promise<void>;
  resume?(ctx: AdapterContext): Promise<void>;
  sendInput(input: UserInput): Promise<void>;
  interrupt(): Promise<void>;
  approve?(approvalId: string, decision: "allow" | "deny"): Promise<void>;
  resize?(cols: number, rows: number): Promise<void>;
  subscribe(listener: (event: AdapterEvent) => void): () => void;
  subscribeTerminal?(listener: (data: Uint8Array) => void): () => void;
  terminate(): Promise<void>;
}

export class AdapterNotImplementedError extends Error {
  readonly code = "adapter-not-implemented";
  constructor(readonly adapter: AdapterName) {
    super(`The ${adapter} adapter is a stub in this build. See GW-PLAN section 16 (adapter roadmap) for what it must implement.`);
  }
}

/** Tiny listener set shared by adapters. */
export class Emitter<T> {
  private ls = new Set<(e: T) => void>();
  on(l: (e: T) => void): () => void { this.ls.add(l); return () => this.ls.delete(l); }
  emit(e: T) { for (const l of this.ls) l(e); }
}
