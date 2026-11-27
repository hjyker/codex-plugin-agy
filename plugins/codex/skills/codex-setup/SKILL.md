---
name: codex-setup
description: Check whether the local Codex CLI is installed and authenticated, and optionally enable or disable the stop-time review gate. Invoke via /codex-setup [--enable-review-gate|--disable-review-gate].
disable-model-invocation: true
---

# Codex Setup (`/codex-setup`)

Check local Codex readiness and optionally toggle the stop-time review gate.

## Steps

1. Run this plugin's bundled `../../scripts/codex-companion` script (resolved from this skill directory to its literal absolute path, e.g. `<plugin-root>/scripts/codex-companion`) with `setup --json` (forwarding `--enable-review-gate` or `--disable-review-gate` if the user passed them) as a standalone `run_command` call (no `&&` chaining or `$HOME` expansion; retry with `BypassSandbox: true` if blocked by sandbox).
2. If the result says Codex is unavailable (`codex.available === false`):
   - Use `ask_question` once with two options:
     - `Install Codex (Recommended)`
     - `Skip for now`
   - If the user chooses install, run the official standalone installer (`curl -fsSL https://chatgpt.com/codex/install.sh | sh` on macOS/Linux, or `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"` on Windows; fall back to `npm install -g @openai/codex` only if requested) and then rerun `<plugin-root>/scripts/codex-companion setup --json` with the original flags.
3. If Codex is already installed, do not ask about installation.

## Output rules

- Present the setup check summary clearly (node, npm, codex, auth, session runtime, review gate status, actions taken, and next steps).
- If Codex is installed but not authenticated, tell the user to run `codex login` in their terminal.
