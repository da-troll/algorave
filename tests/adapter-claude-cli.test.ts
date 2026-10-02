// claude-cli StreamTranslator against REAL captured CLI stream-json output
// (packages/adapters/claude-cli/fixtures). Run: node --test tests/adapter-claude-cli.test.ts
//
// The adapter source uses a TypeScript parameter property (`constructor(private opts ...)`),
// which Node's strip-only TypeScript mode refuses (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). So the
// test bundles it with esbuild into a scratch dir first, exactly as the gateway build does.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { EventPayloads, type AdapterEvent } from "../packages/protocol/src/index.ts";

const root = new URL("..", import.meta.url).pathname;
const FIX = join(root, "packages/adapters/claude-cli/fixtures");
mkdirSync(join(root, "data", "test-runs"), { recursive: true });
const scratch = mkdtempSync(join(root, "data", "test-runs", "adapter-"));

type Translator = {
  turnId: string | null; providerSessionId: string | null; interruptRequested: boolean;
  onUnknown: (l: Record<string, unknown>) => void; onFileTool: (n: string) => void;
  translate(l: Record<string, unknown>): AdapterEvent[];
};
let StreamTranslator: new () => Translator;
let buildArgs: (o: Record<string, unknown>) => string[];

before(async () => {
  const out = join(scratch, "adapter.mjs");
  await build({ entryPoints: [join(root, "packages/adapters/claude-cli/src/index.ts")], outfile: out, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "error" });
  const m = await import(out);
  StreamTranslator = m.StreamTranslator;
  buildArgs = m.buildArgs;
});
after(() => rmSync(scratch, { recursive: true, force: true }));

const readLines = (f: string) => readFileSync(join(FIX, f), "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
const FIXTURES = readdirSync(FIX).filter((f) => f.endsWith(".jsonl")).sort();

type Run = { lines: Record<string, any>[]; events: AdapterEvent[]; unknown: Record<string, unknown>[]; fileTools: string[]; tr: Translator };
function run(f: string, turnId = "turn-test-1"): Run {
  const tr = new StreamTranslator();
  const unknown: Record<string, unknown>[] = [];
  const fileTools: string[] = [];
  tr.onUnknown = (l) => unknown.push(l);
  tr.onFileTool = (n) => fileTools.push(n);
  tr.turnId = turnId; // the adapter sets this in sendInput before writing the prompt
  const lines = readLines(f);
  const events: AdapterEvent[] = [];
  for (const l of lines) events.push(...tr.translate(l));
  return { lines, events, unknown, fileTools, tr };
}
const ofType = <K extends AdapterEvent["type"]>(evs: AdapterEvent[], t: K) => evs.filter((e) => e.type === t) as Extract<AdapterEvent, { type: K }>[];

test("fixtures are present", () => {
  for (const f of ["cap1.jsonl", "sec-a.jsonl", "sec-b.jsonl", "sec-c.jsonl", "smoke-turn.raw.jsonl"]) assert.ok(FIXTURES.includes(f), f);
});

for (const f of FIXTURES) {
  test(`${f}: every produced payload validates against EventPayloads`, () => {
    const { events, unknown } = run(f);
    assert.ok(events.length > 0);
    for (const e of events) {
      const r = EventPayloads[e.type].safeParse(e.payload);
      assert.ok(r.success, `${e.type} payload invalid: ${r.success ? "" : r.error.message}`);
    }
    assert.deepEqual(unknown, [], "real CLI line types are all handled");
  });

  test(`${f}: init -> session.status provider-session first`, () => {
    const { lines, events, tr } = run(f);
    const init = lines.find((l) => l.type === "system" && l.subtype === "init")!;
    assert.ok(init, "fixture has an init line");
    const st = events[0]!;
    assert.equal(st.type, "session.status");
    if (st.type === "session.status") {
      assert.equal(st.payload.reason, "provider-session");
      assert.equal(st.payload.status, "running");
      assert.equal(st.payload.providerSessionId, init.session_id);
    }
    assert.equal(tr.providerSessionId, init.session_id);
  });

  test(`${f}: tool_use -> tool.started, tool_result -> tool.output + tool.completed with isError`, () => {
    const { lines, events } = run(f);
    const uses = lines.filter((l) => l.type === "assistant" && !l.parent_tool_use_id).flatMap((l) => l.message.content.filter((c: any) => c.type === "tool_use"));
    const results = lines.filter((l) => l.type === "user" && !l.parent_tool_use_id && Array.isArray(l.message?.content)).flatMap((l) => l.message.content.filter((c: any) => c.type === "tool_result"));
    const started = ofType(events, "tool.started");
    assert.deepEqual(started.map((e) => e.payload.toolUseId), uses.map((u: any) => u.id));
    assert.deepEqual(started.map((e) => e.payload.name), uses.map((u: any) => u.name));
    const outputs = ofType(events, "tool.output");
    const completed = ofType(events, "tool.completed");
    assert.deepEqual(outputs.map((e) => e.payload.toolUseId), results.map((r: any) => r.tool_use_id));
    assert.deepEqual(completed.map((e) => e.payload.toolUseId), results.map((r: any) => r.tool_use_id));
    assert.deepEqual(completed.map((e) => e.payload.isError), results.map((r: any) => !!r.is_error));
    // each tool.output is immediately followed by its tool.completed
    for (const o of outputs) {
      const i = events.indexOf(o);
      assert.equal(events[i + 1]!.type, "tool.completed");
    }
    for (const e of [...started, ...outputs, ...completed]) assert.equal(e.turnId, "turn-test-1");
  });

  test(`${f}: result -> usage.updated then turn.completed, last, and turnId cleared`, () => {
    const { lines, events, tr } = run(f);
    const result = lines.find((l) => l.type === "result")!;
    const last2 = events.slice(-2);
    assert.equal(last2[0]!.type, "usage.updated");
    assert.equal(last2[1]!.type, "turn.completed");
    const u = last2[0]!;
    if (u.type === "usage.updated") {
      assert.equal(u.payload.outputTokens, result.usage.output_tokens);
      assert.equal(u.payload.inputTokens, result.usage.input_tokens + (result.usage.cache_creation_input_tokens ?? 0));
      assert.equal(u.payload.costUsd, result.total_cost_usd);
    }
    if (last2[1]!.type === "turn.completed") assert.equal(last2[1]!.payload.turnId, "turn-test-1");
    assert.equal(tr.turnId, null);
  });
}

for (const f of ["cap1.jsonl", "smoke-turn.raw.jsonl"]) {
  test(`${f}: text deltas use a stable messageId that matches the later message.completed`, () => {
    const { events } = run(f);
    const deltas = ofType(events, "message.delta");
    const completed = ofType(events, "message.completed");
    assert.ok(deltas.length > 0, "fixture streams text deltas");
    assert.ok(completed.length > 0, "fixture completes an assistant message");
    for (const c of completed) {
      const mine = deltas.filter((d) => d.payload.messageId === c.payload.messageId);
      assert.ok(mine.length > 0, `deltas exist for ${c.payload.messageId}`);
      assert.equal(mine.map((d) => d.payload.delta).join(""), c.payload.text, "concatenated deltas equal the completed text");
      assert.ok(events.indexOf(mine[mine.length - 1]!) < events.indexOf(c), "deltas precede completion");
      assert.equal(c.payload.role, "assistant");
    }
    // every delta id resolves to some completed message
    const ids = new Set(completed.map((c) => c.payload.messageId));
    for (const d of deltas) assert.ok(ids.has(d.payload.messageId), `delta ${d.payload.messageId} has a completion`);
  });
}

test("cap1 / smoke: a successful Edit triggers onFileTool", () => {
  assert.deepEqual(run("cap1.jsonl").fileTools, ["Edit"]);
  assert.deepEqual(run("smoke-turn.raw.jsonl").fileTools, ["Edit"]);
});

const DENIALS: Record<string, string> = { "sec-a.jsonl": "Read", "sec-b.jsonl": "Write", "sec-c.jsonl": "Glob" };
for (const [f, tool] of Object.entries(DENIALS)) {
  test(`${f}: result permission_denials -> approval.resolved deny for ${tool}`, () => {
    const { lines, events, fileTools } = run(f);
    const denials = ofType(events, "approval.resolved");
    const result = lines.find((l) => l.type === "result")!;
    assert.equal(denials.length, result.permission_denials.length);
    assert.equal(denials.length, 1);
    const d = denials[0]!;
    assert.equal(d.payload.decision, "deny");
    assert.equal(d.payload.source, "adapter");
    assert.equal(d.payload.toolName, tool);
    assert.equal(d.payload.approvalId, result.permission_denials[0].tool_use_id);
    assert.match(d.payload.reason ?? "", new RegExp(`permission layer: ${tool}`));
    // the denial precedes usage + completion, and the refused tool call itself errored
    assert.ok(events.indexOf(d) < events.findIndex((e) => e.type === "usage.updated"));
    assert.equal(ofType(events, "tool.completed").find((c) => c.payload.toolUseId === d.payload.approvalId)?.payload.isError, true);
    assert.deepEqual(fileTools, [], "a refused Write must not trigger the file poll");
  });
}

test("unknown line types go to onUnknown and never throw", () => {
  const tr = new StreamTranslator();
  const seen: unknown[] = [];
  tr.onUnknown = (l) => seen.push(l);
  tr.turnId = "t";
  for (const l of [{ type: "brand_new_thing", x: 1 }, {}, { type: 42 }, { type: null }]) assert.deepEqual(tr.translate(l as never), []);
  assert.equal(seen.length, 4);
  // known-but-ignored types are NOT reported as unknown
  assert.deepEqual(tr.translate({ type: "rate_limit_event" }), []);
  assert.deepEqual(tr.translate({ type: "control_response" }), []);
  assert.deepEqual(tr.translate({ type: "system", subtype: "status" }), []);
  assert.equal(seen.length, 4);
});

test("malformed known lines do not throw", () => {
  const tr = new StreamTranslator();
  tr.turnId = "t";
  assert.doesNotThrow(() => tr.translate({ type: "assistant" }));
  assert.doesNotThrow(() => tr.translate({ type: "user", message: { content: "plain string" } }));
  assert.doesNotThrow(() => tr.translate({ type: "stream_event" }));
  assert.doesNotThrow(() => tr.translate({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } }));
});

test("subagent lines (parent_tool_use_id) are skipped", () => {
  const tr = new StreamTranslator();
  tr.turnId = "t";
  assert.deepEqual(tr.translate({ type: "assistant", parent_tool_use_id: "toolu_x", message: { id: "m", content: [{ type: "text", text: "hi" }] } }), []);
  assert.deepEqual(tr.translate({ type: "user", parent_tool_use_id: "toolu_x", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "x" }] } }), []);
});

test("result error -> turn.failed; interruptRequested -> turn.interrupted; no turnId -> usage only", () => {
  const tr = new StreamTranslator();
  tr.turnId = "t1";
  const failed = tr.translate({ type: "result", subtype: "error_during_execution", is_error: true, usage: {} });
  assert.deepEqual(failed.map((e) => e.type), ["usage.updated", "turn.failed"]);
  tr.turnId = "t2";
  tr.interruptRequested = true;
  const intr = tr.translate({ type: "result", subtype: "success", is_error: false, usage: {} });
  assert.deepEqual(intr.map((e) => e.type), ["usage.updated", "turn.interrupted"]);
  assert.equal(tr.interruptRequested, false);
  assert.deepEqual(tr.translate({ type: "result", subtype: "success", usage: {} }).map((e) => e.type), ["usage.updated"]);
  for (const e of [...failed, ...intr]) assert.ok(EventPayloads[e.type].safeParse(e.payload).success);
});

test("long tool output is truncated at 8000 chars and flagged", () => {
  const tr = new StreamTranslator();
  tr.turnId = "t";
  const evs = tr.translate({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: [{ type: "text", text: "x".repeat(9000) }] }] } });
  const o = evs[0]!;
  assert.equal(o.type, "tool.output");
  if (o.type === "tool.output") { assert.equal(o.payload.output.length, 8000); assert.equal(o.payload.truncated, true); }
});

test("buildArgs: Bash and web tools are disallowed, resume is appended", () => {
  const a = buildArgs({ bin: "claude", model: "m", mcpConfig: "/x.json", tools: ["Read"], allowedTools: ["Skill"], disallowedTools: ["Bash", "WebFetch"], resumeId: "abc" });
  assert.equal(a[a.indexOf("--disallowedTools") + 1], "Bash,WebFetch");
  assert.equal(a[a.indexOf("--setting-sources") + 1], "project");
  assert.ok(a.includes("--strict-mcp-config"));
  assert.deepEqual(a.slice(-2), ["--resume", "abc"]);
});
