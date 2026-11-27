# Codex Plugin for Antigravity (`codex-plugin-agy`)

English | [简体中文](./README_CN.md)

Use OpenAI Codex directly inside **Google Antigravity** (App & CLI) for read-only code reviews, adversarial reviews, rescue tasks, read-only thread inspection, and session handoffs.

> **Special Thanks**
> This project evolved from OpenAI's open-source [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Apache License 2.0) and is maintained as a standalone native Antigravity plugin. Huge thanks to the OpenAI team for designing the `codex-companion` runtime, `app-server` broker architecture, adversarial review prompts, and test suite. Full Apache-2.0 attribution is preserved in [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

---

## What You Get

Once installed, all 9 slash commands are available across every project in both **Antigravity App** and **Antigravity CLI (`agy`)**:

- **`/codex-review`** — Standard read-only code review (native `review/start`)
- **`/codex-adversarial-review`** — Steerable challenge review questioning design choices, tradeoffs, assumptions, and failure modes
- **`/codex-rescue`** — Delegate debugging, investigation, or implementation tasks to Codex (supports thread resume, `codex://threads/<id>` deeplinks, custom model, reasoning effort, sandbox, and service tier)
- **`/codex-read`** — Read a local Codex thread's metadata and conversation history from a thread ID or `codex://threads/<id>` deeplink via read-only RPC (zero token cost, never modifies the thread)
- **`/codex-transfer`** — Hand off the current Antigravity conversation into a persistent Codex thread and print `codex resume <session-id>`
- **`/codex-status`** — Inspect active and recent background Codex jobs for the current repository
- **`/codex-result`** — View the stored final output and `codex resume` command for a finished job
- **`/codex-cancel`** — Interrupt and cancel an active background Codex job
- **`/codex-setup`** — Check local Codex readiness and toggle the optional `Stop` review gate

---

## Requirements

- **Google Antigravity** (App or CLI)
- **Node.js 18.18 or later**
- **OpenAI Codex CLI** authenticated with a ChatGPT subscription or OpenAI API key:
  ```bash
  # macOS & Linux (official standalone installer; re-run to update)
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  codex login
  ```
  - Windows (PowerShell): `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`
  - Alternatives: `brew install --cask codex` (macOS) or `npm install -g @openai/codex`

---

## Install

This plugin is **100% self-contained** inside `plugins/codex/` (no global binary injected into `~/.local/bin` or `PATH`). Choose either the official Antigravity CLI or the local symlink installer:

### Option 1: Official Antigravity CLI (`agy`, Recommended)

```bash
git clone https://github.com/hjyker/codex-plugin-agy.git
cd codex-plugin-agy

# Validate manifest, hooks, skills, and subagent
agy plugin validate ./plugins/codex

# Install locally into ~/.gemini/config/plugins/
agy plugin install ./plugins/codex
agy plugin list
```

### Option 2: Local Dev Symlink (for Antigravity App without `agy` CLI)

```bash
# Clone into a directory you want to keep (the symlink points to this checkout)
git clone https://github.com/hjyker/codex-plugin-agy.git
cd codex-plugin-agy
./scripts/install-agy.sh
```

This creates a single symlink `~/.gemini/config/plugins/codex-plugin-agy` → `plugins/codex` so edits or `git pull` take effect immediately without modifying global `PATH`.

Then verify everything inside Antigravity:

```text
/codex-setup
```

When Antigravity first asks for non-sandboxed execution permission for `<plugin-root>/scripts/codex-companion` (needed to spawn local `codex` and reach OpenAI), choose **Always Allow** for that script prefix so all future runs work smoothly across every workspace.

---

## Usage

### `/codex-review`

Run a read-only code review on uncommitted changes or against a base branch. Never edits code.

- Flags: `[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--service-tier <fast|flex>]`
- Uses Codex's native `review/start` RPC, which does not accept custom focus text or per-call `--effort` (effort follows your Codex `config.toml`). Use `/codex-adversarial-review` when you want custom focus instructions or `--effort`.

```text
/codex-review
/codex-review --base main --wait
/codex-review --background --service-tier fast
```

### `/codex-adversarial-review`

Run a steerable, skeptical read-only review that stress-tests assumptions, edge cases, race conditions, data loss, and rollback risks. Returns structured findings and never auto-fixes.

- Flags: `[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <fast|flex>] [focus ...]`

```text
/codex-adversarial-review
/codex-adversarial-review --base main --effort high --service-tier fast challenge the caching and retry design
/codex-adversarial-review --background focus on concurrency and rollback safety
```

### `/codex-rescue`

Delegate debugging, root-cause analysis, or implementation work to Codex via a persistent thread.

- Flags: `[--background|--wait] [--resume|--thread-id <id|codex://threads/<id>>|--fresh] [--sandbox read-only|workspace-write|danger-full-access] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <fast|flex>] [task]`
- Defaults to `workspace-write`; pass `--sandbox read-only` for diagnosis-only runs or `--sandbox danger-full-access` when container/host tools are required.
- `--resume` continues the latest task thread in the current repo; `--thread-id` accepts either a raw thread ID or a `codex://threads/<id>` deeplink; `--fresh` forces a new thread.
- Leave `--model` and `--effort` unset to use your Codex defaults, or pass any model available in your Codex CLI (for example `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-terra`, or `gpt-6-luna`; availability and supported reasoning levels depend on your account and model).

```text
/codex-rescue investigate why the integration tests are flaky
/codex-rescue --resume apply the top fix and add a regression test
/codex-rescue --thread-id codex://threads/0195a3f0-0000-7000-8000-000000000001 --service-tier fast finish the remaining migration
/codex-rescue --model gpt-6.2-astra --effort high diagnose the build failure
/codex-rescue --background refactor the auth middleware
```

### `/codex-read`

Inspect a local Codex conversation thread (metadata and turn history) in **read-only mode** via native `codex app-server` RPCs (`thread/read`, `thread/turns/list`, and `thread/items/list`, with automatic fallback to `thread/read({ includeTurns: true })` for legacy threads). Consumes zero tokens and never loads or mutates the thread.

- Flags: `<thread-id | codex://threads/<id>> [--limit <n>] [--all] [--include-tools] [--json]`
- Defaults to showing thread metadata + the latest 10 turns (`--limit 10`) of user questions and Codex answers.
- Also works naturally when you paste a `codex://threads/<id>` deeplink in chat and ask Antigravity to analyze that conversation.

```text
/codex-read codex://threads/0195a3f0-0000-7000-8000-000000000001
/codex-read 0195a3f0-0000-7000-8000-000000000001 --limit 5 --include-tools
/codex-read codex://threads/0195a3f0-0000-7000-8000-000000000001 --all --json
```

### `/codex-transfer`

Package the current Antigravity session context into a persistent Codex thread (read-only handoff turn) and print `codex resume <session-id>` so you can continue directly in Codex CLI or Codex App.

- Flags: `[--title <name>] [--model <model>]`

```text
/codex-transfer
/codex-transfer --title payment-idempotency-debug
```

### `/codex-status` / `/codex-result` / `/codex-cancel`

Manage background Codex jobs:

```text
/codex-status                  # Compact table of active and recent jobs
/codex-status <job-id>         # Full progress & log path for a single job
/codex-result [job-id]         # Stored final output + codex resume command
/codex-cancel [job-id]         # Send turn/interrupt and stop an active job
```

### `/codex-setup`

Verify `node`, `npm`, `codex`, auth status, and optionally toggle the `Stop` review gate:

```text
/codex-setup
/codex-setup --enable-review-gate
/codex-setup --disable-review-gate
```

> **Note**: When the review gate is enabled, Antigravity's `Stop` hook triggers a read-only Codex review after code-editing turns and returns `decision: "continue"` if blocking issues are found (with `continuationActive` loop protection). Only enable it when actively monitoring a session.

---

## Architecture Highlights

1. **Pure Antigravity native plugin layout**: Root `plugins/codex/plugin.json` (with `suggestedPrompts`), root `plugins/codex/hooks.json`, 9 `/codex-*` skills (`skills/codex-*/SKILL.md`), and `agents/codex-rescue.md`.
2. **Unified persistent state**: Uses `CODEX_PLUGIN_DATA` (default `~/.codex-plugin-agy`, or Antigravity's `PLUGIN_DATA`) so hooks, `run_command`, and terminal runs share the same job and session state.
3. **Automatic broker idle shutdown**: `app-server-broker.mjs` gracefully shuts down after 20 minutes of inactivity (`CODEX_BROKER_IDLE_TIMEOUT_MS`, `0` to disable), plus a manual `codex-companion broker-stop` command.
4. **Antigravity hook contract**: `SessionStart` and `Stop` hooks natively consume Antigravity `camelCase` payloads (`conversationId`, `transcriptPath`, `terminationReason`, `continuationActive`) and emit `{"decision": "continue"}` / `{}` responses.
5. **Read-only thread inspection & universal runtime controls**: Supports `/codex-read` (`codex://threads/<id>` deeplink parsing + zero-token paginated/legacy RPC reading), `--sandbox`, `--effort max|ultra`, `--service-tier`, `--thread-id`, `adversarial-review --effort`, Antigravity session `transfer` handoff, 5-minute progress heartbeats, and dispatch guardrails.

---

## Local State & FAQ

### What is `~/.codex-plugin-agy`?

`~/.codex-plugin-agy` is the plugin's **runtime state and job-cache directory** (not the plugin install directory and not added to `PATH`). By default, both the bundled `codex-companion` script and `hooks.json` resolve the data root in order: `CODEX_PLUGIN_DATA` → `PLUGIN_DATA` → `~/.codex-plugin-agy`.

Inside `~/.codex-plugin-agy/state/<repo>-<hash>/`, the plugin stores per-repository runtime files:
- `state.json`: `stopReviewGate` toggle state and an index of the latest 50 jobs (for `/codex-status`, `/codex-result`, `/codex-cancel`, and `--resume`).
- `jobs/`: stored outputs (`.json`) and progress logs (`.log`) for tracked jobs (older artifacts beyond 50 jobs are pruned automatically).
- `broker.json`: active shared `codex app-server` broker socket and PID (cleaned up automatically after 20 minutes of idle shutdown).
- `session.json`: latest Antigravity conversation ID and transcript path recorded by `SessionStart` (used by `/codex-transfer`).

**Notes:**
- **Not your Codex chat history**: Real Codex threads live in `~/.codex/` (managed by Codex CLI/App). Deleting `~/.codex-plugin-agy` only resets local job history and review-gate toggles without affecting any Codex threads.
- **Comparison with `codex-plugin-cc`**: The original `codex-plugin-cc` uses the exact same per-repo `state/` mechanism, except Claude Code injects `CLAUDE_PLUGIN_DATA` under `~/.claude/plugins/data/`. Because Antigravity's `run_command` does not automatically inject a plugin data directory, `codex-plugin-agy` defaults to `~/.codex-plugin-agy` so hooks, tool calls, and manual terminal runs always share one state location.
- **Custom location**: Set `CODEX_PLUGIN_DATA` in your shell profile if you prefer another path (for example `export CODEX_PLUGIN_DATA="$HOME/.gemini/plugin-data/codex-plugin-agy"` or `"$HOME/.cache/codex-plugin-agy"`).

### Why `/codex-status` instead of `/codex:status`?

Antigravity maps slash commands directly to `skills/<name>/SKILL.md` (`name` uses lowercase kebab-case) and does not prepend a colon-separated plugin namespace. All 9 commands therefore use the `/codex-*` prefix.

### Does `/codex-read` consume tokens or modify my Codex thread?

No. `/codex-read` uses local read-only `codex app-server` RPCs (`thread/read`, `thread/turns/list`, `thread/items/list`) to inspect persisted thread metadata and history directly from local storage without starting a turn, resuming the thread, or spending model tokens.

---

## Configuration & Development

The plugin delegates to your local `codex app-server` and automatically inherits your Codex authentication and configuration:
- User config: `~/.codex/config.toml`
- Project overrides: `<repo>/.codex/config.toml` (when trusted)

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `CODEX_PLUGIN_DATA` | `~/.codex-plugin-agy` | Root directory for plugin state, job records, and logs |
| `CODEX_BROKER_IDLE_TIMEOUT_MS` | `1200000` (20 min) | Idle timeout in ms before shared broker exits (`0` disables) |

### Run Tests & Version Check

```bash
node --test tests/*.test.mjs
npm run check-version
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Derived from [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc).
