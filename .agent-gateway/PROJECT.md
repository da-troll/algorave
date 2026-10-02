# Algorave Room: agent gateway overlay

Template version: none yet. This repo is a faithful SLICE of the Agent Session Gateway template plan (GW-PLAN, household plans folder), built 2026-10-02. The template repo will be extracted from this code later; this file records what the slice chose and where it departs. Mode: A (greenfield, project panels live in `apps/web/src/project/`).

## 1. What this project is, and what the gateway is for here

A private live-coding studio on Strudel. Each song is a git repo under `data/songs/<slug>/`. Daniel talks to a real Claude Code agent that edits the song's Strudel parts with in-repo skills and checks its own work with the `ears` MCP server. The gateway owns the sessions, the durable event log, the per-song git history and the security boundary around the agent.

## 2. Workspace mode and why

`in-place`, with the exclusive writer lock keyed by the song directory's realpath. A song has one history that Daniel listens to; forking it per session into worktrees would split what he hears from what the agent edits. One writer per song: a chat session OR a terminal session, never both (409 with the holder's id).

## 3. Adapters: default, enabled, and PTY command

- Default: `claude-cli`, a structured adapter over the installed Claude Code CLI in stream-json mode (one long-lived process per session, cwd = song). Verified against claude 2.1.288 on 2026-10-02; flags and test notes in `packages/adapters/claude-cli/README.md`.
- Enabled: `claude-cli` and `pty`. The PTY runs `claude` ONLY, with the same tool flags, interactive. There is no shell fallback and no command field: when claude exits, the terminal ends.
- `codex-app-server` and `acp` are stubs that throw `AdapterNotImplementedError` (422 with the message). A Codex adapter could run through the household LiteLLM gateway later.

## 4. Theme

Palette `catppuccin`, dark flavor `mocha`, accent `mauve`, first visit dark. Light is always Latte. Both ship; the header toggle is always visible and a popover offers flavor (dark only) and accent.

## 5. Policy

No `policy.yaml`. The enforcement that exists, stated precisely (the Activity panel says the same):

| Layer | What it enforces | Tested by |
|---|---|---|
| Claude Code tool set | `--tools Read,Edit,Write,Glob,Grep,Skill` (no Bash, no web, no Task); `--disallowedTools Bash,WebFetch,WebSearch,Task,NotebookEdit` | init event lists exactly 9 tools |
| Claude Code permission layer | file tools outside the song dir need a grant that `-p` mode never gives; song `.claude/settings.json` denies `Read/Edit` of `/home/eve/config`, `~/.claude`, `~/.ssh`, `/etc`, and `Edit` in `/tmp` | `scripts/security-tests.ts` (a), (b), (c): refused, and each refusal is an `approval.resolved deny` row in Activity |
| ears sandbox | agent-written Strudel is JavaScript; `strudel_check` evaluates it in a child under `node --permission` (read only the ears dist; no writes, child processes, workers or addons; empty env) plus an in-process network lockdown | `tests/ears.test.ts` sandbox tests with positive controls; security test (d) |

This is NOT an OS sandbox. The agent process runs as the host user.

## 6. Files the UI may read, and files it must never serve

`files.readable` is empty: project panels read song data through the app's own song routes (`/api/songs/...`), not the generic file endpoint, which is not implemented in this slice (see 10).

## 7. Project panels

REPL (StrudelMirror with next-bar apply), Timeline (git log, A/B, branch, rewind), Visuals (Hydra), Guided Path, Genres, Record. Registered with `registerPanel`, built in `apps/web/src/project/`.

## 8. Project rules every agent session must respect

The song's own `AGENTS.md` (the music-director brief, `agent-kit/song-template/AGENTS.md`): edit parts not arrange, keep `song.json` sections in sync, call `strudel_check` after every edit and never end on a failing check, close each turn with 1 to 3 lines in musical terms.

## 9. Acceptance additions

Plan section 13 of the Algorave Room plan, all run with evidence in the build report: typecheck, tests, `smoke:claude`, the security tests, end-to-end in both themes at dpr 2, reload mid-turn, gateway restart, Timeline, Terminal, Record, mobile width.

## 10. Deviations from the template, and the generic option each one needs

1. **Edge identity instead of the bootstrap cookie (GW-PLAN 10).** Behind Caddy + Authentik forward_auth, the gateway requires `X-authentik-Username: daniel` and trusts it ONLY from a loopback or docker-bridge (172.16.0.0/12) peer, validates Host on every request, Origin on every mutation and WS upgrade, and requires `X-Algorave: 1` plus JSON bodies on mutations. Generic option needed: `auth.mode: "bootstrap-cookie" | "trusted-proxy-header"` with the header name, allowed peers and allowed users. **Residual:** another process or container on the docker bridge could forge the header straight at the gateway port. A `header_up` shared secret from Caddy would close it, but the snippet is generated by `generate-caddyfile.sh` for the whole fleet and has no per-app secret hook; adding one is an infrastructure change, so it is logged, not invented here.
2. **Project panels write (GW-PLAN 12.3 says they never write).** Daniel's own REPL edits commit through `PUT /api/songs/:slug/files` (only `parts/*.js`, `arrange.js`, `song.json`; refused with 409 while an agent turn runs or when `baseCommit` is not HEAD; committed as `Daniel`). Branch, checkout and rewind (a NEW commit restoring a tree, never `reset --hard`) also write. This is the project's host deciding to write, not template code.
3. **Project feedback channel.** The browser REPL posts evaluation and scheduler errors to `POST /api/songs/:slug/runtime-report`; the gateway writes `.runtime/last-eval.json` (read by the ears `runtime_errors` tool) and adds an Activity row when the song has a live session. Candidate generic template option: `feedback: { path, schema }`.
4. **`claude-cli` adapter name** is additive to the v1 `AdapterName` union (GW-PLAN 16 names the Agent SDK; this drives the CLI because the household runs on the CLI's own login and never introduces an API key).
5. **Generic file endpoint and policy package** (GW-PLAN 7.4 files, 11) are not in this slice; `policy` is a no-op evaluator that describes the real enforcement above.
6. **Skills are copied, not symlinked.** At session start the gateway copies `agent-kit/skills` (dereferenced, so the genre cards and `sounds.json` come along) into the song's gitignored `.claude/skills`. A symlink would point outside the song dir, where the permission layer refuses reads. Fixes still reach every song at its next session.
7. **`@strudel/repl` is not imported.** Its dist bundles a second copy of `@strudel/core`; the app uses `StrudelMirror` from `@strudel/codemirror` (the class `<strudel-editor>` wraps) with a `prebake()` mirroring `@strudel/repl/prebake.mjs`. Strudel's `activateTheme()` injects `:root { --foreground: ... !important }` and a `.dark` class, which collide with the design tokens; the engine empties that block and removes the class (`neutralizeStrudelTheme`).
8. **Hydra is served locally** (`public/vendor/hydra-synth.js`, AGPL) because the CSP allows scripts from self only; `initHydra` would otherwise load unpkg.

### Residuals, recorded

- **ears network lockdown is in-process, not a kernel boundary.** Unprivileged user namespaces are blocked here (`unshare -rn`: `write failed /proc/self/uid_map`, `kernel.apparmor_restrict_unprivileged_userns=1`) and `systemd-run --user -p IPAddressDeny=any` is ignored by the user manager (measured: a sandboxed fetch still reached the bridge). So the evaluator blocks every module load after Strudel is ready (module.registerHooks), patches the net/tls/http/https/http2/dgram/dns singletons to throw, deletes fetch/WebSocket/EventSource/XMLHttpRequest, and disables process.binding/getBuiltinModule/dlopen, inside the `--permission` child. A bypass of V8/Node internals would beat it. The real fix needs root: an AppArmor userns allowance for this node binary, or a dedicated uid with an nftables owner match. Ticketed.
- **Agent-written Strudel runs in Daniel's browser** on the shared `mvp.trollefsen.com` origin, so it could call same-origin APIs (including other nightlies') as Daniel. That is inherent to Strudel. Mitigation: the page's CSP limits `connect-src` to self plus the sample hosts (`raw.githubusercontent.com`, `strudel.b-cdn.net`, `felixroos.github.io`, `cdn.freesound.org`), so it cannot exfiltrate elsewhere; same-origin calls remain possible.
- **Interactive claude asks the workspace-trust question** (default "No, exit") the first time the Terminal opens in a new song. Left as is: it is a real human trust decision and the chat adapter does not need it.
- **Design-system findings for upstream:** in Latte, tone `-fg` on tone `-bg` measures 4.2 to 4.3:1 at badge size (axe), so badges here use the tone border and `-fg` on the opaque surface; `components-react` 0.4.0 `custom-theme-picker.tsx:93` fails `noUncheckedIndexedAccess`.

## config.json (derived from the sections above)

See `config.json` beside this file.
