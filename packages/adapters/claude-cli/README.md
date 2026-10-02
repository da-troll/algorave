# @agent-gateway/adapter-claude-cli

Structured `SessionAdapter` over the installed Claude Code CLI in stream-json mode.

| | |
|---|---|
| Tested binary | `claude` 2.1.288 (Claude Code), `/home/eve/.local/bin/claude` |
| Verified | 2026-10-02 |
| Auth | the CLI's own login (Claude Max); no API key is ever introduced |
| Docs | https://docs.claude.com/en/docs/claude-code/cli-reference |

## Launch

One long-lived process per chat session, cwd = the song repo, env = `HOME`, `PATH`, `LANG` only:

```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages \
  --model <claude-sonnet-5-5 | claude-opus-5-5> --setting-sources project --permission-mode acceptEdits \
  --tools Read,Edit,Write,Glob,Grep,Skill \
  --allowedTools Skill,mcp__ears__strudel_check,mcp__ears__song_info,mcp__ears__runtime_errors \
  --disallowedTools Bash,WebFetch,WebSearch,Task,NotebookEdit \
  --mcp-config <data>/mcp/<session>.json --strict-mcp-config [--resume <provider session id>]
```

## What was tested, and what it showed

- `--allowedTools` alone only PRE-APPROVES: with it, the init event still listed ~25 tools (CronCreate, SendMessage, Workflow, RemoteTrigger...). `--tools` is what restricts the built-in set: with it, init lists exactly 9 tools (6 built-in + 3 ears).
- File tools are deliberately NOT in `--allowedTools`: `--allowedTools Read` would pre-approve reads anywhere. Inside the cwd they are allowed anyway; outside, `-p` mode can never grant them (`Claude requested permissions to read from ..., but you haven't granted it yet`).
- `--setting-sources project` loads the song's `.claude/skills` and `.claude/settings.json` and keeps the user's global hooks out. `--restricted` was also tried: it confines file tools to the working dir but ignores project settings and HIDES project skills (the agent answered "Unknown skill"), so it is not used.
- The song settings' `Write(//tmp/**)` deny rule is ignored by the CLI ("only Edit(path) rules are matched by file permission checks"), so the template denies with `Edit(...)`, which covers all file-editing tools.
- `system/init` arrives only after the first prompt is written to stdin; the adapter reports `idle/started` at spawn.
- Interrupt: the stream-json control request `{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}` works: the turn ends with a `result` within ~30 ms, mapped to `turn.interrupted`, and the SAME process takes the next prompt. The SIGINT + `--resume` fallback is kept for when the control request gets no answer within 4 s.
- Resume after a gateway restart: `--resume <session_id>` in a fresh process continues the conversation (tested: the agent recalled the interrupted request). Offered in the UI only for chat sessions with a provider id.
- Permission denials appear only in the final `result.permission_denials`; they become `approval.resolved` deny events (source `adapter`).
- Closing stdin mid-turn makes the CLI emit `result` `error_during_execution`; `terminate(reason)` marks the turn interrupted first, so a stop or shutdown is `turn.interrupted`, not `turn.failed`.

Fixtures in `fixtures/` are real captured output (sanitised: account and path details removed).
