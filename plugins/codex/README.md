# Codex Companion (`codex-plugin-agy`)

Use OpenAI Codex directly inside **Google Antigravity** (App & CLI) for read-only code reviews, adversarial design challenges, debugging/implementation tasks, read-only thread inspection, and session handoffs.

> **Special Thanks**
> Evolved from OpenAI's open-source [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Apache License 2.0) and maintained as a standalone native Antigravity plugin. Full Apache-2.0 attribution is preserved in `LICENSE` and `NOTICE`.

## Prerequisites

- **Node.js 18.18+**
- **OpenAI Codex CLI** authenticated via ChatGPT subscription or OpenAI API key:
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  codex login
  ```

## Slash Commands

| Command | Purpose |
| :--- | :--- |
| `/codex-review` | Standard read-only code review (native `review/start`) |
| `/codex-adversarial-review` | Challenge review questioning design, tradeoffs, assumptions, and failure modes |
| `/codex-rescue` | Delegate debugging or implementation work to a persistent Codex thread (`--resume`, `--thread-id <id\|deeplink>`, `--sandbox`, `--effort`, `--service-tier`) |
| `/codex-read` | Read a local Codex thread's metadata and history via thread ID or `codex://threads/<id>` deeplink (read-only, zero token cost) |
| `/codex-transfer` | Hand off the current Antigravity session into a persistent Codex thread (`codex resume <id>`) |
| `/codex-status` | Inspect active and recent background Codex jobs |
| `/codex-result` | View stored final output and `codex resume` command for a finished job |
| `/codex-cancel` | Interrupt and cancel an active background Codex job |
| `/codex-setup` | Check local Codex readiness and toggle the optional `Stop` review gate |

## Quick Examples

```text
/codex-setup
/codex-review --base main --background
/codex-adversarial-review --base main --effort high --service-tier fast challenge concurrency and rollback safety
/codex-rescue --model gpt-6.2-astra --effort high diagnose the flaky integration tests
/codex-rescue --thread-id codex://threads/0195a3f0-0000-7000-8000-000000000001 continue the migration
/codex-read codex://threads/0195a3f0-0000-7000-8000-000000000001 --limit 10
/codex-transfer --title auth-race-investigation
```

## Local State & FAQ

- **What is `~/.codex-plugin-agy`?**
  It is this plugin's runtime state and job-cache directory (defaulting via `CODEX_PLUGIN_DATA` → `PLUGIN_DATA` → `~/.codex-plugin-agy`). Per-repository files under `state/<repo>-<hash>/` store `state.json` (review-gate toggle & latest 50 jobs), `jobs/` (outputs & logs), `broker.json` (active shared broker socket/PID), and `session.json` (active Antigravity session metadata). Real Codex conversations live in `~/.codex/`; deleting `~/.codex-plugin-agy` only clears plugin job history/toggles and never affects Codex threads. Set `CODEX_PLUGIN_DATA` to move it elsewhere.
- **Why `/codex-status` instead of `/codex:status`?**
  Antigravity maps slash commands directly to `skills/<name>/SKILL.md` using lowercase kebab-case and does not prepend a colon-separated plugin namespace.
- **Does `/codex-read` spend tokens or modify my thread?**
  No. It calls local read-only `codex app-server` RPCs (`thread/read`, `thread/turns/list`, `thread/items/list`) directly against persisted local history—zero token cost, and it never loads or mutates the thread.

## Configuration

The bundled runtime connects to your local `codex app-server` and automatically inherits `~/.codex/config.toml` and trusted `<repo>/.codex/config.toml`. The shared broker auto-exits after 20 minutes of inactivity (`CODEX_BROKER_IDLE_TIMEOUT_MS`, `0` to disable).
