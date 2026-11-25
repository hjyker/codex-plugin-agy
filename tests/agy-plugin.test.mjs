import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { ensureBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { loadActiveSession, resolveStateDir, saveActiveSession, setConfig } from "../plugins/codex/scripts/lib/state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "codex-companion.mjs");
const SESSION_HOOK = path.join(PLUGIN_ROOT, "scripts", "session-lifecycle-hook.mjs");
const STOP_HOOK = path.join(PLUGIN_ROOT, "scripts", "stop-review-gate-hook.mjs");

const ALLOWED_PLUGIN_JSON_KEYS = new Set([
  "name",
  "displayName",
  "description",
  "version",
  "logo",
  "suggestedPrompts",
  "author",
  "homepage",
  "repository",
  "disabled"
]);

test("AGY plugin.json uses only allowlisted top-level fields and root hooks.json follows AGY schema", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "codex-plugin-agy");
  assert.ok(manifest.description);
  assert.ok(Array.isArray(manifest.suggestedPrompts) && manifest.suggestedPrompts.length <= 3);
  for (const key of Object.keys(manifest)) {
    assert.equal(ALLOWED_PLUGIN_JSON_KEYS.has(key), true, `Unexpected plugin.json field: ${key}`);
  }

  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks.json"), "utf8"));
  assert.ok(hooks["codex-companion"], "Root hooks.json must wrap hooks under a named key");
  assert.ok(Array.isArray(hooks["codex-companion"].SessionStart));
  assert.ok(Array.isArray(hooks["codex-companion"].Stop));
  assert.equal(hooks["codex-companion"].SessionStart[0].type, "command");
  assert.equal(hooks["codex-companion"].Stop[0].type, "command");
  assert.doesNotMatch(JSON.stringify(hooks), /CLAUDE_PLUGIN_ROOT/);
});

test("all 8 AGY slash-command skills and rescue agent follow Antigravity conventions", () => {
  const expectedSkills = [
    "codex-setup",
    "codex-review",
    "codex-adversarial-review",
    "codex-rescue",
    "codex-transfer",
    "codex-status",
    "codex-result",
    "codex-cancel"
  ];

  for (const skill of expectedSkills) {
    const file = path.join(PLUGIN_ROOT, "skills", skill, "SKILL.md");
    assert.equal(fs.existsSync(file), true, `Missing skill ${skill}`);
    const content = fs.readFileSync(file, "utf8");
    assert.match(content, new RegExp(`^name:\\s*${skill}$`, "m"));
    assert.match(content, /codex-companion/);
    assert.doesNotMatch(content, /CLAUDE_PLUGIN_ROOT/);
    assert.doesNotMatch(content, /AskUserQuestion/);
  }

  const agent = fs.readFileSync(path.join(PLUGIN_ROOT, "agents", "codex-rescue.md"), "utf8");
  assert.match(agent, /^subagent:\s*true$/m);
  assert.match(agent, /run_command/);
  assert.doesNotMatch(agent, /^model:\s*sonnet$/m);
});

test("resolveStateDir honors CODEX_PLUGIN_DATA and PLUGIN_DATA and persists active session", () => {
  const workspace = makeTempDir();
  const codexDataDir = makeTempDir();
  const prevCodex = process.env.CODEX_PLUGIN_DATA;
  const prevClaude = process.env.CLAUDE_PLUGIN_DATA;
  const prevPlugin = process.env.PLUGIN_DATA;

  try {
    delete process.env.CLAUDE_PLUGIN_DATA;
    delete process.env.PLUGIN_DATA;
    process.env.CODEX_PLUGIN_DATA = codexDataDir;

    const dir = resolveStateDir(workspace);
    assert.equal(dir.startsWith(path.join(codexDataDir, "state")), true);

    saveActiveSession(workspace, {
      sessionId: "conv-agy-1",
      transcriptPath: "/tmp/transcript.jsonl"
    });
    const loaded = loadActiveSession(workspace);
    assert.equal(loaded.sessionId, "conv-agy-1");
    assert.equal(loaded.transcriptPath, "/tmp/transcript.jsonl");
  } finally {
    if (prevCodex == null) delete process.env.CODEX_PLUGIN_DATA;
    else process.env.CODEX_PLUGIN_DATA = prevCodex;
    if (prevClaude == null) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prevClaude;
    if (prevPlugin == null) delete process.env.PLUGIN_DATA;
    else process.env.PLUGIN_DATA = prevPlugin;
  }
});

test("task supports --sandbox danger-full-access and --effort max/ultra", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const result = run(
    "node",
    [SCRIPT, "task", "--sandbox", "danger-full-access", "--effort", "max", "--json", "verify sandbox and max effort"],
    {
      cwd: repo,
      env: buildEnv(binDir)
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sandbox, "danger-full-access");
  assert.equal(payload.status, 0);

  const fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.equal(fakeState.threads[0].sandbox, "danger-full-access");
  assert.equal(fakeState.lastTurnStart.effort, "max");
});

test("transfer creates a persistent handoff thread from --handoff-file or saved AGY transcript", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const dataDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const handoffPath = path.join(repo, "handoff.md");
  fs.writeFileSync(handoffPath, "Goal: finish AGY port.\nNext step: verify live plugin.\n", "utf8");

  const result = run(
    "node",
    [SCRIPT, "transfer", "--handoff-file", handoffPath, "--title", "AGY Port", "--json"],
    {
      cwd: repo,
      env: { ...buildEnv(binDir), CODEX_PLUGIN_DATA: dataDir }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "handoff");
  assert.ok(payload.threadId);
  assert.equal(payload.resumeCommand, `codex resume ${payload.threadId}`);

  // Also test auto-loading AGY transcript saved by SessionStart hook.
  const transcriptPath = path.join(dataDir, "transcript.jsonl");
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "USER_INPUT", content: "<USER_REQUEST>\nFix bug X\n</USER_REQUEST>" }),
      JSON.stringify({ type: "PLANNER_RESPONSE", content: "Located root cause in foo.js." })
    ].join("\n") + "\n",
    "utf8"
  );

  const hookResult = run("node", [SESSION_HOOK, "SessionStart"], {
    cwd: repo,
    env: { ...buildEnv(binDir), CODEX_PLUGIN_DATA: dataDir },
    input: JSON.stringify({
      conversationId: "conv-agy-handoff",
      hookEventName: "SessionStart",
      transcriptPath,
      cwd: repo,
      workspacePaths: [repo]
    })
  });
  assert.equal(hookResult.status, 0, hookResult.stderr);
  assert.deepEqual(JSON.parse(hookResult.stdout), {});

  const autoTransfer = run("node", [SCRIPT, "transfer", "--json"], {
    cwd: repo,
    env: { ...buildEnv(binDir), CODEX_PLUGIN_DATA: dataDir }
  });
  assert.equal(autoTransfer.status, 0, autoTransfer.stderr);
  const autoPayload = JSON.parse(autoTransfer.stdout);
  assert.equal(autoPayload.mode, "handoff");
  assert.equal(autoPayload.sessionId, "conv-agy-handoff");
  assert.ok(autoPayload.threadId);
});

test("AGY Stop hook emits decision=continue on review findings and respects continuationActive", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const dataDir = makeTempDir();
  installFakeCodex(binDir, "stop-gate-block");
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "app.js"), "export const x = 1;\n");
  run("git", ["add", "app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const env = { ...buildEnv(binDir), CODEX_PLUGIN_DATA: dataDir };
  const setupRes = run("node", [SCRIPT, "setup", "--enable-review-gate", "--json"], { cwd: repo, env });
  assert.equal(setupRes.status, 0, setupRes.stderr);

  const transcriptPath = path.join(dataDir, "transcript.jsonl");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({ type: "PLANNER_RESPONSE", content: "Updated app.js with new logic." })}\n`,
    "utf8"
  );

  const blocked = run("node", [STOP_HOOK], {
    cwd: repo,
    env,
    input: JSON.stringify({
      conversationId: "conv-agy-stop",
      hookEventName: "Stop",
      cwd: repo,
      transcriptPath,
      terminationReason: "NO_TOOL_CALL",
      continuationActive: false
    })
  });
  assert.equal(blocked.status, 0, blocked.stderr);
  const blockedDecision = JSON.parse(blocked.stdout);
  assert.equal(blockedDecision.decision, "continue");
  assert.match(blockedDecision.reason, /stop-time review found issues/i);

  // When continuationActive is true, Stop hook must allow stop to prevent infinite loops.
  const loopGuard = run("node", [STOP_HOOK], {
    cwd: repo,
    env,
    input: JSON.stringify({
      conversationId: "conv-agy-stop",
      hookEventName: "Stop",
      cwd: repo,
      transcriptPath,
      terminationReason: "NO_TOOL_CALL",
      continuationActive: true
    })
  });
  assert.equal(loopGuard.status, 0, loopGuard.stderr);
  assert.deepEqual(JSON.parse(loopGuard.stdout), {});
});

test("broker exits automatically after CODEX_BROKER_IDLE_TIMEOUT_MS when idle", async () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  const dataDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);

  const env = {
    ...buildEnv(binDir),
    CODEX_PLUGIN_DATA: dataDir,
    CODEX_BROKER_IDLE_TIMEOUT_MS: "250"
  };
  const session = await ensureBrokerSession(repo, { env, timeoutMs: 3000 });
  assert.ok(session && session.pid);

  // Wait for broker to exit due to idle timeout.
  const deadline = Date.now() + 4000;
  let exited = false;
  while (Date.now() < deadline) {
    try {
      process.kill(session.pid, 0);
    } catch {
      exited = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(exited, true, "Broker should auto-exit after idle timeout");
  assert.equal(fs.existsSync(session.pidFile), false, "Broker should remove pidFile on idle shutdown");
});

test("task supports explicit --thread-id and --service-tier forwarding", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n");
  run("git", ["add", "README.md"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });

  const first = run("node", [SCRIPT, "task", "--service-tier", "fast", "--json", "first turn"], {
    cwd: repo,
    env: buildEnv(binDir)
  });
  assert.equal(first.status, 0, first.stderr);
  const firstPayload = JSON.parse(first.stdout);

  const second = run(
    "node",
    [SCRIPT, "task", "--thread-id", firstPayload.threadId, "--service-tier", "fast", "--json", "follow up on exact thread"],
    {
      cwd: repo,
      env: buildEnv(binDir)
    }
  );
  assert.equal(second.status, 0, second.stderr);
  const secondPayload = JSON.parse(second.stdout);
  assert.equal(secondPayload.threadId, firstPayload.threadId);

  const fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.equal(fakeState.lastThreadResume.threadId, firstPayload.threadId);
  assert.equal(fakeState.lastThreadResume.serviceTier, "fast");
  assert.equal(fakeState.lastTurnStart.serviceTier, "fast");
});

test("adversarial-review forwards --effort and --service-tier while native review forwards --service-tier only", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  initGitRepo(repo);
  fs.writeFileSync(path.join(repo, "app.js"), "export const v = 1;\n");
  run("git", ["add", "app.js"], { cwd: repo });
  run("git", ["commit", "-m", "init"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "app.js"), "export const v = 2;\n");

  const adv = run(
    "node",
    [SCRIPT, "adversarial-review", "--effort", "high", "--service-tier", "fast", "--json", "check edge cases"],
    {
      cwd: repo,
      env: buildEnv(binDir)
    }
  );
  assert.equal(adv.status, 0, adv.stderr);
  let fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.equal(fakeState.lastTurnStart.effort, "high");
  assert.equal(fakeState.lastTurnStart.serviceTier, "fast");

  const nativeReview = run(
    "node",
    [SCRIPT, "review", "--service-tier", "fast", "--json"],
    {
      cwd: repo,
      env: buildEnv(binDir)
    }
  );
  assert.equal(nativeReview.status, 0, nativeReview.stderr);
  fakeState = JSON.parse(fs.readFileSync(path.join(binDir, "fake-codex-state.json"), "utf8"));
  assert.equal(fakeState.threads[0].serviceTier, "fast");

  const rejectedEffort = run(
    "node",
    [SCRIPT, "review", "--effort", "high"],
    {
      cwd: repo,
      env: buildEnv(binDir)
    }
  );
  assert.notEqual(rejectedEffort.status, 0);
});

