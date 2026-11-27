---
name: codex-read
description: Read a local Codex conversation thread (metadata and turn history) from a thread ID or codex://threads/<id> deeplink via read-only app-server RPC without spending tokens or modifying the thread. Invoke via /codex-read <thread-id | codex://threads/<id>> [--limit <n>] [--all] [--include-tools] [--json].
---

# Codex Read (`/codex-read`)

Inspect a local Codex thread's metadata and conversation turns in **read-only mode** (zero token cost; does not modify or resume the original thread).

## Input handling

- Accepts either a raw Codex thread ID (UUID) or a Codex App deeplink (`codex://threads/<thread-id>`).
- Supported flags:
  - `--limit <n>`: show the most recent `<n>` turns (default: `10`).
  - `--all`: show all turns in the thread.
  - `--include-tools`: include tool executions, file changes, reasoning summaries, and intermediate commentary alongside user questions and Codex replies.
  - `--json`: output structured JSON instead of formatted Markdown.
- If the user did not provide a thread ID or deeplink, ask which Codex thread they want to read.

## Invocation

Resolve this plugin's bundled `../../scripts/codex-companion` relative to this skill directory and invoke it by its literal absolute path (no `$HOME` expansion or shell chaining so prefix allowlists stay scoped to this plugin; retry with `BypassSandbox: true` if sandbox blocks local `codex` or `~/.codex` access):

```bash
<plugin-root>/scripts/codex-companion read <thread-id-or-deeplink> [--limit <n>] [--all] [--include-tools] [--json]
```

## Output rules

- If the user invoked `/codex-read` directly to inspect a thread, present the returned thread metadata and turns clearly, preserving the Thread ID, deeplink (`codex://threads/<id>`), and `codex resume <id>` command.
- If the user asked a specific question about a Codex thread (e.g., "what did we decide in `codex://threads/...`?"), ground your answer strictly in the fetched conversation history.
- Never resume, modify, or send new turns to the thread as part of `/codex-read`. If the user wants to continue working on that thread, suggest `/codex-rescue --thread-id <id>` or `codex resume <id>`.
