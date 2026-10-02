// LocalProcessRuntime (GW-PLAN 9): spawn in its own process group with an
// explicit minimal env, kill the whole group, and record a verified identity
// (pid + /proc start time + boot id) so restart reconciliation never kills a
// reused PID.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import type { RuntimeHandle } from "@agent-gateway/adapter-core";

export function bootId(): string {
  try { return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch { return "unknown"; }
}
export function procStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch { return null; }
}

export class LocalProcessRuntime implements RuntimeHandle {
  private children: ChildProcess[] = [];
  private exitCbs: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  constructor(readonly cwd: string, readonly env: Record<string, string>) {}

  spawn(command: string, args: string[], opts: { stdin?: boolean } = {}): ChildProcess {
    const child = spawn(command, args, { cwd: this.cwd, env: this.env, detached: true, stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"] });
    this.children.push(child);
    child.on("exit", (code, signal) => {
      this.children = this.children.filter((c) => c !== child);
      for (const cb of this.exitCbs) cb(code, signal);
    });
    return child;
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    for (const c of this.children) {
      try { if (c.pid) process.kill(-c.pid, signal); } catch { /* gone */ }
    }
  }
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void) { this.exitCbs.push(cb); }
  identity() {
    const c = this.children[0];
    if (!c?.pid) return null;
    return { pid: c.pid, startTime: procStartTime(c.pid) ?? "unknown", bootId: bootId() };
  }
}
