---
name: codex-setup
description: Check whether the local Codex CLI is installed and authenticated, and optionally enable or disable the stop-time review gate. Invoke via /codex-setup [--enable-review-gate|--disable-review-gate].
disable-model-invocation: true
---

# Codex Setup (`/codex-setup`)

Check local Codex readiness and optionally toggle the stop-time review gate.

## Steps

1. Run `codex-companion setup --json` (forwarding `--enable-review-gate` or `--disable-review-gate` if the user passed them) as a standalone `run_command` call (no `&&` chaining; retry with `BypassSandbox: true` if blocked by sandbox).
2. If the result says Codex is unavailable (`codex.available === false`) and npm is available (`npm.available === true`):
   - Use `ask_question` once with two options:
     - `Install Codex (Recommended)`
     - `Skip for now`
   - If the user chooses install, run `npm install -g @openai/codex` and then rerun `codex-companion setup --json` with the original flags.
3. If Codex is already installed or npm is unavailable, do not ask about installation.

## Output rules

- Present the setup check summary clearly (node, npm, codex, auth, session runtime, review gate status, actions taken, and next steps).
- If Codex is installed but not authenticated, tell the user to run `codex login` in their terminal.
- Replace any `/codex:` hints with `/codex-` (e.g., `/codex-setup --enable-review-gate`).
