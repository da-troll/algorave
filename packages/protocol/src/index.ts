// @agent-gateway/protocol v1: the one contract shared by adapters, gateway, SDK and UI.
// Zod is the source of truth (GW-PLAN 7). Every AgentEventType has a concrete payload.
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

// ---------- entities (GW-PLAN 7.1) ----------
// "claude-cli" is an ADDITIVE adapter name (this project's structured Claude adapter
// drives the installed Claude Code CLI over stream-json). See PROJECT.md section 10.
export const AdapterName = z.enum(["pty", "claude-cli", "claude-agent-sdk", "codex-app-server", "acp"]);
export type AdapterName = z.infer<typeof AdapterName>;
export const Capability = z.enum(["chat", "diff", "terminal", "approvals", "mcp"]);
export type Capability = z.infer<typeof Capability>;
export const WorkspaceMode = z.enum(["worktree", "in-place"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

export const SessionStatus = z.enum(["starting", "running", "idle", "stopped", "failed", "interrupted"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const Session = z.object({
  id: z.string(),
  label: z.string().optional(),
  adapter: AdapterName,
  workspacePath: z.string(),
  workspaceMode: WorkspaceMode,
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  headCommit: z.string().optional(),
  providerSessionId: z.string().optional(),
  model: z.string().optional(),
  status: SessionStatus,
  recovery: z.object({ canResume: z.boolean(), reason: z.string().optional() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActivityAt: z.string(),
  capabilities: z.array(Capability),
});
export type Session = z.infer<typeof Session>;

export const TurnState = z.enum(["pending", "running", "completed", "failed", "interrupted"]);
export const Turn = z.object({
  id: z.string(),
  sessionId: z.string(),
  input: z.string(),
  state: TurnState,
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type Turn = z.infer<typeof Turn>;

export const ApprovalRisk = z.enum(["read", "low", "elevated", "critical"]);
export const ApprovalSource = z.enum(["user-policy", "project-policy", "adapter"]);
export const Approval = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string().optional(),
  scope: z.string(),
  risk: ApprovalRisk,
  commandOrTool: z.string(),
  cwd: z.string().optional(),
  source: ApprovalSource,
  expiresAt: z.string().optional(),
  decision: z.enum(["allow", "deny"]).optional(),
});
export type Approval = z.infer<typeof Approval>;

export const ArtifactKind = z.enum(["diff", "file", "log", "image", "report", "link"]);
export const Artifact = z.object({
  id: z.string(),
  sessionId: z.string(),
  kind: ArtifactKind,
  pathOrUrl: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
});
export type Artifact = z.infer<typeof Artifact>;

// ---------- events (GW-PLAN 7.2) ----------
const Json: z.ZodType<unknown> = z.unknown();

export const SessionStatusReason = z.enum([
  "created", "started", "provider-session", "turn-running", "turn-finished", "exited", "stopped",
  "interrupted-by-restart", "stale-lock-reclaimed", "input-ownership-changed", "resumed", "error",
]);

export const EventPayloads = {
  "session.status": z.object({ status: SessionStatus, reason: SessionStatusReason, detail: z.string().optional(), providerSessionId: z.string().optional() }),
  "turn.started": z.object({ turnId: z.string(), input: z.string() }),
  "message.delta": z.object({ messageId: z.string(), role: z.literal("assistant"), delta: z.string() }),
  "message.completed": z.object({ messageId: z.string(), role: z.enum(["user", "assistant"]), text: z.string(), delivery: z.enum(["delivered", "delivery-unknown"]).optional() }),
  "reasoning.summary": z.object({ messageId: z.string(), text: z.string() }),
  "tool.started": z.object({ toolUseId: z.string(), name: z.string(), input: Json }),
  "tool.output": z.object({ toolUseId: z.string(), output: z.string(), truncated: z.boolean() }),
  "tool.completed": z.object({ toolUseId: z.string(), isError: z.boolean() }),
  "file.changed": z.object({ paths: z.array(z.string()) }),
  "diff.updated": z.object({
    files: z.array(z.object({ path: z.string(), status: z.string() })),
    diff: z.string(),
    hash: z.string(),
    truncated: z.boolean(),
    unstable: z.boolean().optional(),
  }),
  "artifact.created": z.object({ artifact: Artifact, summary: z.string().optional(), body: z.string().optional(), ok: z.boolean().optional() }),
  "approval.requested": z.object({ approval: Approval }),
  "approval.resolved": z.object({ approvalId: z.string(), decision: z.enum(["allow", "deny"]), source: ApprovalSource, toolName: z.string().optional(), reason: z.string().optional() }),
  "usage.updated": z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number().optional(), costUsd: z.number().optional(), durationMs: z.number().optional() }),
  "turn.completed": z.object({ turnId: z.string(), result: z.string().optional() }),
  "turn.failed": z.object({ turnId: z.string(), error: z.string() }),
  "turn.interrupted": z.object({ turnId: z.string(), reason: z.string() }),
} as const;

export type AgentEventType = keyof typeof EventPayloads;
export const AGENT_EVENT_TYPES = Object.keys(EventPayloads) as AgentEventType[];
export type EventPayloadMap = { [K in AgentEventType]: z.infer<(typeof EventPayloads)[K]> };

export const EventSource = z.union([AdapterName, z.literal("system")]);
export type EventSource = z.infer<typeof EventSource>;

export const EventEnvelope = z.object({
  protocolVersion: z.literal(1),
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string().optional(),
  seq: z.number().int().positive(),
  occurredAt: z.string(),
  source: EventSource,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export type AgentEvent = { [K in AgentEventType]: EventEnvelope & { type: K; payload: EventPayloadMap[K] } }[AgentEventType];
export type AdapterEvent = { [K in AgentEventType]: { type: K; turnId?: string; payload: EventPayloadMap[K] } }[AgentEventType];

const eventSchemas = AGENT_EVENT_TYPES.map((t) => EventEnvelope.extend({ type: z.literal(t), payload: EventPayloads[t] }));
export const AgentEventSchema = z.discriminatedUnion("type", eventSchemas as unknown as [typeof eventSchemas[0], ...typeof eventSchemas]);

/** Validate a payload for a known type. Throws on an invalid known payload. */
export function parsePayload<K extends AgentEventType>(type: K, payload: unknown): EventPayloadMap[K] {
  return EventPayloads[type].parse(payload) as EventPayloadMap[K];
}

export type ParsedEvent =
  | { kind: "known"; event: AgentEvent }
  | { kind: "unknown"; envelope: EventEnvelope & { type: string } }
  | { kind: "incompatible"; protocolVersion: unknown };

/**
 * Client-side parse with the compatibility rules: a known type with an invalid
 * payload throws; an unknown type with a valid v1 envelope is returned as
 * "unknown" so the client advances its cursor; another major is "incompatible".
 */
export function parseEvent(raw: unknown): ParsedEvent {
  const pv = (raw as { protocolVersion?: unknown })?.protocolVersion;
  if (pv !== PROTOCOL_VERSION) return { kind: "incompatible", protocolVersion: pv };
  const type = (raw as { type?: unknown }).type;
  if (typeof type === "string" && Object.hasOwn(EventPayloads, type)) return { kind: "known", event: AgentEventSchema.parse(raw) as AgentEvent };
  const env = EventEnvelope.extend({ type: z.string() }).parse(raw);
  return { kind: "unknown", envelope: env };
}

// ---------- terminal transport (never durable events) ----------
export const TerminalFrame = z.object({ type: z.literal("terminal.output"), sessionId: z.string(), epoch: z.string(), offset: z.number(), data: z.string() });
export const TerminalSnapshot = z.object({ type: z.literal("terminal.snapshot"), sessionId: z.string(), epoch: z.string(), throughOffset: z.number(), cols: z.number(), rows: z.number(), state: z.string() });
export const TerminalSize = z.object({ type: z.literal("terminal.resize"), sessionId: z.string(), epoch: z.string(), atOffset: z.number(), cols: z.number(), rows: z.number() });
export type TerminalFrame = z.infer<typeof TerminalFrame>;
export type TerminalSnapshot = z.infer<typeof TerminalSnapshot>;
export type TerminalSize = z.infer<typeof TerminalSize>;

// ---------- WS client / server messages (GW-PLAN 7.4) ----------
export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), protocolVersion: z.literal(1), afterSeq: z.number().int().min(0).optional(), terminal: z.object({ epoch: z.string(), afterOffset: z.number() }).optional() }),
  z.object({ type: z.literal("turn.submit"), requestId: z.string().min(8), input: z.string().min(1).max(20000), ownershipGeneration: z.number().optional() }),
  z.object({ type: z.literal("interrupt"), requestId: z.string().min(8), ownershipGeneration: z.number().optional() }),
  z.object({ type: z.literal("terminal.input"), inputId: z.string(), ownershipGeneration: z.number(), data: z.string().max(65536) }),
  z.object({ type: z.literal("terminal.resize"), requestId: z.string(), ownershipGeneration: z.number(), cols: z.number().int().min(10).max(500), rows: z.number().int().min(4).max(300) }),
  z.object({ type: z.literal("approval.decision"), requestId: z.string(), approvalId: z.string(), decision: z.enum(["allow", "deny"]) }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type StreamSnapshot = { type: "snapshot"; protocolVersion: 1; session: Session; lastSeq: number };
export type CommandAck = { type: "ack"; requestId: string; result: unknown };
export type CommandError = { type: "error"; requestId?: string; code: string; message: string; resumable?: boolean };
export type ServerMessage = StreamSnapshot | AgentEvent | CommandAck | CommandError | TerminalFrame | TerminalSnapshot | TerminalSize | { type: "replay.done"; throughSeq: number };

// ---------- HTTP bodies ----------
export const CreateSessionBody = z.object({
  workspace: z.object({ path: z.string(), mode: WorkspaceMode.optional() }),
  adapter: AdapterName.optional(),
  label: z.string().max(200).optional(),
  model: z.string().max(80).optional(),
  capabilities: z.array(Capability).optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

export const SubmitTurnBody = z.object({ input: z.string().min(1).max(20000) });
export type SubmitTurnResult = { kind: "turn"; turnId: string } | { kind: "pty-input"; acknowledged: true };

export type EventsPage = { events: AgentEvent[]; nextAfterSeq: number; hasMore: boolean; highWaterSeq: number };

// ---------- ProjectConfig (GW-PLAN 3.1) ----------
export const CatppuccinAccent = z.enum(["rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender"]);
export const ProjectConfig = z.object({
  name: z.string(),
  workspace: z.object({ mode: WorkspaceMode.optional() }).optional(),
  adapters: z.object({ default: AdapterName.optional(), enabled: z.array(AdapterName).optional() }).optional(),
  pty: z.object({ command: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() }).optional(),
  theme: z.object({
    palette: z.enum(["catppuccin", "clawdash", "trollspace", "phoenix"]).optional(),
    initial: z.enum(["dark", "light"]).optional(),
    flavor: z.enum(["mocha", "macchiato", "frappe"]).optional(),
    accent: CatppuccinAccent.optional(),
    userSelectable: z.boolean().optional(),
  }).optional(),
  files: z.object({ readable: z.array(z.string()).optional(), denied: z.array(z.string()).optional() }).optional(),
  review: z.object({ pollMs: z.number().int().min(250).optional(), paths: z.array(z.string()).optional() }).optional(),
  panels: z.object({ stock: z.array(z.enum(["conversation", "activity", "review", "terminal"])).optional(), project: z.array(z.string()).optional() }).optional(),
  policy: z.string().optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export type ResolvedTheme = { palette: "catppuccin" | "clawdash" | "trollspace" | "phoenix"; initial: "dark" | "light"; flavor: "mocha" | "macchiato" | "frappe"; accent: z.infer<typeof CatppuccinAccent>; userSelectable: boolean };
export function resolveTheme(c?: ProjectConfig): ResolvedTheme {
  return {
    palette: c?.theme?.palette ?? "catppuccin",
    initial: c?.theme?.initial ?? "dark",
    flavor: c?.theme?.flavor ?? "mocha",
    accent: c?.theme?.accent ?? "mauve",
    userSelectable: c?.theme?.userSelectable ?? true,
  };
}

export type UiConfig = { theme: ResolvedTheme; adapters: { default: AdapterName; enabled: AdapterName[] }; panels: { stock: string[]; project: string[] } };
