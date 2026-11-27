function severityRank(severity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function formatLineRange(finding) {
  if (!finding.line_start) {
    return "";
  }
  if (!finding.line_end || finding.line_end === finding.line_start) {
    return `:${finding.line_start}`;
  }
  return `:${finding.line_start}-${finding.line_end}`;
}

function validateReviewResultShape(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "Expected a top-level JSON object.";
  }
  if (typeof data.verdict !== "string" || !data.verdict.trim()) {
    return "Missing string `verdict`.";
  }
  if (typeof data.summary !== "string" || !data.summary.trim()) {
    return "Missing string `summary`.";
  }
  if (!Array.isArray(data.findings)) {
    return "Missing array `findings`.";
  }
  if (!Array.isArray(data.next_steps)) {
    return "Missing array `next_steps`.";
  }
  return null;
}

function normalizeReviewFinding(finding, index) {
  const source = finding && typeof finding === "object" && !Array.isArray(finding) ? finding : {};
  const lineStart = Number.isInteger(source.line_start) && source.line_start > 0 ? source.line_start : null;
  const lineEnd =
    Number.isInteger(source.line_end) && source.line_end > 0 && (!lineStart || source.line_end >= lineStart)
      ? source.line_end
      : lineStart;

  return {
    severity: typeof source.severity === "string" && source.severity.trim() ? source.severity.trim() : "low",
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : `Finding ${index + 1}`,
    body: typeof source.body === "string" && source.body.trim() ? source.body.trim() : "No details provided.",
    file: typeof source.file === "string" && source.file.trim() ? source.file.trim() : "unknown",
    line_start: lineStart,
    line_end: lineEnd,
    recommendation: typeof source.recommendation === "string" ? source.recommendation.trim() : ""
  };
}

function normalizeReviewResultData(data) {
  return {
    verdict: data.verdict.trim(),
    summary: data.summary.trim(),
    findings: data.findings.map((finding, index) => normalizeReviewFinding(finding, index)),
    next_steps: data.next_steps
      .filter((step) => typeof step === "string" && step.trim())
      .map((step) => step.trim())
  };
}

function isStructuredReviewStoredResult(storedJob) {
  const result = storedJob?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(result, "result") ||
    Object.prototype.hasOwnProperty.call(result, "parseError")
  );
}

function formatJobLine(job) {
  const parts = [job.id, `${job.status || "unknown"}`];
  if (job.kindLabel) {
    parts.push(job.kindLabel);
  }
  if (job.title) {
    parts.push(job.title);
  }
  return parts.join(" | ");
}

function escapeMarkdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function formatCodexResumeCommand(job) {
  if (!job?.threadId) {
    return null;
  }
  return `codex resume ${job.threadId}`;
}

function appendActiveJobsTable(lines, jobs) {
  lines.push("Active jobs:");
  lines.push("| Job | Kind | Status | Phase | Elapsed | Codex Session ID | Summary | Actions |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const job of jobs) {
    const actions = [`/codex-status ${job.id}`];
    if (job.status === "queued" || job.status === "running") {
      actions.push(`/codex-cancel ${job.id}`);
    }
    lines.push(
      `| ${escapeMarkdownCell(job.id)} | ${escapeMarkdownCell(job.kindLabel)} | ${escapeMarkdownCell(job.status)} | ${escapeMarkdownCell(job.phase ?? "")} | ${escapeMarkdownCell(job.elapsed ?? "")} | ${escapeMarkdownCell(job.threadId ?? "")} | ${escapeMarkdownCell(job.summary ?? "")} | ${actions.map((action) => `\`${action}\``).join("<br>")} |`
    );
  }
}

function pushJobDetails(lines, job, options = {}) {
  lines.push(`- ${formatJobLine(job)}`);
  if (job.summary) {
    lines.push(`  Summary: ${job.summary}`);
  }
  if (job.phase) {
    lines.push(`  Phase: ${job.phase}`);
  }
  if (options.showElapsed && job.elapsed) {
    lines.push(`  Elapsed: ${job.elapsed}`);
  }
  if (options.showDuration && job.duration) {
    lines.push(`  Duration: ${job.duration}`);
  }
  if (job.threadId) {
    lines.push(`  Codex session ID: ${job.threadId}`);
  }
  const resumeCommand = formatCodexResumeCommand(job);
  if (resumeCommand) {
    lines.push(`  Resume in Codex: ${resumeCommand}`);
  }
  if (job.logFile && options.showLog) {
    lines.push(`  Log: ${job.logFile}`);
  }
  if ((job.status === "queued" || job.status === "running") && options.showCancelHint) {
    lines.push(`  Cancel: /codex-cancel ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && options.showResultHint) {
    lines.push(`  Result: /codex-result ${job.id}`);
  }
  if (job.status !== "queued" && job.status !== "running" && job.jobClass === "task" && job.write && options.showReviewHint) {
    lines.push("  Review changes: /codex-review --wait");
    lines.push("  Stricter review: /codex-adversarial-review --wait");
  }
  if (job.progressPreview?.length) {
    lines.push("  Progress:");
    for (const line of job.progressPreview) {
      lines.push(`    ${line}`);
    }
  }
}

function appendReasoningSection(lines, reasoningSummary) {
  if (!Array.isArray(reasoningSummary) || reasoningSummary.length === 0) {
    return;
  }

  lines.push("", "Reasoning:");
  for (const section of reasoningSummary) {
    lines.push(`- ${section}`);
  }
}

export function renderSetupReport(report) {
  const lines = [
    "# Codex Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- npm: ${report.npm.detail}`,
    `- codex: ${report.codex.detail}`,
    `- auth: ${report.auth.detail}`,
    `- session runtime: ${report.sessionRuntime.label}`,
    `- review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`,
    ""
  ];

  if (report.actionsTaken.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderReviewResult(parsedResult, meta) {
  if (!parsedResult.parsed) {
    const lines = [
      `# Codex ${meta.reviewLabel}`,
      "",
      "Codex did not return valid structured JSON.",
      "",
      `- Parse error: ${parsedResult.parseError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateReviewResultShape(parsedResult.parsed);
  if (validationError) {
    const lines = [
      `# Codex ${meta.reviewLabel}`,
      "",
      `Target: ${meta.targetLabel}`,
      "Codex returned JSON with an unexpected review shape.",
      "",
      `- Validation error: ${validationError}`
    ];

    if (parsedResult.rawOutput) {
      lines.push("", "Raw final message:", "", "```text", parsedResult.rawOutput, "```");
    }

    appendReasoningSection(lines, meta.reasoningSummary ?? parsedResult.reasoningSummary);

    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeReviewResultData(parsedResult.parsed);
  const findings = [...data.findings].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const lines = [
    `# Codex ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    `Verdict: ${data.verdict}`,
    "",
    data.summary,
    ""
  ];

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      lines.push(`  ${finding.body}`);
      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderNativeReviewResult(result, meta) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const lines = [
    `# Codex ${meta.reviewLabel}`,
    "",
    `Target: ${meta.targetLabel}`,
    ""
  ];

  if (stdout) {
    lines.push(stdout);
  } else if (result.status === 0) {
    lines.push("Codex review completed without any stdout output.");
  } else {
    lines.push("Codex review failed.");
  }

  if (stderr) {
    lines.push("", "stderr:", "", "```text", stderr, "```");
  }

  appendReasoningSection(lines, meta.reasoningSummary);

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(parsedResult, meta) {
  const rawOutput = typeof parsedResult?.rawOutput === "string" ? parsedResult.rawOutput : "";
  if (rawOutput) {
    return rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
  }

  const message = String(parsedResult?.failureMessage ?? "").trim() || "Codex did not return a final message.";
  return `${message}\n`;
}

export function renderStatusReport(report) {
  const lines = [
    "# Codex Status",
    "",
    `Session runtime: ${report.sessionRuntime.label}`,
    `Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`,
    ""
  ];

  if (report.running.length > 0) {
    appendActiveJobsTable(lines, report.running);
    lines.push("");
    lines.push("Live details:");
    for (const job of report.running) {
      pushJobDetails(lines, job, {
        showElapsed: true,
        showLog: true
      });
    }
    lines.push("");
  }

  if (report.latestFinished) {
    lines.push("Latest finished:");
    pushJobDetails(lines, report.latestFinished, {
      showDuration: true,
      showLog: report.latestFinished.status === "failed"
    });
    lines.push("");
  }

  if (report.recent.length > 0) {
    lines.push("Recent jobs:");
    for (const job of report.recent) {
      pushJobDetails(lines, job, {
        showDuration: true,
        showLog: job.status === "failed"
      });
    }
    lines.push("");
  } else if (report.running.length === 0 && !report.latestFinished) {
    lines.push("No jobs recorded yet.", "");
  }

  if (report.needsReview) {
    lines.push("The stop-time review gate is enabled.");
    lines.push("Ending the session will trigger a fresh Codex adversarial review and block if it finds issues.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJobStatusReport(job) {
  const lines = ["# Codex Job Status", ""];
  pushJobDetails(lines, job, {
    showElapsed: job.status === "queued" || job.status === "running",
    showDuration: job.status !== "queued" && job.status !== "running",
    showLog: true,
    showCancelHint: true,
    showResultHint: true,
    showReviewHint: true
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job, storedJob) {
  const threadId = storedJob?.threadId ?? job.threadId ?? null;
  const resumeCommand = threadId ? `codex resume ${threadId}` : null;
  if (isStructuredReviewStoredResult(storedJob) && storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  const rawOutput =
    (typeof storedJob?.result?.rawOutput === "string" && storedJob.result.rawOutput) ||
    (typeof storedJob?.result?.codex?.stdout === "string" && storedJob.result.codex.stdout) ||
    "";
  if (rawOutput) {
    const output = rawOutput.endsWith("\n") ? rawOutput : `${rawOutput}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  if (storedJob?.rendered) {
    const output = storedJob.rendered.endsWith("\n") ? storedJob.rendered : `${storedJob.rendered}\n`;
    if (!threadId) {
      return output;
    }
    return `${output}\nCodex session ID: ${threadId}\nResume in Codex: ${resumeCommand}\n`;
  }

  const lines = [
    `# ${job.title ?? "Codex Result"}`,
    "",
    `Job: ${job.id}`,
    `Status: ${job.status}`
  ];

  if (threadId) {
    lines.push(`Codex session ID: ${threadId}`);
    lines.push(`Resume in Codex: ${resumeCommand}`);
  }

  if (job.summary) {
    lines.push(`Summary: ${job.summary}`);
  }

  if (job.errorMessage) {
    lines.push("", job.errorMessage);
  } else if (storedJob?.errorMessage) {
    lines.push("", storedJob.errorMessage);
  } else {
    lines.push("", "No captured result payload was stored for this job.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderCancelReport(job) {
  const lines = [
    "# Codex Cancel",
    "",
    `Cancelled ${job.id}.`,
    ""
  ];

  if (job.title) {
    lines.push(`- Title: ${job.title}`);
  }
  if (job.summary) {
    lines.push(`- Summary: ${job.summary}`);
  }
  lines.push("- Check `/codex-status` for the updated queue.");

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatReadDuration(durationMs) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}

function formatReadToolLine(tool) {
  switch (tool.type) {
    case "commandExecution": {
      const details = [];
      if (tool.status) {
        details.push(tool.status);
      }
      if (tool.exitCode != null) {
        details.push(`exit ${tool.exitCode}`);
      }
      const duration = formatReadDuration(tool.durationMs);
      if (duration) {
        details.push(duration);
      }
      const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
      const head = `- [command] \`${tool.command || ""}\`${suffix}`;
      if (tool.outputPreview) {
        const indented = tool.outputPreview
          .split(/\r?\n/)
          .slice(0, 6)
          .map((line) => `  > ${line}`)
          .join("\n");
        return `${head}\n${indented}`;
      }
      return head;
    }
    case "fileChange": {
      const files = (tool.changes ?? []).map((change) => `${change.kind}:${change.path}`).join(", ");
      const status = tool.status ? ` (${tool.status})` : "";
      return `- [fileChange]${status} ${files || "no file details"}`;
    }
    case "mcpToolCall": {
      const target = [tool.server, tool.tool].filter(Boolean).join("/");
      const details = [tool.status, formatReadDuration(tool.durationMs)].filter(Boolean).join(", ");
      const err = tool.error ? ` — error: ${tool.error}` : "";
      return `- [mcp] ${target || "tool"}${details ? ` (${details})` : ""}${err}`;
    }
    case "dynamicToolCall": {
      const target = [tool.namespace, tool.tool].filter(Boolean).join("/");
      const details = [tool.status, formatReadDuration(tool.durationMs)].filter(Boolean).join(", ");
      return `- [tool] ${target || "dynamic"}${details ? ` (${details})` : ""}`;
    }
    case "collabAgentToolCall": {
      const targets = tool.receiverThreadIds?.length ? ` -> ${tool.receiverThreadIds.join(", ")}` : "";
      const details = tool.status ? ` (${tool.status})` : "";
      const prompt = tool.prompt ? `: ${tool.prompt}` : "";
      return `- [subagent] ${tool.tool || "collab"}${targets}${details}${prompt}`;
    }
    case "webSearch":
      return `- [webSearch] ${tool.query || "(query unavailable)"}`;
    case "plan":
      return `- [plan]\n${tool.text
        .split(/\r?\n/)
        .map((line) => `  ${line}`)
        .join("\n")}`;
    case "reasoning":
      return `- [reasoning] ${(tool.summary ?? []).join(" | ")}`;
    case "enteredReviewMode":
      return `- [review] Entered review mode${tool.review ? `: ${tool.review}` : ""}`;
    case "imageView":
      return `- [imageView] ${tool.path || ""}`;
    case "subAgentActivity":
      return `- [subAgentActivity] ${tool.kind || "activity"} (${tool.agentThreadId || tool.agentPath || ""})`;
    case "contextCompaction":
      return "- [contextCompaction] Thread context compacted";
    case "functionCallOutput": {
      const target = [tool.namespace, tool.name].filter(Boolean).join("/");
      return `- [functionCallOutput] ${target || "tool"}`;
    }
    default:
      return `- [${tool.type}]`;
  }
}

export function renderThreadReadResult(report) {
  const thread = report.thread ?? {};
  const pagination = report.pagination ?? {};
  const turns = Array.isArray(report.turns) ? report.turns : [];

  const lines = [
    "# Codex Thread",
    "",
    `- Thread ID: \`${report.threadId}\``,
    `- Deeplink: \`${report.deeplink}\``
  ];

  if (thread.name) {
    lines.push(`- Title: ${thread.name}`);
  }
  if (thread.cwd) {
    lines.push(`- Working directory: \`${thread.cwd}\``);
  }
  if (thread.status) {
    lines.push(`- Status: ${thread.status}`);
  }
  if (thread.historyMode || report.historySource) {
    const modeDetail = thread.historyMode ?? report.historySource;
    lines.push(`- History mode: ${modeDetail}`);
  }
  if (thread.model || thread.modelProvider) {
    const modelParts = [thread.model, thread.reasoningEffort ? `effort: ${thread.reasoningEffort}` : null].filter(Boolean);
    const modelText = modelParts.length > 0 ? modelParts.join(", ") : thread.modelProvider;
    const providerSuffix = thread.model && thread.modelProvider ? ` (${thread.modelProvider})` : "";
    lines.push(`- Model: ${modelText}${providerSuffix}`);
  }
  if (thread.source) {
    lines.push(`- Source: ${thread.source}`);
  }
  if (thread.createdAt) {
    lines.push(`- Created: ${thread.createdAt}`);
  }
  if (thread.updatedAt) {
    lines.push(`- Updated: ${thread.updatedAt}`);
  }

  let turnsSummary = `${turns.length}`;
  if (pagination.totalTurns != null) {
    turnsSummary = pagination.hasMore
      ? `${turns.length} of ${pagination.totalTurns} (latest; use --all for full history)`
      : `${turns.length} of ${pagination.totalTurns}`;
  } else if (pagination.hasMore) {
    turnsSummary = `${turns.length} (latest; older turns available via --all)`;
  }
  lines.push(`- Turns shown: ${turnsSummary}`);
  lines.push(`- Resume in Codex: \`${report.resumeCommand}\``);

  if (turns.length === 0) {
    lines.push("", "No turns recorded in this thread yet.");
    return `${lines.join("\n").trimEnd()}\n`;
  }

  for (const turn of turns) {
    const metaParts = [];
    if (turn.status) {
      metaParts.push(turn.status);
    }
    if (turn.startedAt) {
      metaParts.push(turn.startedAt);
    }
    const duration = formatReadDuration(turn.durationMs);
    if (duration) {
      metaParts.push(duration);
    }
    const metaSuffix = metaParts.length > 0 ? ` (${metaParts.join(" · ")})` : "";
    const headingNumber = pagination.totalTurns != null || !pagination.hasMore ? `Turn ${turn.index}` : `Turn ${turn.id ?? turn.index}`;

    lines.push("", "---", "", `## ${headingNumber}${metaSuffix}`);

    if (turn.userMessages.length > 0) {
      lines.push("", "### User", "", turn.userMessages.join("\n\n"));
    }

    if (turn.assistantMessages.length > 0) {
      lines.push("", "### Codex", "");
      for (let i = 0; i < turn.assistantMessages.length; i += 1) {
        const message = turn.assistantMessages[i];
        const prefix = report.includeTools && message.phase === "commentary" ? "[commentary] " : "";
        lines.push(`${prefix}${message.text}`);
        if (i < turn.assistantMessages.length - 1) {
          lines.push("");
        }
      }
    } else if (turn.error) {
      lines.push("", "### Error", "", turn.error);
    } else {
      lines.push("", "### Codex", "", "_(no assistant text message recorded in this turn)_");
    }

    if (report.includeTools && Array.isArray(turn.tools) && turn.tools.length > 0) {
      lines.push("", "### Tools & Activity", "");
      for (const tool of turn.tools) {
        lines.push(formatReadToolLine(tool));
      }
    } else if (!report.includeTools && turn.toolCount > 0) {
      lines.push("", `_(${turn.toolCount} tool/activity item(s) omitted; rerun with \`--include-tools\` to inspect)_`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
