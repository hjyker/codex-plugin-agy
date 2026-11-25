---
name: codex-result
description: Show the stored final output and Codex session ID for a finished Codex job in this repository. Invoke via /codex-result [job-id].
disable-model-invocation: true
---

# Codex Result (`/codex-result`)

Display the stored final output for a finished Codex job (latest finished job if `job-id` is omitted).

## Steps

1. Run `codex-companion result` (forwarding `[job-id]` if supplied) as a standalone `run_command` (retry with `BypassSandbox: true` if sandbox blocks access to `~/.codex-plugin-agy`).

## Output rules

- Present the full command output verbatim. Do not summarize or condense it.
- Preserve all details including job ID, status, verdict, summary, findings, file paths and line numbers, error messages, Codex session ID, and `codex resume <session-id>`.
- If the result is a review, **STOP** after presenting findings—do not auto-apply fixes unless the user explicitly asks.
