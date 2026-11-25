---
name: codex-cancel
description: Cancel an active background Codex job in this repository. Invoke via /codex-cancel [job-id].
disable-model-invocation: true
---

# Codex Cancel (`/codex-cancel`)

Interrupt and cancel an active background Codex job (defaults to the active job if `job-id` is omitted).

## Steps

1. Run `codex-companion cancel` (forwarding `[job-id]` if supplied) as a standalone `run_command` (retry with `BypassSandbox: true` if sandbox blocks access to `~/.codex-plugin-agy` or the broker socket).
2. Present the cancellation confirmation output to the user verbatim.
