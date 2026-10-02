// claude-cli: structured adapter over the installed Claude Code CLI in
// stream-json mode. One long-lived process per chat session, cwd = workspace.
// Verified against claude 2.1.288 on 2026-10-02 (see README.md for flags and
// what was tested). Translation is pure (mapLine) so fixtures can drive it.
import { randomUUID } from "node:crypto";
import type { AdapterEvent, Capability } from "@agent-gateway/protocol";
import { Emitter, type AdapterContext, type SessionAdapter, type UserInput } from "@agent-gateway/adapter-core";

export type ClaudeCliOptions = {
  /** absolute path of the claude binary */
  bin: string;
  model: string;
  /** --mcp-config file for this session */
  mcpConfig: string;
  /** built-in tools the agent gets at all (--tools) */
  tools: string[];
  /** tools pre-approved without a prompt (--allowedTools). File tools stay OUT so
   *  reads/edits outside the cwd need a grant that -p mode can never give. */
  allowedTools: string[];
  disallowedTools: string[];
  resumeId?: string;
};

export const DEFAULT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill"];
export const DEFAULT_DISALLOWED = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export function buildArgs(o: ClaudeCliOptions): string[] {
  const a = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--model", o.model,
    "--setting-sources", "project",
    "--permission-mode", "acceptEdits",
    "--tools", o.tools.join(","),
    "--allowedTools", o.allowedTools.join(","),
    "--disallowedTools", o.disallowedTools.join(","),
    "--mcp-config", o.mcpConfig, "--strict-mcp-config",
  ];
  if (o.resumeId) a.push("--resume", o.resumeId);
  return a;
}

type Line = Record<string, any>;
const TOOL_OUTPUT_MAX = 8000;

/**
 * Stateful translator from CLI stream-json lines to canonical AdapterEvents.
 * Unknown line types are skipped (and reported through onUnknown), never fatal.
 */
export class StreamTranslator {
  turnId: string | null = null;
  providerSessionId: string | null = null;
  /** set by the adapter when the user asked to interrupt the running turn */
  interruptRequested = false;
  /** why the running turn is being interrupted (user, session stop, gateway shutdown) */
  interruptReason = "interrupted by user";
  private textStarts = new Map<string, number>(); // msgId -> text blocks started (deltas)
  private textDone = new Map<string, number>(); // msgId -> text blocks completed
  private blockOrdinal = new Map<string, number>(); // `${msgId}:${index}` -> ordinal
  private currentMsg: string | null = null;
  private toolNames = new Map<string, string>();
  onUnknown: (l: Line) => void = () => {};
  /** a file-editing tool completed; the gateway polls git immediately */
  onFileTool: (name: string) => void = () => {};

  translate(l: Line): AdapterEvent[] {
    const out: AdapterEvent[] = [];
    const turnId = this.turnId ?? undefined;
    const t = l.type;
    if (t === "system") {
      if (l.subtype === "init") {
        this.providerSessionId = l.session_id;
        out.push({ type: "session.status", payload: { status: "running", reason: "provider-session", providerSessionId: l.session_id, detail: `model ${l.model}; tools ${(l.tools ?? []).join(", ")}` } });
      }
      return out; // status / thinking_tokens: progress chrome, not durable
    }
    if (t === "stream_event") {
      if (l.parent_tool_use_id) return out;
      const e = l.event ?? {};
      if (e.type === "message_start") this.currentMsg = e.message?.id ?? null;
      if (e.type === "content_block_start" && e.content_block?.type === "text" && this.currentMsg) {
        const n = this.textStarts.get(this.currentMsg) ?? 0;
        this.textStarts.set(this.currentMsg, n + 1);
        this.blockOrdinal.set(`${this.currentMsg}:${e.index}`, n);
      }
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && this.currentMsg) {
        const ord = this.blockOrdinal.get(`${this.currentMsg}:${e.index}`) ?? 0;
        out.push({ type: "message.delta", turnId, payload: { messageId: `${this.currentMsg}#${ord}`, role: "assistant", delta: String(e.delta.text ?? "") } });
      }
      return out;
    }
    if (t === "assistant") {
      if (l.parent_tool_use_id) return out;
      const msgId: string = l.message?.id ?? randomUUID();
      for (const c of l.message?.content ?? []) {
        if (c.type === "text") {
          const ord = this.textDone.get(msgId) ?? 0;
          this.textDone.set(msgId, ord + 1);
          if (String(c.text).trim()) out.push({ type: "message.completed", turnId, payload: { messageId: `${msgId}#${ord}`, role: "assistant", text: String(c.text) } });
        } else if (c.type === "tool_use") {
          this.toolNames.set(c.id, c.name);
          out.push({ type: "tool.started", turnId, payload: { toolUseId: c.id, name: c.name, input: c.input ?? {} } });
        } else if (c.type === "thinking" && c.thinking && String(c.thinking).trim()) {
          out.push({ type: "reasoning.summary", turnId, payload: { messageId: `${msgId}#thinking`, text: String(c.thinking).slice(0, 4000) } });
        }
      }
      return out;
    }
    if (t === "user") {
      if (l.parent_tool_use_id) return out;
      const content = l.message?.content;
      if (!Array.isArray(content)) return out;
      for (const c of content) {
        if (c.type !== "tool_result") continue;
        let text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x: Line) => (x.type === "text" ? x.text : x.type === "tool_reference" ? `[tool ${x.tool_name}]` : `[${x.type}]`)).join("\n") : "";
        const truncated = text.length > TOOL_OUTPUT_MAX;
        if (truncated) text = text.slice(0, TOOL_OUTPUT_MAX);
        out.push({ type: "tool.output", turnId, payload: { toolUseId: c.tool_use_id, output: text, truncated } });
        out.push({ type: "tool.completed", turnId, payload: { toolUseId: c.tool_use_id, isError: !!c.is_error } });
        const name = this.toolNames.get(c.tool_use_id);
        if (name && ["Edit", "Write", "MultiEdit"].includes(name) && !c.is_error) this.onFileTool(name);
      }
      return out;
    }
    if (t === "result") {
      for (const d of l.permission_denials ?? []) {
        out.push({ type: "approval.resolved", turnId, payload: { approvalId: d.tool_use_id ?? randomUUID(), decision: "deny", source: "adapter", toolName: d.tool_name, reason: `refused by the Claude Code permission layer: ${d.tool_name} ${JSON.stringify(d.tool_input ?? {}).slice(0, 200)}` } });
      }
      const u = l.usage ?? {};
      out.push({ type: "usage.updated", turnId, payload: { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, ...(typeof l.total_cost_usd === "number" ? { costUsd: l.total_cost_usd } : {}), ...(typeof l.duration_ms === "number" ? { durationMs: l.duration_ms } : {}) } });
      if (turnId) {
        if (this.interruptRequested) out.push({ type: "turn.interrupted", turnId, payload: { turnId, reason: this.interruptReason } });
        else if (l.subtype === "success" && !l.is_error) out.push({ type: "turn.completed", turnId, payload: { turnId, result: typeof l.result === "string" ? l.result.slice(0, 4000) : undefined } });
        else out.push({ type: "turn.failed", turnId, payload: { turnId, error: String(l.result ?? l.subtype ?? "error").slice(0, 1000) } });
      }
      this.turnId = null;
      this.interruptRequested = false;
      this.interruptReason = "interrupted by user";
      return out;
    }
    if (t === "control_response" || t === "rate_limit_event") return out;
    this.onUnknown(l);
    return out;
  }
}

export class ClaudeCliAdapter implements SessionAdapter {
  readonly name = "claude-cli" as const;
  readonly capabilities: Capability[] = ["chat", "diff", "mcp"];
  private events = new Emitter<AdapterEvent>();
  private tr = new StreamTranslator();
  private child: ReturnType<AdapterContext["runtime"]["spawn"]> | null = null;
  private ctx: AdapterContext | null = null;
  private buf = "";
  private interrupting = false;
  private exited = false;
  /** how the last interrupt was delivered: "control" (stream-json control request) or "signal" */
  lastInterruptPath: "control" | "signal" | null = null;
  onUnknownLine: (l: Line) => void = () => {};
  /** raw stream-json lines, for fixture capture (ALGORAVE_CAPTURE_DIR) */
  onRawLine: (raw: string) => void = () => {};
  onFileTool: (name: string) => void = () => {};

  private opts: ClaudeCliOptions;
  constructor(opts: ClaudeCliOptions) {
    this.opts = opts;
    this.tr.onUnknown = (l) => this.onUnknownLine(l);
    this.tr.onFileTool = (n) => this.onFileTool(n);
  }

  get providerSessionId() { return this.tr.providerSessionId; }
  get turnRunning() { return this.tr.turnId !== null; }

  subscribe(l: (e: AdapterEvent) => void) { return this.events.on(l); }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    this.spawn();
    // stream-json mode emits system/init only once the first prompt arrives
    this.events.emit({ type: "session.status", payload: { status: "idle", reason: "started", detail: `claude spawned (${this.opts.model}); waiting for the first prompt` } });
  }

  private spawn() {
    const ctx = this.ctx!;
    this.exited = false;
    const child = ctx.runtime.spawn(this.opts.bin, buildArgs(this.opts), { stdin: true });
    this.child = child;
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const raw = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!raw) continue;
        this.onRawLine(raw);
        let line: Line;
        try { line = JSON.parse(raw); } catch { this.onUnknownLine({ type: "non-json", raw: raw.slice(0, 200) }); continue; }
        for (const e of this.tr.translate(line)) this.events.emit(e);
      }
    });
    child.stderr?.on("data", () => {});
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.child = null;
      const turnId = this.tr.turnId;
      if (turnId) {
        if (this.interrupting) this.events.emit({ type: "turn.interrupted", turnId, payload: { turnId, reason: `${this.tr.interruptReason} (process signalled)` } });
        else this.events.emit({ type: "turn.failed", turnId, payload: { turnId, error: `claude exited mid-turn (code ${code}, signal ${signal})` } });
        this.tr.turnId = null;
      }
      const wanted = this.interrupting;
      this.interrupting = false;
      this.events.emit({ type: "session.status", payload: { status: wanted ? "idle" : code === 0 ? "stopped" : "failed", reason: "exited", detail: `claude exited (code ${code}, signal ${signal})${wanted ? "; the next prompt resumes the conversation with --resume" : ""}` } });
    });
  }

  async sendInput(input: UserInput): Promise<void> {
    if (this.exited || !this.child) {
      // respawn (after an interrupt or exit) continuing the same provider conversation
      if (this.tr.providerSessionId) this.opts = { ...this.opts, resumeId: this.tr.providerSessionId };
      this.spawn();
      this.events.emit({ type: "session.status", payload: { status: "running", reason: "resumed", detail: `respawned claude with --resume ${this.opts.resumeId ?? "(none)"}` } });
    }
    const turnId = input.turnId ?? randomUUID();
    this.tr.turnId = turnId;
    this.events.emit({ type: "turn.started", turnId, payload: { turnId, input: input.text } });
    this.child!.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: input.text } }) + "\n");
  }

  async interrupt(): Promise<void> {
    if (!this.child || !this.tr.turnId) return;
    const turnId = this.tr.turnId;
    this.tr.interruptRequested = true;
    // 1. the stream-json control request
    const requestId = randomUUID();
    this.child.stdin!.write(JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } }) + "\n");
    const ok = await new Promise<boolean>((res) => {
      const t = setTimeout(() => { off(); res(false); }, 4000);
      const off = this.events.on((e) => {
        if ((e.type === "turn.completed" || e.type === "turn.failed" || e.type === "turn.interrupted") && e.payload.turnId === turnId) { clearTimeout(t); off(); res(true); }
      });
    });
    if (ok) { this.lastInterruptPath = "control"; return; }
    // 2. fallback: signal the process group, respawn with --resume on next prompt
    this.lastInterruptPath = "signal";
    this.interrupting = true;
    this.ctx!.runtime.kill("SIGINT");
    setTimeout(() => { if (!this.exited) this.ctx!.runtime.kill("SIGKILL"); }, 3000);
  }

  /** Stop the process. A running turn ends as turn.interrupted with this reason, never turn.failed. */
  async terminate(reason = "session stopped"): Promise<void> {
    if (!this.child) return;
    if (this.tr.turnId) { this.tr.interruptRequested = true; this.tr.interruptReason = reason; this.interrupting = true; }
    try { this.child.stdin!.end(); } catch { /* ignore */ }
    const c = this.child;
    await new Promise<void>((res) => {
      const t = setTimeout(() => { this.ctx!.runtime.kill("SIGKILL"); res(); }, 4000);
      c.once("exit", () => { clearTimeout(t); res(); });
      this.ctx!.runtime.kill("SIGTERM");
    });
  }
}
