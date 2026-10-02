// PTY adapter (GW-PLAN 7.3, Phase 4). In this project it runs ONE command, the
// claude CLI, interactively; there is no shell fallback and no command field.
// Terminal bytes are transport only: never durable events, never parsed for turn
// state. A headless xterm keeps the display so a reload can restore it.
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import xtermHeadless from "@xterm/headless";
import serializePkg from "@xterm/addon-serialize";
import type { AdapterEvent, Capability } from "@agent-gateway/protocol";
import { Emitter, type AdapterContext, type SessionAdapter, type UserInput } from "@agent-gateway/adapter-core";

const { Terminal } = xtermHeadless as unknown as typeof import("@xterm/headless");
const { SerializeAddon } = serializePkg as unknown as typeof import("@xterm/addon-serialize");

const RING_MAX = 1024 * 1024;

export type PtyOptions = { command: string; args: string[]; cols?: number; rows?: number };

export type TerminalChunk = { epoch: string; offset: number; data: Buffer };

export class PtyAdapter implements SessionAdapter {
  readonly name = "pty" as const;
  readonly capabilities: Capability[] = ["terminal"];
  readonly epoch = randomUUID();
  private events = new Emitter<AdapterEvent>();
  private term = new Emitter<Uint8Array>();
  private proc: pty.IPty | null = null;
  private headless: InstanceType<typeof Terminal>;
  private serializer: InstanceType<typeof SerializeAddon>;
  private ring: Buffer[] = [];
  private ringBytes = 0;
  /** total bytes ever emitted in this epoch (next chunk's offset) */
  offset = 0;
  cols: number;
  rows: number;
  /** serialises output and resize through one queue, so snapshot + tail never gap */
  private queue: Promise<void> = Promise.resolve();
  exited = false;
  pid = 0;

  private opts: PtyOptions;
  constructor(opts: PtyOptions) {
    this.opts = opts;
    this.cols = opts.cols ?? 100;
    this.rows = opts.rows ?? 30;
    this.headless = new Terminal({ cols: this.cols, rows: this.rows, scrollback: 2000, allowProposedApi: true });
    this.serializer = new SerializeAddon();
    this.headless.loadAddon(this.serializer as never);
  }

  subscribe(l: (e: AdapterEvent) => void) { return this.events.on(l); }
  subscribeTerminal(l: (d: Uint8Array) => void) { return this.term.on(l); }

  async start(ctx: AdapterContext): Promise<void> {
    // node-pty, not RuntimeHandle.spawn: a PTY needs a controlling terminal. The
    // env is still the runtime's minimal env, never the gateway's.
    this.proc = pty.spawn(this.opts.command, this.opts.args, {
      name: "xterm-256color", cols: this.cols, rows: this.rows, cwd: ctx.runtime.cwd,
      env: { ...ctx.runtime.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });
    this.pid = this.proc.pid;
    this.proc.onData((d) => {
      const buf = Buffer.from(d, "utf8");
      this.queue = this.queue.then(() => new Promise<void>((res) => {
        this.headless.write(buf, () => res());
        this.pushRing(buf);
        this.offset += buf.length;
        this.term.emit(buf);
      }));
    });
    this.proc.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.events.emit({ type: "session.status", payload: { status: "stopped", reason: "exited", detail: `claude exited (code ${exitCode}${signal ? `, signal ${signal}` : ""}). The terminal ended; there is no shell behind it.` } });
    });
    this.events.emit({ type: "session.status", payload: { status: "running", reason: "started", detail: `${this.opts.command.split("/").pop()} in a PTY (${this.cols}x${this.rows})` } });
  }

  private pushRing(b: Buffer) {
    this.ring.push(b);
    this.ringBytes += b.length;
    while (this.ringBytes > RING_MAX && this.ring.length > 1) this.ringBytes -= this.ring.shift()!.length;
  }

  /** Display snapshot at an exact byte offset (waits for queued writes). */
  async snapshot(): Promise<{ epoch: string; throughOffset: number; cols: number; rows: number; state: string }> {
    await this.queue;
    return { epoch: this.epoch, throughOffset: this.offset, cols: this.cols, rows: this.rows, state: this.serializer.serialize() };
  }

  async sendInput(input: UserInput): Promise<void> {
    if (!this.proc || this.exited) throw new Error("the terminal has ended");
    this.proc.write(input.text);
  }
  async writeRaw(data: string): Promise<void> {
    if (!this.proc || this.exited) throw new Error("the terminal has ended");
    this.proc.write(data);
  }
  async interrupt(): Promise<void> { if (this.proc && !this.exited) this.proc.write("\x03"); }
  async resize(cols: number, rows: number): Promise<void> {
    this.queue = this.queue.then(() => {
      this.cols = cols; this.rows = rows;
      this.headless.resize(cols, rows);
      if (this.proc && !this.exited) this.proc.resize(cols, rows);
    });
    await this.queue;
  }
  async terminate(): Promise<void> {
    if (this.proc && !this.exited) {
      const p = this.proc;
      await new Promise<void>((res) => {
        const t = setTimeout(() => { try { process.kill(p.pid, "SIGKILL"); } catch { /* gone */ } res(); }, 3000);
        p.onExit(() => { clearTimeout(t); res(); });
        p.kill("SIGTERM");
      });
    }
    this.headless.dispose();
  }
}
