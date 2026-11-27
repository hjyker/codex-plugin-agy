import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("skills directory exposes exactly the 9 Antigravity slash-command skills", () => {
  const skillDirs = fs.readdirSync(path.join(PLUGIN_ROOT, "skills")).sort();
  assert.deepEqual(skillDirs, [
    "codex-adversarial-review",
    "codex-cancel",
    "codex-read",
    "codex-rescue",
    "codex-result",
    "codex-review",
    "codex-setup",
    "codex-status",
    "codex-transfer"
  ]);
});

test("review and adversarial-review skills stay review-only and use ask_question", () => {
  const review = read("skills/codex-review/SKILL.md");
  assert.match(review, /ask_question/);
  assert.match(review, /review-only/i);
  assert.match(review, /Do \*\*not\*\* fix issues/i);
  assert.match(review, /return Codex's output verbatim to the user/i);
  assert.match(review, /--scope auto\|working-tree\|branch/);
  assert.match(review, /git status --short --untracked-files=all/);
  assert.match(review, /git diff --shortstat/);
  assert.match(review, /\(Recommended\)/);
  assert.match(review, /codex-companion review/);

  const adversarial = read("skills/codex-adversarial-review/SKILL.md");
  assert.match(adversarial, /ask_question/);
  assert.match(adversarial, /review-only/i);
  assert.match(adversarial, /Do \*\*not\*\* fix issues/i);
  assert.match(adversarial, /--effort <low\|medium\|high\|xhigh\|max\|ultra>/);
  assert.match(adversarial, /--service-tier <fast\|flex>/);
  assert.match(adversarial, /codex-companion adversarial-review/);
});

test("rescue skill and rescue subagent support resume, deeplink thread-id, and runtime flags", () => {
  const rescue = read("skills/codex-rescue/SKILL.md");
  const agent = read("agents/codex-rescue.md");

  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /ask_question/);
  assert.match(rescue, /Continue current Codex thread/);
  assert.match(rescue, /Start a new Codex thread/);
  assert.match(rescue, /--resume/);
  assert.match(rescue, /--thread-id/);
  assert.match(rescue, /codex:\/\/threads\/<id>/);
  assert.match(rescue, /--fresh/);
  assert.match(rescue, /--sandbox/);
  assert.match(rescue, /--prompt-file/);

  assert.match(agent, /subagent:\s*true/);
  assert.match(agent, /thin forwarding wrapper/i);
  assert.match(agent, /`run_command`/i);
  assert.match(agent, /Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do any follow-up work of your own/i);
  assert.match(agent, /Do not call `review`, `adversarial-review`, `status`, `result`, or `cancel`/i);
  assert.match(agent, /Leave `--effort` unset unless the user explicitly requests a specific reasoning effort/i);
  assert.match(agent, /Leave `--model` and `--service-tier` unset by default/i);
  assert.match(agent, /If the user asks for a concrete model name such as .*gpt-6\.2-sol.*, pass it through with `--model`/i);
  assert.match(agent, /codex:\/\/threads\/<id>/);
  assert.match(agent, /Return the stdout of the `codex-companion` command exactly as-is/i);
});

test("read, transfer, status, result, cancel, and setup skills match Antigravity contracts", () => {
  const readSkill = read("skills/codex-read/SKILL.md");
  const transfer = read("skills/codex-transfer/SKILL.md");
  const status = read("skills/codex-status/SKILL.md");
  const result = read("skills/codex-result/SKILL.md");
  const cancel = read("skills/codex-cancel/SKILL.md");
  const setup = read("skills/codex-setup/SKILL.md");

  assert.match(readSkill, /codex:\/\/threads\/<thread-id>/);
  assert.match(readSkill, /codex-companion read/);
  assert.match(readSkill, /--limit <n>/);
  assert.match(readSkill, /--all/);
  assert.match(readSkill, /--include-tools/);
  assert.match(readSkill, /--json/);

  assert.match(transfer, /disable-model-invocation:\s*true/);
  assert.match(transfer, /codex-companion transfer --handoff-file/);
  assert.match(transfer, /codex resume <thread-id>/);

  assert.match(status, /disable-model-invocation:\s*true/);
  assert.match(status, /codex-companion/);
  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /codex-companion/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /codex-companion/);

  assert.match(setup, /disable-model-invocation:\s*true/);
  assert.match(setup, /ask_question/);
  assert.match(setup, /curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh/);
  assert.match(setup, /codex login/);
});

test("root hooks.json registers SessionStart and Stop hooks for Antigravity", () => {
  const source = read("hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /Stop/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.equal(fs.existsSync(path.join(ROOT, ".claude-plugin")), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, ".claude-plugin")), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, "commands")), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, "hooks")), false);
});

test("README documents all 9 slash commands and preserves upstream Apache-2.0 attribution", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const readmeCn = fs.readFileSync(path.join(ROOT, "README_CN.md"), "utf8");
  const pluginReadme = read("README.md");

  assert.match(readme, /openai\/codex-plugin-cc/);
  assert.match(readme, /README_CN\.md/);
  assert.match(readme, /curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh/);
  assert.match(readme, /codex login/);
  assert.match(readme, /--model gpt-6\.2-astra --effort high/);
  assert.match(readme, /--effort <low\|medium\|high\|xhigh\|max\|ultra>/);
  assert.doesNotMatch(readme, /gpt-5\.4-mini|gpt-5\.3-codex-spark|<none\|minimal/);
  assert.match(readme, /### `\/codex-setup`/);
  assert.match(readme, /### `\/codex-review`/);
  assert.match(readme, /### `\/codex-adversarial-review`/);
  assert.match(readme, /--base main --effort high --service-tier fast challenge the caching and retry design/);
  assert.match(readme, /### `\/codex-rescue`/);
  assert.match(readme, /### `\/codex-read`/);
  assert.match(readme, /### `\/codex-transfer`/);
  assert.match(readme, /### `\/codex-status` \/ `\/codex-result` \/ `\/codex-cancel`/);
  assert.match(readme, /\/codex-setup --enable-review-gate/);
  assert.match(readme, /\/codex-setup --disable-review-gate/);

  assert.match(readmeCn, /openai\/codex-plugin-cc/);
  assert.match(readmeCn, /### `\/codex-read`/);
  assert.match(pluginReadme, /\/codex-read/);
  assert.match(pluginReadme, /openai\/codex-plugin-cc/);
});
