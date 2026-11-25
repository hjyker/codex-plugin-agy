# Codex Plugin for Antigravity (`codex-plugin-agy`)

English | [简体中文](./README_CN.md)

Use OpenAI Codex directly inside **Google Antigravity** (App & CLI) for read-only code reviews, adversarial reviews, rescue tasks, and session handoffs.

> **Upstream Credit & Attribution**
> This project is an Antigravity port of OpenAI's official open-source plugin [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Apache License 2.0). Huge thanks to the OpenAI team for designing the `codex-companion` runtime, `app-server` broker architecture, adversarial review prompts, and test suite. We keep upstream-compatible structure and Apache-2.0 attribution ([LICENSE](./LICENSE), [NOTICE](./NOTICE)) so upstream improvements can be merged cleanly.

---

## What You Get

Once installed, all 8 slash commands are available across every project in both **Antigravity App** and **Antigravity CLI (`agy`)**:

- **`/codex-review`** — Standard read-only code review (native `review/start`)
- **`/codex-adversarial-review`** — Steerable challenge review questioning design choices, tradeoffs, assumptions, and failure modes
- **`/codex-rescue`** — Delegate debugging, investigation, or implementation tasks to Codex (supports thread resume, custom model, reasoning effort, sandbox, and service tier)
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
git clone https://github.com/hjyker/codex-plugin-agy.git /opt/life/codex-plugin-agy
cd /opt/life/codex-plugin-agy
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

- Flags: `[--background|--wait] [--resume|--thread-id <id>|--fresh] [--sandbox read-only|workspace-write|danger-full-access] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <fast|flex>] [task]`
- Defaults to `workspace-write`; pass `--sandbox read-only` for diagnosis-only runs or `--sandbox danger-full-access` when container/host tools are required.
- `--resume` continues the latest task thread in the current repo; `--thread-id <id>` targets an exact thread; `--fresh` forces a new thread.
- Leave `--model` and `--effort` unset to use your Codex defaults, or pass any model available in your Codex CLI (for example `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-terra`, or `gpt-6-luna`; availability and supported reasoning levels depend on your account and model).

```text
/codex-rescue investigate why the integration tests are flaky
/codex-rescue --resume apply the top fix and add a regression test
/codex-rescue --thread-id thr_xxx --service-tier fast finish the remaining migration
/codex-rescue --model gpt-6.2-astra --effort high diagnose the build failure
/codex-rescue --background refactor the auth middleware
```

### `/codex-transfer`

Package the current Antigravity session context into a persistent Codex thread (read-only handoff turn) and print `codex resume <session-id>` so you can continue directly in Codex CLI or Codex App.

- Flags: `[--title <name>] [--model <model>] [--source <claude-jsonl>]`
- Also preserves upstream `--source ~/.claude/projects/.../*.jsonl` native import compatibility.

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

## Key Antigravity Adaptations

Compared to upstream `openai/codex-plugin-cc`:
1. **Native Antigravity plugin layout**: Root `plugins/codex/plugin.json` (with `suggestedPrompts`), root `plugins/codex/hooks.json`, 8 `/codex-*` skills (`skills/codex-*/SKILL.md`), and adapted `agents/codex-rescue.md`.
2. **Unified state without `CLAUDE_ENV_FILE`**: Uses `CODEX_PLUGIN_DATA` (default `~/.codex-plugin-agy`) so hooks, `run_command`, and terminal runs always read/write the same job and session state.
3. **Automatic broker idle shutdown**: Since Antigravity has no `SessionEnd` event, `app-server-broker.mjs` gracefully shuts down after 20 minutes of inactivity (`CODEX_BROKER_IDLE_TIMEOUT_MS`, `0` to disable), plus a manual `codex-companion broker-stop` command.
4. **Antigravity hook contract**: `SessionStart` and `Stop` hooks support Antigravity's `camelCase` payloads (`conversationId`, `transcriptPath`, `terminationReason`, `continuationActive`) and `{"decision": "continue"}` responses.
5. **Universal runtime controls**: Adds `--sandbox`, `--effort max|ultra`, `--service-tier`, `--thread-id`, `adversarial-review --effort`, Antigravity session `transfer` handoff, 5-minute long-task progress heartbeats, and universal dispatch guardrails.

---

## Configuration & Development

The plugin delegates to your local `codex app-server` and automatically inherits your Codex authentication and configuration:
- User config: `~/.codex/config.toml`
- Project overrides: `<repo>/.codex/config.toml` (when trusted)

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `CODEX_PLUGIN_DATA` | `~/.codex-plugin-agy` | Root directory for plugin state, job records, and logs |
| `CODEX_BROKER_IDLE_TIMEOUT_MS` | `1200000` (20 min) | Idle timeout in ms before shared broker exits (`0` disables) |

### Run Tests & Typecheck

```bash
node --test tests/*.test.mjs
```

### Sync with Upstream (`openai/codex-plugin-cc`)

```bash
git fetch upstream
git merge upstream/main
node --test tests/*.test.mjs
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Derived from [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc).
