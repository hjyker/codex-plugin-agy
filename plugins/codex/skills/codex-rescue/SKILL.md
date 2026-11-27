---
name: codex-rescue
description: Delegate investigation, root-cause debugging, explicit fix requests, or follow-up coding work to Codex through the shared companion runtime. Invoke via /codex-rescue [--background|--wait] [--resume|--thread-id <id>|--fresh] [--sandbox read-only|workspace-write|danger-full-access] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <tier>] [task].
---

# Codex Rescue (`/codex-rescue`)

Delegate a debugging, investigation, or implementation task to Codex via `codex-companion task`.

## Execution mode & resume check

1. If the user did not supply a task request (and did not pass `--resume` or `--thread-id`), ask what Codex should investigate or fix.
2. Check routing and runtime flags (do not leak them into the natural-language task prompt):
   - `--background` / `--wait`: Antigravity execution control.
     - **Await automatic wakeup (default / `--wait` or autonomous follow-through)**: invoke foreground `codex-companion task` via `run_command` with `WaitMsBeforeAsync: 500` (or `10000` for quick tasks) and `NotificationTimeoutSeconds: 300`. Every 5 minutes if still running, run `codex-companion status` and post a concise 2-line live progress update; when finished, Antigravity wakes up automatically.
     - **Fire-and-forget detached background (`--background`)**: pass `--background` to `codex-companion task` so the turn returns immediately and the user can inspect via `/codex-status`, `/codex-result`, or `/codex-cancel`.
   - `--model <model>`, `--effort <low|medium|high|xhigh|max|ultra>`, `--service-tier <fast|flex>`: runtime controls; leave unset unless explicitly requested.
   - `--sandbox <read-only|workspace-write|danger-full-access>`: explicit sandbox mode override. If omitted, default to `--write` (`workspace-write`) unless the user explicitly asks for read-only diagnosis/research without edits.
   - `--thread-id <id>`: resume a specific Codex thread ID or `codex://threads/<id>` deeplink directly (takes precedence over `--resume`).
3. Resume detection:
   - If the user explicitly passed `--resume`, `--thread-id <id>`, or `--fresh`, do not ask.
   - Otherwise, run `<plugin-root>/scripts/codex-companion task-resume-candidate --json` (resolved from `../../scripts/codex-companion` relative to this skill directory; retry with `BypassSandbox: true` if needed).
   - If `available: true`, call `ask_question` once with two options:
     - `Continue current Codex thread` vs `Start a new Codex thread`
     - Prefix `(Recommended)` on `Continue current Codex thread` when the user gave a clear follow-up ("continue", "resume", "keep going", "apply the fix", "dig deeper"), otherwise on `Start a new Codex thread`.
   - Add `--resume-last` if continuing, or omit it for a fresh thread.

## Universal Dispatch Guardrails

- **Long prompts via `--prompt-file`**: Whenever a prompt is multi-line, large, or includes pasted specs/logs/quotes, write it to a temporary file and invoke `codex-companion task ... --prompt-file <path>` so shell quoting never breaks and the `codex-companion` command prefix stays cleanly allowlistable.
- **Independent verification after edits**: When acting as an orchestrator over a write-capable Codex run, inspect real `git status` / `git diff` and run the repository's own verification checks before deciding whether to `--resume` / `--thread-id` for rework or accept the result.
- **Rework circuit breaker**: If repeated rework or review rounds exceed 2–3 iterations without convergence—or only subjective tradeoffs remain—pause and present clear options to the user rather than looping indefinitely.

## Invocation

Resolve this plugin's bundled `../../scripts/codex-companion` relative to this skill directory and invoke it by its literal absolute path (no `$HOME` expansion or shell chaining so prefix allowlists stay scoped to this plugin; retry with `BypassSandbox: true` if sandbox blocks `codex`):

```bash
<plugin-root>/scripts/codex-companion task [--background] [--write | --sandbox <mode>] [--resume-last | --thread-id <id>] [--model <model>] [--effort <effort>] [--service-tier <tier>] (--prompt-file <path> | "<prompt>")
```

- If `codex-companion` reports Codex is missing or unauthenticated, stop and tell the user to run `/codex-setup`.

## Output rules

- For direct `/codex-rescue` requests, return the `codex-companion` output verbatim to the user.
- Do not turn a failed or incomplete Codex run into an Antigravity-side substitute implementation; report the failure and stop.
