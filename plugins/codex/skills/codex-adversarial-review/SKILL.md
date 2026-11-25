---
name: codex-adversarial-review
description: Run a steerable, challenge-oriented read-only Codex review that questions design choices, tradeoffs, assumptions, and failure modes. Invoke via /codex-adversarial-review [--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <level>] [--service-tier <tier>] [focus ...].
disable-model-invocation: true
---

# Codex Adversarial Review (`/codex-adversarial-review`)

Run a steerable adversarial Codex review through the shared plugin runtime (`turn/start`). Position it as a challenge review that questions the chosen implementation, design choices, tradeoffs, hidden assumptions, and failure modes under real-world conditions.

## Core constraint

- This skill is **review-only**.
- Do **not** fix issues, apply patches, or suggest that you are about to make changes.
- Return Codex's output verbatim to the user, then stop and ask which findings (if any) the user wants addressed.

## Execution mode rules

- If the user's arguments include `--wait`, do not ask. Run via `run_command` with `WaitMsBeforeAsync: 10000` and `NotificationTimeoutSeconds: 300`.
- If the user's arguments include `--background`, do not ask. Launch with `WaitMsBeforeAsync: 500` and `NotificationTimeoutSeconds: 300`.
- Otherwise, estimate the review size (`git status --short --untracked-files=all`, `git diff --shortstat --cached`, `git diff --shortstat`, or `git diff --shortstat <base>...HEAD` when `--base` is given):
  - Treat untracked files or directories as reviewable work.
  - Recommend waiting only when clearly tiny (1–2 files); otherwise recommend background.
  - Call `ask_question` once with two options (`(Recommended)` prefix on the recommended choice): `Run in background` vs `Wait for results`.

## Argument handling

- Preserve the user's flags (`--wait`, `--background`, `--base <ref>`, `--scope auto|working-tree|branch`, `--model <model>`, `--effort <low|medium|high|xhigh|max|ultra>`, `--service-tier <fast|flex>`) and focus text verbatim.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- Supports working-tree review, branch review, `--base <ref>`, and optional custom focus text after flags. Does not support `--scope staged` or `--scope unstaged`.

## Invocation

Resolve this plugin's bundled `../../scripts/codex-companion` relative to this skill directory and invoke it by its literal absolute path (no `$HOME` expansion or shell chaining so prefix allowlists stay scoped to this plugin; retry with `BypassSandbox: true` if sandbox blocks `codex`):

```bash
<plugin-root>/scripts/codex-companion adversarial-review <user flags and focus text>
```

- **Foreground (`--wait`)**: on a 5-minute heartbeat notification, run `<plugin-root>/scripts/codex-companion status` and post a concise 2-line progress update while continuing to wait. When finished, return stdout verbatim without paraphrasing or auto-fixing.
- **Background (`--background`)**: launch with `WaitMsBeforeAsync: 500` and `NotificationTimeoutSeconds: 300`, then inform the user: "Codex adversarial review started in the background. Check `/codex-status` for progress (you will also be notified automatically when it completes)." End the turn without polling.
