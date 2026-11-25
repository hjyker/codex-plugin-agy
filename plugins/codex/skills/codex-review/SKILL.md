---
name: codex-review
description: Run a read-only Codex code review against local git state (uncommitted changes or branch diff). Invoke via /codex-review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--service-tier <tier>].
disable-model-invocation: true
---

# Codex Review (`/codex-review`)

Run a standard read-only Codex code review through the shared built-in Codex reviewer (`review/start`).

## Core constraint

- This skill is **review-only**.
- Do **not** fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Codex's output verbatim to the user, then stop and wait for user direction.

## Execution mode rules

- If the user's arguments include `--wait`, do not ask. Run via `run_command` and wait for completion (set `NotificationTimeoutSeconds: 300` so long reviews still surface a 5-minute progress heartbeat via `codex-companion status`).
- If the user's arguments include `--background`, do not ask. Run in background mode (`WaitMsBeforeAsync: 500`, `NotificationTimeoutSeconds: 300`).
- Otherwise, estimate the review size before asking:
  - For working-tree review: run `git status --short --untracked-files=all`, `git diff --shortstat --cached`, and `git diff --shortstat`.
  - For base-branch review (`--base <ref>`): run `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant working-tree status or branch diff is actually empty.
  - Recommend waiting only when the review is clearly tiny (roughly 1–2 files total). In every other case, recommend background.
  - When in doubt, run the review instead of declaring nothing to review.
  - Call `ask_question` once with two options, putting the recommended option first with `(Recommended)` prefix:
    - `(Recommended) Run in background` / `Wait for results` (or reversed if tiny).

## Argument handling

- Preserve the user's flags (`--wait`, `--background`, `--base <ref>`, `--scope auto|working-tree|branch`, `--model <model>`, `--service-tier <tier>`) verbatim.
- `/codex-review` maps to Codex's native `review/start` RPC, which does **not** accept custom focus text or per-call `--effort` (effort follows Codex's `config.toml`). If the user wants custom focus instructions or `--effort`, direct them to `/codex-adversarial-review`.

## Invocation

Resolve this plugin's bundled `../../scripts/codex-companion` relative to this skill directory and invoke it by its literal absolute path (no `$HOME` expansion or shell chaining so prefix allowlists stay scoped to this plugin; retry with `BypassSandbox: true` if sandbox blocks `codex`):

```bash
<plugin-root>/scripts/codex-companion review <user flags>
```

- **Foreground (`--wait`)**: set `WaitMsBeforeAsync: 10000` and `NotificationTimeoutSeconds: 300`; on a 5-minute heartbeat notification, run `<plugin-root>/scripts/codex-companion status` and post a concise 2-line progress update while continuing to wait. When finished, return stdout verbatim without paraphrasing or auto-fixing.
- **Background (`--background`)**: launch with `WaitMsBeforeAsync: 500` and `NotificationTimeoutSeconds: 300`, then tell the user: "Codex review started in the background. Check `/codex-status` for progress (you will also be notified automatically when it completes)." End the turn without polling.
