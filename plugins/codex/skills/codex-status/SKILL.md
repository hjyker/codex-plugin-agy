---
name: codex-status
description: Show active and recent Codex jobs for this repository, including review-gate status. Invoke via /codex-status [job-id] [--wait] [--timeout-ms <ms>] [--all].
disable-model-invocation: true
---

# Codex Status (`/codex-status`)

Inspect active and recent Codex background jobs for the current repository.

## Steps

1. Run `codex-companion status` (forwarding `[job-id]`, `--wait`, `--timeout-ms <ms>`, `--all` if supplied) as a standalone `run_command` (retry with `BypassSandbox: true` if sandbox blocks access to `~/.codex-plugin-agy`).

## Output rules

- If the user did **not** pass a job ID:
  - Render the status as a compact Markdown table for active and recent jobs, preserving job ID, kind, status, phase, elapsed/duration, Codex session ID, summary, and follow-up commands (`/codex-status <id>`, `/codex-result <id>`, `/codex-cancel <id>`).
- If the user **did** pass a job ID:
  - Present the full command output verbatim without summarizing or condensing it.
