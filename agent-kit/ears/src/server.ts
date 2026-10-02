// ears: the stdio MCP server spawned by every claude process in a song repo.
// It is the agent's ONLY executable capability (no Bash). It reads the song from
// its cwd. Tools: strudel_check, song_info, runtime_errors.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkDir } from "./check.ts";

const songDir = process.env.ALGORAVE_SONG_DIR ?? process.cwd();

const server = new McpServer({ name: "ears", version: "0.1.0" });

function git(args: string[]): string {
  try {
    return execFileSync("git", ["-C", songDir, ...args], { encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  } catch {
    return "";
  }
}

server.registerTool(
  "strudel_check",
  {
    title: "Check the song",
    description:
      "Compile song.json + parts/*.js + arrange.js exactly as the browser will, evaluate it, and report: errors mapped to part file and line, notes outside the song's key/scale, sound names the browser does not have (they play as silence), a 16-step drum grid of bar 1, events per bar for each part and each arranged section, and tempo. Call after EVERY edit. Do not end a turn while it reports a failure or unexplained problems.",
    inputSchema: {},
  },
  async () => {
    const r = await checkDir(songDir);
    return { content: [{ type: "text", text: r.text }], isError: !r.ok && !!r.error };
  },
);

server.registerTool(
  "song_info",
  {
    title: "Song info",
    description: "song.json, the part files with a one-line summary each, the current git branch and the last 5 commits.",
    inputSchema: {},
  },
  async () => {
    const lines: string[] = [];
    lines.push(`song.json: ${existsSync(join(songDir, "song.json")) ? readFileSync(join(songDir, "song.json"), "utf8").trim() : "(missing)"}`);
    const partsDir = join(songDir, "parts");
    lines.push("parts:");
    if (existsSync(partsDir)) {
      for (const f of readdirSync(partsDir).filter((f) => f.endsWith(".js")).sort()) {
        const first = readFileSync(join(partsDir, f), "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join(" ").slice(0, 120);
        lines.push(`  parts/${f}: ${first}`);
      }
    }
    lines.push(`arrange.js: ${existsSync(join(songDir, "arrange.js")) ? readFileSync(join(songDir, "arrange.js"), "utf8").replace(/\s+/g, " ").slice(0, 200) : "(missing)"}`);
    lines.push(`branch: ${git(["rev-parse", "--abbrev-ref", "HEAD"]) || "(none)"}`);
    lines.push("last commits:");
    lines.push(...(git(["log", "-5", "--format=  %h %an: %s"]) || "  (none)").split("\n"));
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "runtime_errors",
  {
    title: "Browser runtime report",
    description: "What happened when the browser last evaluated and played the song: ok or the evaluation/scheduler error, which commit it was, and when. Use it when the user says something sounds broken or silent.",
    inputSchema: {},
  },
  async () => {
    const f = join(songDir, ".runtime", "last-eval.json");
    const text = existsSync(f) ? readFileSync(f, "utf8").trim() : "no report yet: the song has not been played in the browser since the gateway started";
    return { content: [{ type: "text", text }] };
  },
);

await server.connect(new StdioServerTransport());
