---
name: codex-transfer
description: Transfer the current Antigravity session context into a persistent, resumable Codex thread and print a `codex resume <session-id>` command. Invoke via /codex-transfer [--title <name>] [--model <model>].
disable-model-invocation: true
---

# Codex Transfer (`/codex-transfer`)

Create a persistent Codex thread preloaded with the current Antigravity session context so the user can seamlessly continue the conversation in Codex CLI or Codex App via `codex resume <session-id>`.

## Steps

Resolve this plugin's bundled `../../scripts/codex-companion` relative to this skill directory and invoke it by its literal absolute path (no `$HOME` expansion or shell chaining).

1. Synthesize a crisp, structured handoff summary of the current Antigravity conversation (goal, key decisions, modified/relevant file paths, verification status, and immediate next steps) and write it to a temporary file (e.g., `/tmp/codex-transfer-handoff.md`).
2. Run `<plugin-root>/scripts/codex-companion transfer` as a standalone `run_command` (retry with `BypassSandbox: true` if sandbox blocks `codex`):
   ```bash
   <plugin-root>/scripts/codex-companion transfer --handoff-file /tmp/codex-transfer-handoff.md [--title "<short title>"] [--model <model>]
   ```
3. Clean up the temporary file afterwards if desired.

## Output rules

- Present the command output clearly, always preserving:
  - `Codex session ID: <thread-id>`
  - `Resume in Codex: codex resume <thread-id>`
  - Codex's brief handoff acknowledgment.
