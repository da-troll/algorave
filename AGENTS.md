# AGENTS.md: Algorave

A live-coding studio on Strudel where a Claude Code agent builds songs in a git repo per song, checked by the `ears` MCP server. It is a faithful SLICE of the Agent Session Gateway template plan (GW-PLAN): canonical protocol, SQLite event log with afterSeq replay, SessionAdapter, a stream-json Claude adapter, a claude-only PTY, Catppuccin Mocha + Latte. It is not the template itself.

## Hard rules

1. The browser talks only to the gateway. Never to a PTY, an agent binary or git directly.
2. Adapters emit canonical events (`packages/protocol`); the UI renders that model. Never derive turn state from terminal bytes.
3. The agent's only executable capability is the ears MCP server. Never add Bash, web tools or Task to the agent's `--tools`. Never let `strudel_check` evaluate agent code outside the sandbox (`agent-kit/ears/src/check.ts` + `lockdown.ts`).
4. The Terminal tab runs `claude` only. No shell fallback, ever.
5. Both themes always: Catppuccin Mocha (dark) and Latte (light). No colour literals outside `packages/ui-theme`; `pnpm check:design` and `pnpm test:themes` must pass.
6. Stop never deletes a song or a commit. Rewind is a new commit, never `reset --hard`.
7. Authentication is mandatory on every `/api` route (edge identity from a trusted peer, Host/Origin/CSRF checks). Never weaken it.

## Layout

| Path | What |
|---|---|
| `packages/protocol` | Zod schemas: entities, every AgentEvent payload, client messages, ProjectConfig |
| `packages/persistence` | SQLite store; `appendEvent` is the only seq allocator |
| `packages/adapters/*` | `core` (SessionAdapter), `claude-cli`, `pty`, stubs `codex-app-server`, `acp` |
| `packages/sdk` | browser client: connect(afterSeq), dedupe, backoff |
| `packages/ui-theme` | AppTheme (single theme owner), tokenColor, watchTheme, terminalTheme, tone |
| `packages/ui-agent-shell` | Conversation, Activity, Review, Terminal panels, registerPanel |
| `apps/gateway` | Hono server, sessions, song service (git per song), WS replay |
| `apps/web` | host app; project panels in `src/project/` (REPL, Timeline, Genres, Path, Visuals, Record) |
| `agent-kit/ears` | the MCP server + `compileSong` (the ONE compiler) |
| `agent-kit/skills` | what every song's agent sees (copied into the song at session start) |
| `agent-kit/song-template` | a new song repo |
| `content/genres`, `content/path` | genre cards (also read by the strudel-genres skill), guided-path lessons |

## Commands

```
pnpm install
pnpm build            # ears, web (out/), gateway (apps/gateway/dist)
pnpm start            # PORT, ALGORAVE_BIND (default 127.0.0.1,172.17.0.1), ALGORAVE_DATA
pnpm typecheck
pnpm test             # protocol, persistence, adapter fixtures, auth, gateway, ears, content
pnpm smoke:claude     # REAL claude session (costs tokens)
pnpm test:security    # REAL claude sessions: the plan-8 refusals
pnpm check:design && pnpm test:themes
```

## Working inside a song through a session

The song's own `AGENTS.md` (the music-director brief) governs there, not this file.

Read `.agent-gateway/PROJECT.md` section 10 before changing auth, the adapter flags or the ears sandbox.
