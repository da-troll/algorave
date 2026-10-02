# Algorave Room

A private live-coding music studio on [Strudel](https://strudel.cc). You build songs by talking to a real Claude Code agent; it edits the song's Strudel parts, checks its own work with a symbolic "ears" tool before you hear anything, and every change lands in the browser REPL on the next bar. Every agent turn is a git commit, so you can compare, rewind and branch versions.

Live (private, behind the household's Authentik): https://mvp.trollefsen.com/2026-10-02-algorave-room/

## What is in it

- **Chat with a producer.** One Claude Code process per session, in the song's git repo, with five in-repo music skills (strudel-core, strudel-genres, strudel-arrangement, strudel-sound-design, song-workflow). No shell, no web: the only thing the agent can execute is the ears MCP server.
- **ears.** `strudel_check` compiles the song exactly as the browser will and reports, in under 2 KB: errors mapped to `part:line`, notes outside the key, sound names the browser does not have (they play as silence), silent and unused parts, a 16-step drum grid for the first bar of each section, events per bar per part and per section, tempo. `song_info` and `runtime_errors` (what the browser actually did) complete it. Agent code is evaluated in a sandbox (Node permission model + network lockdown).
- **REPL.** Strudel's own editor (StrudelMirror), themed from the design tokens. New commits apply on the next bar (or next 4 bars, or now) with a pending pill; a version that does not parse never replaces what plays. Per-part tabs: Try (unsaved) and Keep (commits as you).
- **Timeline.** Every turn and every hand edit is a commit. Load any two into A/B and swap on the bar, branch from any commit (`idea/<name>`), rewind (a new commit restoring that version; history is never rewritten).
- **Guided path** (10 lessons, empty editor to a recorded take), **genre explorer** (10 techno and adjacent subgenres with playable starters), **Hydra visuals** reacting to the audio, **WAV recording** (live takes and offline render), **Continue my last jam**.
- **Terminal.** Claude Code itself in the song repo, in xterm themed from the tokens. When claude exits, the terminal ends.
- **Durable sessions.** Every event is in SQLite with a per-session sequence; a browser reload replays the transcript without duplicates and the turn keeps running; a gateway restart marks sessions interrupted, never re-sends a prompt, and offers Resume.
- Catppuccin Mocha and Latte, accent and flavor picker.

## Architecture

```
Browser (Vite + React 19, @trollefsen-labs design system, Catppuccin)
  Conversation | REPL | Timeline · Activity · Review · Visuals · Guided Path · Genres · Record · Terminal
     │ REST /api/*  +  WS /api/sessions/:id/stream (afterSeq replay)
Gateway (Node 22, Hono, better-sqlite3, Zod)  127.0.0.1 + docker bridge only
  sessions + event log · adapters: claude-cli (stream-json) · pty (claude only) · stubs
  song service: git per song, per-turn commits, edits, branches, rewind, runtime reports
     │ spawns
claude -p (stream-json) ── stdio ── ears MCP server ── sandboxed evaluator (node --permission)
data/songs/<slug>/  one git repo per song
```

See `AGENTS.md` for the layout and commands, `.agent-gateway/PROJECT.md` for the security model, deviations from the template plan and the recorded residuals, and `packages/adapters/claude-cli/README.md` for the exact CLI flags and what was verified.

## Running it

Requires Node 22, pnpm, an installed and logged-in `claude` CLI, and access to the private `@trollefsen-labs` packages (GitHub Packages; the install fails without it, by design).

```
pnpm install && pnpm build
PORT=3553 pnpm start
```

The gateway expects an authenticating reverse proxy in front of it that sets `X-authentik-Username` (see PROJECT.md section 10). For local testing, `node e2e/edge-proxy.ts` plays that role.

## Credits and licence

Built on **Strudel** by Felix Roos and contributors (AGPL-3.0, https://codeberg.org/uzu/strudel), **Hydra** by Olivia Jack (hydra-synth, AGPL-3.0), the TidalCycles sample banks and the Strudel sample maps it loads at runtime, and Claude Code.

**Provenance.** The inspiration is an Instagram post of Strudel live coding (no code to take from). Algorave Room was written for this build; no code was copied from the inspiration or from the prior-art projects named in the build plan (StrudelLM, DJ Claude, strudel-mcp-server), which informed ideas only. Strudel and Hydra are used as libraries, and one function, `prebake()` in `apps/web/src/project/engine.ts`, is adapted from `@strudel/repl`'s `prebake.mjs` (AGPL-3.0, same licence as this repo).

Because Strudel is AGPL-3.0, so is Algorave Room: see `LICENSE`. If you run a modified version for others over a network, you must offer them its source. The app footer links this repository.

Inspired by Strudel live coders including @dj_dave____, @_switch_angel and @charstiles.
