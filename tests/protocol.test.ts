// Protocol package: Zod schemas and the parseEvent compatibility rules (GW-PLAN 7).
// Run: node --test tests/protocol.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_EVENT_TYPES, AgentEventSchema, ClientMessage, CreateSessionBody, EventPayloads, PROTOCOL_VERSION, ProjectConfig,
  parseEvent, parsePayload, resolveTheme,
} from "../packages/protocol/src/index.ts";

const root = new URL("..", import.meta.url).pathname;

const envelope = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: 1, id: "e1", sessionId: "s1", seq: 1, occurredAt: "2026-10-02T20:00:00.000Z", source: "claude-cli", ...extra,
});

test("PROTOCOL_VERSION is 1 and every event type has a payload schema", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.ok(AGENT_EVENT_TYPES.length >= 17);
  for (const t of AGENT_EVENT_TYPES) assert.ok(EventPayloads[t], `payload schema for ${t}`);
});

test("a valid known event parses as kind known", () => {
  const raw = envelope({ type: "message.delta", turnId: "t1", payload: { messageId: "msg_1#0", role: "assistant", delta: "hi" } });
  const r = parseEvent(raw);
  assert.equal(r.kind, "known");
  assert.equal(r.kind === "known" && r.event.type, "message.delta");
});

test("a translator-shaped fixture event (tool.started with arbitrary input) parses", () => {
  const raw = envelope({ seq: 7, type: "tool.started", payload: { toolUseId: "toolu_1", name: "Read", input: { file_path: "/x" } } });
  const r = parseEvent(raw);
  assert.equal(r.kind, "known");
  // and through the discriminated union directly
  assert.equal(AgentEventSchema.parse(raw).type, "tool.started");
});

test("an invalid payload for a known type throws", () => {
  const raw = envelope({ type: "message.delta", payload: { messageId: "m", role: "user", delta: "x" } });
  assert.throws(() => parseEvent(raw));
  assert.throws(() => parseEvent(envelope({ type: "turn.completed", payload: {} })));
  assert.throws(() => parsePayload("usage.updated", { inputTokens: "1", outputTokens: 2 }));
});

test("an invalid envelope for a known type throws (seq must be a positive int)", () => {
  assert.throws(() => parseEvent(envelope({ seq: 0, type: "turn.completed", payload: { turnId: "t" } })));
  assert.throws(() => parseEvent(envelope({ seq: 1.5, type: "turn.completed", payload: { turnId: "t" } })));
  assert.throws(() => parseEvent(envelope({ source: "nope", type: "turn.completed", payload: { turnId: "t" } })));
});

test("an unknown type with a valid v1 envelope is returned as kind unknown", () => {
  const r = parseEvent(envelope({ seq: 9, type: "future.thing", payload: { whatever: true } }));
  assert.equal(r.kind, "unknown");
  if (r.kind === "unknown") {
    assert.equal(r.envelope.type, "future.thing");
    assert.equal(r.envelope.seq, 9, "the client must be able to advance its cursor");
  }
});

test("an unknown type with an INVALID envelope throws", () => {
  assert.throws(() => parseEvent({ protocolVersion: 1, type: "future.thing" }));
});

test("an unknown type named like an Object.prototype member is still unknown (fixed: Object.hasOwn)", () => {
  // packages/protocol/src/index.ts parseEvent: `type in EventPayloads` is true for
  // "constructor" / "toString" / "hasOwnProperty" via the prototype chain, so the
  // event is routed to AgentEventSchema.parse and throws instead of being skipped.
  for (const t of ["constructor", "toString", "hasOwnProperty"]) {
    const r = parseEvent(envelope({ type: t, payload: {} }));
    assert.equal(r.kind, "unknown", `type ${t} should be unknown, not a parse failure`);
  }
});

test("protocolVersion 2 (or missing) returns incompatible", () => {
  const r = parseEvent(envelope({ protocolVersion: 2, type: "turn.completed", payload: { turnId: "t" } }));
  assert.deepEqual(r, { kind: "incompatible", protocolVersion: 2 });
  assert.equal(parseEvent({ type: "x" }).kind, "incompatible");
  assert.equal(parseEvent(null).kind, "incompatible");
  assert.equal(parseEvent(envelope({ protocolVersion: "1", type: "turn.completed", payload: { turnId: "t" } })).kind, "incompatible");
});

test("ClientMessage accepts valid messages", () => {
  assert.equal(ClientMessage.parse({ type: "hello", protocolVersion: 1, afterSeq: 0 }).type, "hello");
  assert.equal(ClientMessage.parse({ type: "turn.submit", requestId: "12345678", input: "hi" }).type, "turn.submit");
  assert.equal(ClientMessage.parse({ type: "interrupt", requestId: "12345678" }).type, "interrupt");
  assert.equal(ClientMessage.parse({ type: "terminal.resize", requestId: "r", ownershipGeneration: 1, cols: 80, rows: 24 }).type, "terminal.resize");
  assert.equal(ClientMessage.parse({ type: "approval.decision", requestId: "r", approvalId: "a", decision: "deny" }).type, "approval.decision");
});

test("ClientMessage rejects bad input", () => {
  const bad: unknown[] = [
    {},
    { type: "nope" },
    { type: "hello", protocolVersion: 2 },
    { type: "hello", protocolVersion: 1, afterSeq: -1 },
    { type: "hello", protocolVersion: 1, afterSeq: 1.5 },
    { type: "turn.submit", requestId: "short", input: "hi" },
    { type: "turn.submit", requestId: "12345678", input: "" },
    { type: "turn.submit", requestId: "12345678", input: "x".repeat(20001) },
    { type: "interrupt" },
    { type: "terminal.input", inputId: "i", data: "x" },
    { type: "terminal.input", inputId: "i", ownershipGeneration: 1, data: "x".repeat(65537) },
    { type: "terminal.resize", requestId: "r", ownershipGeneration: 1, cols: 5, rows: 24 },
    { type: "terminal.resize", requestId: "r", ownershipGeneration: 1, cols: 80, rows: 301 },
    { type: "approval.decision", requestId: "r", approvalId: "a", decision: "maybe" },
    "hello",
    null,
  ];
  for (const b of bad) assert.equal(ClientMessage.safeParse(b).success, false, `should reject ${JSON.stringify(b)?.slice(0, 80)}`);
});

test("CreateSessionBody: adapter must be a known name", () => {
  assert.equal(CreateSessionBody.safeParse({ workspace: { path: "/x" }, adapter: "codex-app-server" }).success, true);
  assert.equal(CreateSessionBody.safeParse({ workspace: { path: "/x" }, adapter: "gpt" }).success, false);
  assert.equal(CreateSessionBody.safeParse({ adapter: "pty" }).success, false);
});

test("ProjectConfig parses .agent-gateway/config.json", (t) => {
  const p = join(root, ".agent-gateway", "config.json");
  if (!existsSync(p)) { t.skip(".agent-gateway/config.json does not exist"); return; }
  const cfg = ProjectConfig.parse(JSON.parse(readFileSync(p, "utf8")));
  assert.ok(cfg.name);
});

test("ProjectConfig rejects unknown enum values and resolveTheme fills defaults", () => {
  assert.equal(ProjectConfig.safeParse({ name: "x", theme: { palette: "neon" } }).success, false);
  assert.equal(ProjectConfig.safeParse({ name: "x", review: { pollMs: 10 } }).success, false);
  assert.deepEqual(resolveTheme(), { palette: "catppuccin", initial: "dark", flavor: "mocha", accent: "mauve", userSelectable: true });
  assert.equal(resolveTheme(ProjectConfig.parse({ name: "x", theme: { initial: "light", accent: "teal" } })).accent, "teal");
});
