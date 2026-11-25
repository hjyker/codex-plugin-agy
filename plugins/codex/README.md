# Codex Companion (`codex-plugin-agy`)

Use OpenAI Codex directly inside **Google Antigravity** (App & CLI) for read-only code reviews, adversarial design challenges, debugging/implementation tasks, and session handoffs.

> Antigravity port of OpenAI's [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (Apache License 2.0).

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
| `/codex-rescue` | Delegate investigation, debugging, or implementation work to a persistent Codex thread |
| `/codex-transfer` | Hand off the current Antigravity session into a Codex thread (`codex resume <id>`) |
| `/codex-status` | Inspect active and recent background Codex jobs |
| `/codex-result` | View stored final output and resume command for a finished job |
| `/codex-cancel` | Interrupt and cancel an active background Codex job |
| `/codex-setup` | Check local Codex readiness and toggle the optional `Stop` review gate |

## Quick Examples

```text
/codex-setup
/codex-review --base main --background
/codex-adversarial-review --base main --effort high --service-tier fast challenge concurrency and rollback safety
/codex-rescue --model gpt-6.2-astra --effort high diagnose the flaky integration tests
/codex-transfer --title auth-race-investigation
```

## Configuration

The bundled runtime connects to your local `codex app-server` and automatically inherits `~/.codex/config.toml` and trusted `<repo>/.codex/config.toml`. Plugin state defaults to `~/.codex-plugin-agy` (override via `CODEX_PLUGIN_DATA`), and the shared broker auto-exits after 20 minutes of inactivity (`CODEX_BROKER_IDLE_TIMEOUT_MS`).
