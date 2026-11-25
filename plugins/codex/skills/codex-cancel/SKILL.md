---
name: codex-cancel
description: Cancel an active background Codex job in this repository. Invoke via /codex-cancel [job-id].
disable-model-invocation: true
---

# Codex Cancel (`/codex-cancel`)

Interrupt and cancel an active background Codex job (defaults to the active job if `job-id` is omitted).

## Steps

1. Run this plugin's bundled `../../scripts/codex-companion` script (resolved from this skill directory to its literal absolute path, e.g. `<plugin-root>/scripts/codex-companion`) with `cancel` (forwarding `[job-id]` if supplied) as a standalone `run_command` (no `$HOME` expansion or shell chaining; retry with `BypassSandbox: true` if sandbox blocks access to `~/.codex-plugin-agy` or the broker socket).
2. Present the cancellation confirmation output to the user verbatim.
