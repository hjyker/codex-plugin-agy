/**
 * @typedef {import("./app-server-protocol").AppServerNotification} AppServerNotification
 * @typedef {import("./app-server-protocol").ReviewTarget} ReviewTarget
 * @typedef {import("./app-server-protocol").ThreadItem} ThreadItem
 * @typedef {import("./app-server-protocol").ThreadResumeParams} ThreadResumeParams
 * @typedef {import("./app-server-protocol").ThreadStartParams} ThreadStartParams
 * @typedef {import("./app-server-protocol").Turn} Turn
 * @typedef {import("./app-server-protocol").UserInput} UserInput
 * @typedef {((update: string | { message: string, phase: string | null, threadId?: string | null, turnId?: string | null, stderrMessage?: string | null, logTitle?: string | null, logBody?: string | null }) => void)} ProgressReporter
 * @typedef {{
 *   threadId: string,
 *   rootThreadId: string,
 *   threadIds: Set<string>,
 *   threadTurnIds: Map<string, string>,
 *   threadLabels: Map<string, string>,
 *   turnId: string | null,
 *   bufferedNotifications: AppServerNotification[],
 *   completion: Promise<TurnCaptureState>,
 *   resolveCompletion: (state: TurnCaptureState) => void,
 *   rejectCompletion: (error: unknown) => void,
 *   finalTurn: Turn | null,
 *   completed: boolean,
 *   finalAnswerSeen: boolean,
 *   pendingCollaborations: Set<string>,
 *   activeSubagentTurns: Set<string>,
 *   completionTimer: ReturnType<typeof setTimeout> | null,
 *   lastAgentMessage: string,
 *   reviewText: string,
 *   reasoningSummary: string[],
 *   error: unknown,
 *   messages: Array<{ lifecycle: string, phase: string | null, text: string }>,
 *   fileChanges: ThreadItem[],
 *   commandExecutions: ThreadItem[],
 *   onProgress: ProgressReporter | null
 * }} TurnCaptureState
 */
import { readJsonFile } from "./fs.mjs";
import { BROKER_BUSY_RPC_CODE, BROKER_ENDPOINT_ENV, CodexAppServerClient } from "./app-server.mjs";
import { loadBrokerSession } from "./broker-lifecycle.mjs";
import { binaryAvailable } from "./process.mjs";

const SERVICE_NAME = "antigravity_codex_plugin";
const TASK_THREAD_PREFIX = "Codex Companion Task";
const DEFAULT_READ_LIMIT = 10;
const CODEX_THREAD_DEEPLINK_RE = /^codex:\/\/threads\/([^/?#\s]+)(?:\/?(?:[?#].*)?)?$/i;
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";

function cleanCodexStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("WARNING: proceeding, even though we could not update PATH:"))
    .join("\n");
}

/** @returns {ThreadStartParams} */
function buildThreadParams(cwd, options = {}) {
  return {
    cwd,
    model: options.model ?? null,
    ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
    approvalPolicy: options.approvalPolicy ?? "never",
    sandbox: options.sandbox ?? "read-only",
    serviceName: SERVICE_NAME,
    ephemeral: options.ephemeral ?? true
  };
}

/** @returns {ThreadResumeParams} */
function buildResumeParams(threadId, cwd, options = {}) {
  return {
    threadId,
    cwd,
    model: options.model ?? null,
    ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
    approvalPolicy: options.approvalPolicy ?? "never",
    sandbox: options.sandbox ?? "read-only"
  };
}

/** @returns {UserInput[]} */
function buildTurnInput(prompt) {
  return [{ type: "text", text: prompt, text_elements: [] }];
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function looksLikeVerificationCommand(command) {
  return /\b(test|tests|lint|build|typecheck|type-check|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|mvn test|gradle test|tsc|eslint|ruff)\b/i.test(
    command
  );
}

function buildTaskThreadName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

function extractThreadId(message) {
  return message?.params?.threadId ?? null;
}

function extractTurnId(message) {
  if (message?.params?.turnId) {
    return message.params.turnId;
  }
  if (message?.params?.turn?.id) {
    return message.params.turn.id;
  }
  return null;
}

function collectTouchedFiles(fileChanges) {
  const paths = new Set();
  for (const fileChange of fileChanges) {
    for (const change of fileChange.changes ?? []) {
      if (change.path) {
        paths.add(change.path);
      }
    }
  }
  return [...paths];
}

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function extractReasoningSections(value) {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = normalizeReasoningText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractReasoningSections(entry));
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return extractReasoningSections(value.text);
    }
    if ("summary" in value) {
      return extractReasoningSections(value.summary);
    }
    if ("content" in value) {
      return extractReasoningSections(value.content);
    }
    if ("parts" in value) {
      return extractReasoningSections(value.parts);
    }
  }

  return [];
}

function mergeReasoningSections(existingSections, nextSections) {
  const merged = [];
  for (const section of [...existingSections, ...nextSections]) {
    const normalized = normalizeReasoningText(section);
    if (!normalized || merged.includes(normalized)) {
      continue;
    }
    merged.push(normalized);
  }
  return merged;
}

/**
 * @param {ProgressReporter | null | undefined} onProgress
 * @param {string | null | undefined} message
 * @param {string | null | undefined} [phase]
 */
function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function emitLogEvent(onProgress, options = {}) {
  if (!onProgress) {
    return;
  }

  onProgress({
    message: options.message ?? "",
    phase: options.phase ?? null,
    stderrMessage: options.stderrMessage ?? null,
    logTitle: options.logTitle ?? null,
    logBody: options.logBody ?? null
  });
}

function labelForThread(state, threadId) {
  if (!threadId || threadId === state.rootThreadId || threadId === state.threadId) {
    return null;
  }
  return state.threadLabels.get(threadId) ?? threadId;
}

function registerThread(state, threadId, options = {}) {
  if (!threadId) {
    return;
  }

  state.threadIds.add(threadId);
  const label =
    options.threadName ??
    options.name ??
    options.agentNickname ??
    options.agentRole ??
    state.threadLabels.get(threadId) ??
    null;
  if (label) {
    state.threadLabels.set(threadId, label);
  }
}

function describeStartedItem(state, item) {
  switch (item.type) {
    case "enteredReviewMode":
      return { message: `Reviewer started: ${item.review}`, phase: "reviewing" };
    case "commandExecution":
      return {
        message: `Running command: ${shorten(item.command, 96)}`,
        phase: looksLikeVerificationCommand(item.command) ? "verifying" : "running"
      };
    case "fileChange":
      return { message: `Applying ${item.changes.length} file change(s).`, phase: "editing" };
    case "mcpToolCall":
      return { message: `Calling ${item.server}/${item.tool}.`, phase: "investigating" };
    case "dynamicToolCall":
      return { message: `Running tool: ${item.tool}.`, phase: "investigating" };
    case "collabAgentToolCall": {
      const subagents = (item.receiverThreadIds ?? []).map((threadId) => labelForThread(state, threadId) ?? threadId);
      const summary =
        subagents.length > 0
          ? `Starting subagent ${subagents.join(", ")} via collaboration tool: ${item.tool}.`
          : `Starting collaboration tool: ${item.tool}.`;
      return { message: summary, phase: "investigating" };
    }
    case "webSearch":
      return { message: `Searching: ${shorten(item.query, 96)}`, phase: "investigating" };
    default:
      return null;
  }
}

function describeCompletedItem(state, item) {
  switch (item.type) {
    case "commandExecution": {
      const exitCode = item.exitCode ?? "?";
      const statusLabel = item.status === "completed" ? "completed" : item.status;
      return {
        message: `Command ${statusLabel}: ${shorten(item.command, 96)} (exit ${exitCode})`,
        phase: looksLikeVerificationCommand(item.command) ? "verifying" : "running"
      };
    }
    case "fileChange":
      return { message: `File changes ${item.status}.`, phase: "editing" };
    case "mcpToolCall":
      return { message: `Tool ${item.server}/${item.tool} ${item.status}.`, phase: "investigating" };
    case "dynamicToolCall":
      return { message: `Tool ${item.tool} ${item.status}.`, phase: "investigating" };
    case "collabAgentToolCall": {
      const subagents = (item.receiverThreadIds ?? []).map((threadId) => labelForThread(state, threadId) ?? threadId);
      const summary =
        subagents.length > 0
          ? `Subagent ${subagents.join(", ")} ${item.status}.`
          : `Collaboration tool ${item.tool} ${item.status}.`;
      return { message: summary, phase: "investigating" };
    }
    case "exitedReviewMode":
      return { message: "Reviewer finished.", phase: "finalizing" };
    default:
      return null;
  }
}

/** @returns {TurnCaptureState} */
function createTurnCaptureState(threadId, options = {}) {
  let resolveCompletion;
  let rejectCompletion;
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    threadId,
    rootThreadId: threadId,
    threadIds: new Set([threadId]),
    threadTurnIds: new Map(),
    threadLabels: new Map(),
    turnId: null,
    bufferedNotifications: [],
    completion,
    resolveCompletion,
    rejectCompletion,
    finalTurn: null,
    completed: false,
    finalAnswerSeen: false,
    pendingCollaborations: new Set(),
    activeSubagentTurns: new Set(),
    completionTimer: null,
    lastAgentMessage: "",
    reviewText: "",
    reasoningSummary: [],
    error: null,
    messages: [],
    fileChanges: [],
    commandExecutions: [],
    onProgress: options.onProgress ?? null
  };
}

function clearCompletionTimer(state) {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer);
    state.completionTimer = null;
  }
}

function completeTurn(state, turn = null, options = {}) {
  if (state.completed) {
    return;
  }

  clearCompletionTimer(state);
  state.completed = true;

  if (turn) {
    state.finalTurn = turn;
    if (!state.turnId) {
      state.turnId = turn.id;
    }
  } else if (!state.finalTurn) {
    state.finalTurn = {
      id: state.turnId ?? "inferred-turn",
      status: "completed"
    };
  }

  if (options.inferred) {
    emitProgress(state.onProgress, "Turn completion inferred after the main thread finished and subagent work drained.", "finalizing");
  }

  state.resolveCompletion(state);
}

function scheduleInferredCompletion(state) {
  if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
    return;
  }

  if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
    return;
  }

  clearCompletionTimer(state);
  state.completionTimer = setTimeout(() => {
    state.completionTimer = null;
    if (state.completed || state.finalTurn || !state.finalAnswerSeen) {
      return;
    }
    if (state.pendingCollaborations.size > 0 || state.activeSubagentTurns.size > 0) {
      return;
    }
    completeTurn(state, null, { inferred: true });
  }, 250);
  state.completionTimer.unref?.();
}

function belongsToTurn(state, message) {
  const messageThreadId = extractThreadId(message);
  if (!messageThreadId || !state.threadIds.has(messageThreadId)) {
    return false;
  }
  const trackedTurnId = state.threadTurnIds.get(messageThreadId) ?? null;
  const messageTurnId = extractTurnId(message);
  return trackedTurnId === null || messageTurnId === null || messageTurnId === trackedTurnId;
}

function recordItem(state, item, lifecycle, threadId = null) {
  if (item.type === "collabAgentToolCall") {
    if (!threadId || threadId === state.threadId) {
      if (lifecycle === "started" || item.status === "inProgress") {
        state.pendingCollaborations.add(item.id);
      } else if (lifecycle === "completed") {
        state.pendingCollaborations.delete(item.id);
        scheduleInferredCompletion(state);
      }
    }
    for (const receiverThreadId of item.receiverThreadIds ?? []) {
      registerThread(state, receiverThreadId);
    }
  }

  if (item.type === "agentMessage") {
    state.messages.push({
      lifecycle,
      phase: item.phase ?? null,
      text: item.text ?? ""
    });
    if (item.text) {
      if (!threadId || threadId === state.threadId) {
        state.lastAgentMessage = item.text;
        if (lifecycle === "completed" && item.phase === "final_answer") {
          state.finalAnswerSeen = true;
          scheduleInferredCompletion(state);
        }
      }
      if (lifecycle === "completed") {
        const sourceLabel = labelForThread(state, threadId);
        emitLogEvent(state.onProgress, {
          message: sourceLabel ? `Subagent ${sourceLabel}: ${shorten(item.text, 96)}` : `Assistant message captured: ${shorten(item.text, 96)}`,
          stderrMessage: null,
          phase: item.phase === "final_answer" ? "finalizing" : null,
          logTitle: sourceLabel ? `Subagent ${sourceLabel} message` : "Assistant message",
          logBody: item.text
        });
      }
    }
    return;
  }

  if (item.type === "exitedReviewMode") {
    state.reviewText = item.review ?? "";
    if (lifecycle === "completed" && item.review) {
      emitLogEvent(state.onProgress, {
        message: "Review output captured.",
        stderrMessage: null,
        phase: "finalizing",
        logTitle: "Review output",
        logBody: item.review
      });
    }
    return;
  }

  if (item.type === "reasoning" && lifecycle === "completed") {
    const nextSections = extractReasoningSections(item.summary);
    state.reasoningSummary = mergeReasoningSections(state.reasoningSummary, nextSections);
    if (nextSections.length > 0) {
      const sourceLabel = labelForThread(state, threadId);
      emitLogEvent(state.onProgress, {
        message: sourceLabel
          ? `Subagent ${sourceLabel} reasoning: ${shorten(nextSections[0], 96)}`
          : `Reasoning summary captured: ${shorten(nextSections[0], 96)}`,
        stderrMessage: null,
        logTitle: sourceLabel ? `Subagent ${sourceLabel} reasoning summary` : "Reasoning summary",
        logBody: nextSections.map((section) => `- ${section}`).join("\n")
      });
    }
    return;
  }

  if (item.type === "fileChange" && lifecycle === "completed") {
    state.fileChanges.push(item);
    return;
  }

  if (item.type === "commandExecution" && lifecycle === "completed") {
    state.commandExecutions.push(item);
  }
}

function applyTurnNotification(state, message) {
  switch (message.method) {
    case "thread/started":
      registerThread(state, message.params.thread.id, {
        threadName: message.params.thread.name,
        name: message.params.thread.name,
        agentNickname: message.params.thread.agentNickname,
        agentRole: message.params.thread.agentRole
      });
      break;
    case "thread/name/updated":
      registerThread(state, message.params.threadId, {
        threadName: message.params.threadName ?? null
      });
      break;
    case "turn/started":
      registerThread(state, message.params.threadId);
      state.threadTurnIds.set(message.params.threadId, message.params.turn.id);
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.add(message.params.threadId);
      }
      emitProgress(
        state.onProgress,
        `Turn started (${message.params.turn.id}).`,
        "starting",
        (message.params.threadId ?? null) === state.threadId
          ? {
              threadId: message.params.threadId ?? null,
              turnId: message.params.turn.id ?? null
            }
          : {}
      );
      break;
    case "item/started":
      recordItem(state, message.params.item, "started", message.params.threadId ?? null);
      {
        const update = describeStartedItem(state, message.params.item);
        emitProgress(state.onProgress, update?.message, update?.phase ?? null);
      }
      break;
    case "item/completed":
      recordItem(state, message.params.item, "completed", message.params.threadId ?? null);
      {
        const update = describeCompletedItem(state, message.params.item);
        emitProgress(state.onProgress, update?.message, update?.phase ?? null);
      }
      break;
    case "error":
      state.error = message.params.error;
      emitProgress(state.onProgress, `Codex error: ${message.params.error.message}`, "failed");
      break;
    case "turn/completed":
      if ((message.params.threadId ?? null) !== state.threadId) {
        state.activeSubagentTurns.delete(message.params.threadId);
        scheduleInferredCompletion(state);
        break;
      }
      emitProgress(
        state.onProgress,
        `Turn ${message.params.turn.status === "completed" ? "completed" : message.params.turn.status}.`,
        "finalizing"
      );
      completeTurn(state, message.params.turn);
      break;
    default:
      break;
  }
}

async function captureTurn(client, threadId, startRequest, options = {}) {
  const state = createTurnCaptureState(threadId, options);
  const previousHandler = client.notificationHandler;

  client.setNotificationHandler((message) => {
    if (!state.turnId) {
      state.bufferedNotifications.push(message);
      return;
    }

    if (message.method === "thread/started" || message.method === "thread/name/updated") {
      applyTurnNotification(state, message);
      return;
    }

    if (!belongsToTurn(state, message)) {
        if (previousHandler) {
          previousHandler(message);
        }
        return;
    }

    applyTurnNotification(state, message);
  });

  try {
    const response = await startRequest();
    options.onResponse?.(response, state);
    state.turnId = response.turn?.id ?? null;
    if (state.turnId) {
      state.threadTurnIds.set(state.threadId, state.turnId);
    }
    for (const message of state.bufferedNotifications) {
      if (belongsToTurn(state, message)) {
        applyTurnNotification(state, message);
      } else {
        if (previousHandler) {
          previousHandler(message);
        }
      }
    }
    state.bufferedNotifications.length = 0;

    if (response.turn?.status && response.turn.status !== "inProgress") {
      completeTurn(state, response.turn);
    }

    return await state.completion;
  } finally {
    clearCompletionTimer(state);
    client.setNotificationHandler(previousHandler ?? null);
  }
}

async function withAppServer(cwd, fn) {
  let client = null;
  try {
    client = await CodexAppServerClient.connect(cwd);
    const result = await fn(client);
    await client.close();
    return result;
  } catch (error) {
    const brokerRequested = client?.transport === "broker" || Boolean(process.env[BROKER_ENDPOINT_ENV]);
    const shouldRetryDirect =
      (client?.transport === "broker" && error?.rpcCode === BROKER_BUSY_RPC_CODE) ||
      (brokerRequested && (error?.code === "ENOENT" || error?.code === "ECONNREFUSED"));

    if (client) {
      await client.close().catch(() => {});
      client = null;
    }

    if (!shouldRetryDirect) {
      throw error;
    }

    const directClient = await CodexAppServerClient.connect(cwd, { disableBroker: true });
    try {
      return await fn(directClient);
    } finally {
      await directClient.close();
    }
  }
}

async function withDirectAppServer(cwd, fn) {
  const client = await CodexAppServerClient.connect(cwd, { disableBroker: true });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

async function withReadOnlyAppServer(cwd, fn) {
  let client = null;
  const brokerConfigured = Boolean(process.env[BROKER_ENDPOINT_ENV] || loadBrokerSession(cwd)?.endpoint);
  try {
    client = await CodexAppServerClient.connect(cwd, { reuseExistingBroker: true });
    const result = await fn(client);
    await client.close();
    return result;
  } catch (error) {
    const brokerRequested = client?.transport === "broker" || brokerConfigured;
    const shouldRetryDirect =
      (client?.transport === "broker" && error?.rpcCode === BROKER_BUSY_RPC_CODE) ||
      (brokerRequested && (error?.code === "ENOENT" || error?.code === "ECONNREFUSED"));

    if (client) {
      await client.close().catch(() => {});
      client = null;
    }

    if (!shouldRetryDirect) {
      throw error;
    }

    return withDirectAppServer(cwd, fn);
  }
}

export function parseCodexThreadRef(raw) {
  if (raw == null) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  if (/^codex:\/\//i.test(trimmed)) {
    const match = trimmed.match(CODEX_THREAD_DEEPLINK_RE);
    if (!match) {
      throw new Error(
        `Invalid Codex thread deeplink "${trimmed}". Expected "codex://threads/<thread-id>" or a raw thread ID.`
      );
    }
    let decoded;
    try {
      decoded = decodeURIComponent(match[1]).trim();
    } catch {
      decoded = match[1].trim();
    }
    if (!decoded || /\s/.test(decoded)) {
      throw new Error(
        `Invalid Codex thread deeplink "${trimmed}". Expected "codex://threads/<thread-id>" or a raw thread ID.`
      );
    }
    return decoded;
  }
  if (/\s/.test(trimmed)) {
    throw new Error(`Invalid Codex thread ID "${trimmed}". Expected a thread ID or "codex://threads/<thread-id>".`);
  }
  return trimmed;
}

function isUnsupportedRpcMethodError(error) {
  if (error?.rpcCode === -32601) {
    return true;
  }
  const message = String(error?.message ?? error ?? "");
  return /unknown variant|unknown method|unsupported method|method not found/i.test(message);
}

function formatUnixTimestampIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function truncatePreview(text, maxLength = 400) {
  const value = String(text ?? "").trim();
  if (!value) {
    return null;
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatUserInputPart(part) {
  if (!part || typeof part !== "object") {
    return "";
  }
  switch (part.type) {
    case "text":
      return typeof part.text === "string" ? part.text : "";
    case "image":
      return `[image: ${part.url ?? part.fileId ?? "image"}]`;
    case "localImage":
      return `[image: ${part.path ?? "local image"}]`;
    case "audio":
      return `[audio: ${part.url ?? part.fileId ?? "audio"}]`;
    case "localAudio":
      return `[audio: ${part.path ?? "local audio"}]`;
    case "skill":
      return `[skill: ${part.name ?? part.path ?? "skill"}]`;
    case "mention":
      return part.path ? `@${part.name ?? "file"} (${part.path})` : `@${part.name ?? "mention"}`;
    default:
      return typeof part.text === "string" ? part.text : "";
  }
}

function extractUserMessageText(item) {
  if (Array.isArray(item?.content)) {
    return item.content
      .map(formatUserInputPart)
      .filter((chunk) => chunk.length > 0)
      .join("\n")
      .trim();
  }
  if (typeof item?.text === "string") {
    return item.text.trim();
  }
  return "";
}

function formatThreadStatus(status) {
  if (!status) {
    return null;
  }
  if (typeof status === "string") {
    return status;
  }
  if (typeof status === "object" && typeof status.type === "string") {
    if (status.type === "active" && Array.isArray(status.activeFlags) && status.activeFlags.length > 0) {
      return `${status.type} (${status.activeFlags.join(", ")})`;
    }
    return status.type;
  }
  return null;
}

function formatSessionSource(source) {
  if (!source) {
    return null;
  }
  if (typeof source === "string") {
    return source;
  }
  if (typeof source === "object") {
    if (typeof source.type === "string") {
      return source.type;
    }
    const keys = Object.keys(source);
    if (keys.length === 1) {
      return keys[0];
    }
  }
  return null;
}

function summarizeToolItem(item) {
  if (!item || typeof item !== "object" || !item.type) {
    return null;
  }
  switch (item.type) {
    case "userMessage":
    case "agentMessage":
    case "hookPrompt":
      return null;
    case "commandExecution":
      return {
        type: "commandExecution",
        id: item.id ?? null,
        command: item.command ?? "",
        cwd: item.cwd ?? null,
        status: item.status ?? null,
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
        outputPreview: truncatePreview(item.aggregatedOutput, 400)
      };
    case "fileChange":
      return {
        type: "fileChange",
        id: item.id ?? null,
        status: item.status ?? null,
        changes: Array.isArray(item.changes)
          ? item.changes.map((change) => ({
              path: change?.path ?? "unknown",
              kind: typeof change?.kind === "string" ? change.kind : change?.kind?.type ?? "update"
            }))
          : []
      };
    case "mcpToolCall":
      return {
        type: "mcpToolCall",
        id: item.id ?? null,
        server: item.server ?? null,
        tool: item.tool ?? null,
        status: item.status ?? null,
        durationMs: item.durationMs ?? null,
        error: typeof item.error === "string" ? item.error : item.error?.message ?? null
      };
    case "dynamicToolCall":
      return {
        type: "dynamicToolCall",
        id: item.id ?? null,
        namespace: item.namespace ?? null,
        tool: item.tool ?? null,
        status: item.status ?? null,
        success: item.success ?? null,
        durationMs: item.durationMs ?? null
      };
    case "collabAgentToolCall":
      return {
        type: "collabAgentToolCall",
        id: item.id ?? null,
        tool: item.tool ?? null,
        status: item.status ?? null,
        receiverThreadIds: Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [],
        prompt: truncatePreview(item.prompt, 200)
      };
    case "webSearch":
      return {
        type: "webSearch",
        id: item.id ?? null,
        query: item.query ?? item.action?.query ?? null
      };
    case "plan": {
      const text = String(item.text ?? "").trim();
      return text ? { type: "plan", id: item.id ?? null, text } : null;
    }
    case "reasoning": {
      const summary = extractReasoningSections(item.summary);
      return summary.length > 0 ? { type: "reasoning", id: item.id ?? null, summary } : null;
    }
    case "enteredReviewMode":
      return {
        type: "enteredReviewMode",
        id: item.id ?? null,
        review: item.review ?? ""
      };
    case "exitedReviewMode":
      return null;
    case "imageView":
      return {
        type: "imageView",
        id: item.id ?? null,
        path: item.path ?? null
      };
    case "subAgentActivity":
      return {
        type: "subAgentActivity",
        id: item.id ?? null,
        kind: item.kind ?? null,
        agentThreadId: item.agentThreadId ?? null,
        agentPath: item.agentPath ?? null
      };
    case "contextCompaction":
      return {
        type: "contextCompaction",
        id: item.id ?? null
      };
    case "functionCallOutput":
      return {
        type: "functionCallOutput",
        id: item.id ?? null,
        name: item.name ?? null,
        namespace: item.namespace ?? null
      };
    default:
      return {
        type: item.type,
        id: item.id ?? null
      };
  }
}

function normalizeReadTurn(turn, index, options = {}) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const userMessages = [];
  const allAssistantMessages = [];
  const toolItems = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "userMessage") {
      const text = extractUserMessageText(item);
      if (text) {
        userMessages.push(text);
      }
      continue;
    }
    if (item.type === "agentMessage") {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (text) {
        allAssistantMessages.push({
          id: item.id ?? null,
          phase: item.phase ?? null,
          text
        });
      }
      continue;
    }
    if (item.type === "exitedReviewMode") {
      const text = typeof item.review === "string" ? item.review.trim() : "";
      if (text) {
        allAssistantMessages.push({
          id: item.id ?? null,
          phase: "review",
          text
        });
      }
      continue;
    }
    const summarized = summarizeToolItem(item);
    if (summarized) {
      toolItems.push(summarized);
    }
  }

  const hasFinalMessage = allAssistantMessages.some(
    (entry) => entry.phase === "final_answer" || entry.phase === "review"
  );
  const assistantMessages =
    options.includeTools || !hasFinalMessage
      ? allAssistantMessages
      : allAssistantMessages.filter((entry) => entry.phase !== "commentary");

  return {
    index,
    id: turn?.id ?? null,
    status: turn?.status ?? null,
    error: turn?.error?.message ?? (typeof turn?.error === "string" ? turn.error : null),
    startedAt: formatUnixTimestampIso(turn?.startedAt),
    completedAt: formatUnixTimestampIso(turn?.completedAt),
    durationMs: typeof turn?.durationMs === "number" ? turn.durationMs : null,
    userMessages,
    assistantMessages,
    toolCount: toolItems.length,
    tools: options.includeTools ? toolItems : []
  };
}

async function fetchTurnItemsList(client, threadId, turnId) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;

  while (true) {
    const response = await client.request("thread/items/list", {
      threadId,
      turnId,
      limit: 200,
      sortDirection: "asc",
      ...(cursor ? { cursor } : {})
    });
    const page = Array.isArray(response?.data) ? response.data : [];
    for (const entry of page) {
      if (entry?.item && typeof entry.item === "object") {
        items.push({
          ...entry.item,
          ...(entry.startedAtMs != null && entry.item.startedAtMs == null ? { startedAtMs: entry.startedAtMs } : {}),
          ...(entry.completedAtMs != null && entry.item.completedAtMs == null
            ? { completedAtMs: entry.completedAtMs }
            : {})
        });
      } else if (entry && typeof entry === "object" && entry.type) {
        items.push(entry);
      }
    }
    const nextCursor = response?.nextCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return items;
}

async function fetchPaginatedTurnsHistory(client, threadId, options = {}) {
  const all = Boolean(options.all);
  const limit = all ? null : options.limit;
  const collectedDesc = [];
  const seenCursors = new Set();
  let cursor = null;
  let lastNextCursor = null;

  while (true) {
    const remaining = all ? 100 : Math.min(Math.max(limit - collectedDesc.length, 1), 100);
    const response = await client.request("thread/turns/list", {
      threadId,
      limit: remaining,
      sortDirection: "desc",
      itemsView: "summary",
      ...(cursor ? { cursor } : {})
    });
    const page = Array.isArray(response?.data) ? response.data : [];
    collectedDesc.push(...page);
    lastNextCursor = response?.nextCursor ?? null;

    if (!all && collectedDesc.length >= limit) {
      break;
    }
    if (!lastNextCursor || page.length === 0 || seenCursors.has(lastNextCursor)) {
      break;
    }
    seenCursors.add(lastNextCursor);
    cursor = lastNextCursor;
  }

  const hasMore = !all && (Boolean(lastNextCursor) || collectedDesc.length > limit);
  const selectedDesc = all ? collectedDesc : collectedDesc.slice(0, limit);
  const selectedTurns = [...selectedDesc].reverse();

  const hydratedTurns = [];
  for (const turn of selectedTurns) {
    let items = Array.isArray(turn?.items) ? turn.items : [];
    if (turn?.id) {
      try {
        items = await fetchTurnItemsList(client, threadId, turn.id);
      } catch (error) {
        if (!isUnsupportedRpcMethodError(error)) {
          throw error;
        }
      }
    }
    hydratedTurns.push({
      ...turn,
      items
    });
  }

  return {
    turns: hydratedTurns,
    hasMore,
    totalTurns: hasMore ? null : hydratedTurns.length,
    startIndex: 1
  };
}

async function fetchLegacyTurnsHistory(client, threadId, options = {}) {
  const all = Boolean(options.all);
  const limit = all ? null : options.limit;
  const response = await client.request("thread/read", {
    threadId,
    includeTurns: true
  });
  const thread = response?.thread ?? null;
  const allTurns = Array.isArray(thread?.turns) ? thread.turns : [];
  const selectedTurns = all ? allTurns : allTurns.slice(-limit);
  const hasMore = !all && allTurns.length > selectedTurns.length;
  const startIndex = allTurns.length - selectedTurns.length + 1;

  const hydratedTurns = [];
  for (const turn of selectedTurns) {
    let items = Array.isArray(turn?.items) ? turn.items : [];
    if (turn?.id && turn.itemsView && turn.itemsView !== "full" && items.length === 0) {
      try {
        items = await fetchTurnItemsList(client, threadId, turn.id);
      } catch (error) {
        if (!isUnsupportedRpcMethodError(error)) {
          throw error;
        }
      }
    }
    hydratedTurns.push({
      ...turn,
      items
    });
  }

  return {
    thread,
    turns: hydratedTurns,
    hasMore,
    totalTurns: allTurns.length,
    startIndex
  };
}

async function startThread(client, cwd, options = {}) {
  const response = await client.request("thread/start", buildThreadParams(cwd, options));
  const threadId = response.thread.id;
  if (options.threadName) {
    try {
      await client.request("thread/name/set", { threadId, name: options.threadName });
    } catch (err) {
      // Only suppress "unknown variant/method" errors from older CLI versions
      // that don't support thread/name/set. Rethrow auth, network, or server errors.
      const msg = String(err?.message ?? err ?? "");
      if (!msg.includes("unknown variant") && !msg.includes("unknown method")) {
        throw err;
      }
    }
  }
  return response;
}

async function resumeThread(client, threadId, cwd, options = {}) {
  return client.request("thread/resume", buildResumeParams(threadId, cwd, options));
}

function buildResultStatus(turnState) {
  return turnState.finalTurn?.status === "completed" ? 0 : 1;
}

const BUILTIN_PROVIDER_LABELS = new Map([
  ["openai", "OpenAI"],
  ["ollama", "Ollama"],
  ["lmstudio", "LM Studio"]
]);

function normalizeProviderId(value) {
  const providerId = typeof value === "string" ? value.trim() : "";
  return providerId || null;
}

function formatProviderLabel(providerId, providerConfig = null) {
  const configuredName = typeof providerConfig?.name === "string" ? providerConfig.name.trim() : "";
  if (configuredName) {
    return configuredName;
  }
  if (!providerId) {
    return "The active provider";
  }
  return BUILTIN_PROVIDER_LABELS.get(providerId) ?? providerId;
}

function buildAuthStatus(fields = {}) {
  return {
    available: true,
    loggedIn: false,
    detail: "not authenticated",
    source: "unknown",
    authMethod: null,
    verified: null,
    requiresOpenaiAuth: null,
    provider: null,
    ...fields
  };
}

function resolveProviderConfig(configResponse) {
  const config = configResponse?.config;
  if (!config || typeof config !== "object") {
    return {
      providerId: null,
      providerConfig: null
    };
  }

  const providerId = normalizeProviderId(config.model_provider);
  const providers =
    config.model_providers && typeof config.model_providers === "object" && !Array.isArray(config.model_providers)
      ? config.model_providers
      : null;
  const providerConfig =
    providerId && providers?.[providerId] && typeof providers[providerId] === "object" ? providers[providerId] : null;

  return {
    providerId,
    providerConfig
  };
}

function buildAppServerAuthStatus(accountResponse, configResponse) {
  const account = accountResponse?.account ?? null;
  const requiresOpenaiAuth =
    typeof accountResponse?.requiresOpenaiAuth === "boolean" ? accountResponse.requiresOpenaiAuth : null;
  const { providerId, providerConfig } = resolveProviderConfig(configResponse);
  const providerLabel = formatProviderLabel(providerId, providerConfig);

  if (account?.type === "chatgpt") {
    const email = typeof account.email === "string" && account.email.trim() ? account.email.trim() : null;
    return buildAuthStatus({
      loggedIn: true,
      detail: email ? `ChatGPT login active for ${email}` : "ChatGPT login active",
      source: "app-server",
      authMethod: "chatgpt",
      verified: true,
      requiresOpenaiAuth,
      provider: providerId
    });
  }

  if (account?.type === "apiKey") {
    return buildAuthStatus({
      loggedIn: true,
      detail: "API key configured (unverified)",
      source: "app-server",
      authMethod: "apiKey",
      verified: false,
      requiresOpenaiAuth,
      provider: providerId
    });
  }

  if (requiresOpenaiAuth === false) {
    return buildAuthStatus({
      loggedIn: true,
      detail: `${providerLabel} is configured and does not require OpenAI authentication`,
      source: "app-server",
      requiresOpenaiAuth,
      provider: providerId
    });
  }

  return buildAuthStatus({
    loggedIn: false,
    detail: `${providerLabel} requires OpenAI authentication`,
    source: "app-server",
    requiresOpenaiAuth,
    provider: providerId
  });
}

async function getCodexAuthStatusFromClient(client, cwd) {
  try {
    const accountResponse = await client.request("account/read", { refreshToken: false });
    const configResponse = await client.request("config/read", {
      includeLayers: false,
      cwd
    });

    return buildAppServerAuthStatus(accountResponse, configResponse);
  } catch (error) {
    return buildAuthStatus({
      loggedIn: false,
      detail: error instanceof Error ? error.message : String(error),
      source: "app-server"
    });
  }
}

export function getCodexAvailability(cwd) {
  const versionStatus = binaryAvailable("codex", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }

  const appServerStatus = binaryAvailable("codex", ["app-server", "--help"], { cwd });
  if (!appServerStatus.available) {
    return {
      available: false,
      detail: `${versionStatus.detail}; advanced runtime unavailable: ${appServerStatus.detail}`
    };
  }

  return {
    available: true,
    detail: `${versionStatus.detail}; advanced runtime available`
  };
}

export function getSessionRuntimeStatus(env = process.env, cwd = process.cwd()) {
  const endpoint = env?.[BROKER_ENDPOINT_ENV] ?? loadBrokerSession(cwd)?.endpoint ?? null;
  if (endpoint) {
    return {
      mode: "shared",
      label: "shared session",
      detail: "This Antigravity session is configured to reuse one shared Codex runtime.",
      endpoint
    };
  }

  return {
    mode: "direct",
    label: "direct startup",
    detail: "No shared Codex runtime is active yet. The first review or task command will start one on demand.",
    endpoint: null
  };
}

export async function getCodexAuthStatus(cwd, options = {}) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      source: "availability",
      authMethod: null,
      verified: null,
      requiresOpenaiAuth: null,
      provider: null
    };
  }

  let client = null;
  try {
    client = await CodexAppServerClient.connect(cwd, {
      env: options.env,
      reuseExistingBroker: true
    });
    return await getCodexAuthStatusFromClient(client, cwd);
  } catch (error) {
    return buildAuthStatus({
      loggedIn: false,
      detail: error instanceof Error ? error.message : String(error),
      source: "app-server"
    });
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

export async function interruptAppServerTurn(cwd, { threadId, turnId }) {
  if (!threadId || !turnId) {
    return {
      attempted: false,
      interrupted: false,
      transport: null,
      detail: "missing threadId or turnId"
    };
  }

  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    return {
      attempted: false,
      interrupted: false,
      transport: null,
      detail: availability.detail
    };
  }

  let client = null;
  try {
    client = await CodexAppServerClient.connect(cwd, { reuseExistingBroker: true });
    await client.request("turn/interrupt", { threadId, turnId });
    return {
      attempted: true,
      interrupted: true,
      transport: client.transport,
      detail: `Interrupted ${turnId} on ${threadId}.`
    };
  } catch (error) {
    return {
      attempted: true,
      interrupted: false,
      transport: client?.transport ?? null,
      detail: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await client?.close().catch(() => {});
  }
}

export async function runAppServerReview(cwd, options = {}) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error("Codex CLI is not installed or is missing required runtime support. Install it with `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, then rerun `/codex-setup`.");
  }

  return withAppServer(cwd, async (client) => {
    emitProgress(options.onProgress, "Starting Codex review thread.", "starting");
    const thread = await startThread(client, cwd, {
      model: options.model,
      serviceTier: options.serviceTier,
      sandbox: "read-only",
      ephemeral: true,
      threadName: options.threadName
    });
    const sourceThreadId = thread.thread.id;
    emitProgress(options.onProgress, `Thread ready (${sourceThreadId}).`, "starting", {
      threadId: sourceThreadId
    });
    const delivery = options.delivery ?? "inline";

    const turnState = await captureTurn(
      client,
      sourceThreadId,
      () =>
        client.request("review/start", {
          threadId: sourceThreadId,
          delivery,
          target: options.target
        }),
      {
        onProgress: options.onProgress,
        onResponse(response, state) {
          if (response.reviewThreadId) {
            state.threadIds.add(response.reviewThreadId);
            if (delivery === "detached") {
              state.threadId = response.reviewThreadId;
            }
          }
        }
      }
    );

    return {
      status: buildResultStatus(turnState),
      threadId: turnState.threadId,
      sourceThreadId,
      turnId: turnState.turnId,
      reviewText: turnState.reviewText,
      reasoningSummary: turnState.reasoningSummary,
      turn: turnState.finalTurn,
      error: turnState.error,
      stderr: cleanCodexStderr(client.stderr)
    };
  });
}

export async function runAppServerTurn(cwd, options = {}) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error("Codex CLI is not installed or is missing required runtime support. Install it with `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, then rerun `/codex-setup`.");
  }

  return withAppServer(cwd, async (client) => {
    let threadId;

    if (options.resumeThreadId) {
      emitProgress(options.onProgress, `Resuming thread ${options.resumeThreadId}.`, "starting");
      const response = await resumeThread(client, options.resumeThreadId, cwd, {
        model: options.model,
        serviceTier: options.serviceTier,
        sandbox: options.sandbox,
        ephemeral: false
      });
      threadId = response.thread.id;
    } else {
      emitProgress(options.onProgress, "Starting Codex task thread.", "starting");
      const response = await startThread(client, cwd, {
        model: options.model,
        serviceTier: options.serviceTier,
        sandbox: options.sandbox,
        ephemeral: options.persistThread ? false : true,
        threadName: options.persistThread ? options.threadName : options.threadName ?? null
      });
      threadId = response.thread.id;
    }

    emitProgress(options.onProgress, `Thread ready (${threadId}).`, "starting", {
      threadId
    });

    const prompt = options.prompt?.trim() || options.defaultPrompt || "";
    if (!prompt) {
      throw new Error("A prompt is required for this Codex run.");
    }

    const turnState = await captureTurn(
      client,
      threadId,
      () =>
        client.request("turn/start", {
          threadId,
          input: buildTurnInput(prompt),
          model: options.model ?? null,
          ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
          effort: options.effort ?? null,
          outputSchema: options.outputSchema ?? null
        }),
      { onProgress: options.onProgress }
    );

    return {
      status: buildResultStatus(turnState),
      threadId,
      turnId: turnState.turnId,
      finalMessage: turnState.lastAgentMessage,
      reasoningSummary: turnState.reasoningSummary,
      turn: turnState.finalTurn,
      error: turnState.error,
      stderr: cleanCodexStderr(client.stderr),
      fileChanges: turnState.fileChanges,
      touchedFiles: collectTouchedFiles(turnState.fileChanges),
      commandExecutions: turnState.commandExecutions
    };
  });
}

export async function readAppServerThread(cwd, options = {}) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error("Codex CLI is not installed or is missing required runtime support. Install it with `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, then rerun `/codex-setup`.");
  }

  const threadId = parseCodexThreadRef(options.threadId);
  if (!threadId) {
    throw new Error("Provide a Codex thread ID or `codex://threads/<thread-id>` deeplink.");
  }

  const all = Boolean(options.all);
  const includeTools = Boolean(options.includeTools);
  const limit = all ? null : options.limit ?? DEFAULT_READ_LIMIT;

  return withReadOnlyAppServer(cwd, async (client) => {
    const metaResponse = await client.request("thread/read", {
      threadId,
      includeTurns: false
    });
    let thread = metaResponse?.thread ?? null;
    if (!thread) {
      throw new Error(`Codex thread "${threadId}" was not found.`);
    }

    let historySource = "legacy";
    let history;
    if (thread.historyMode === "paginated") {
      try {
        history = await fetchPaginatedTurnsHistory(client, threadId, { all, limit });
        historySource = "paginated";
      } catch (error) {
        if (!isUnsupportedRpcMethodError(error)) {
          throw error;
        }
        const legacy = await fetchLegacyTurnsHistory(client, threadId, { all, limit });
        thread = legacy.thread ?? thread;
        history = legacy;
        historySource = "legacy";
      }
    } else {
      const legacy = await fetchLegacyTurnsHistory(client, threadId, { all, limit });
      thread = legacy.thread ?? thread;
      history = legacy;
      historySource = "legacy";
    }

    const turns = history.turns.map((turn, offset) =>
      normalizeReadTurn(turn, history.startIndex + offset, { includeTools })
    );

    return {
      threadId: thread.id ?? threadId,
      deeplink: `codex://threads/${thread.id ?? threadId}`,
      resumeCommand: `codex resume ${thread.id ?? threadId}`,
      historySource,
      includeTools,
      thread: {
        id: thread.id ?? threadId,
        sessionId: thread.sessionId ?? null,
        name: thread.name ?? null,
        preview: thread.preview ?? "",
        cwd: thread.cwd ?? null,
        status: formatThreadStatus(thread.status),
        historyMode: thread.historyMode ?? null,
        modelProvider: thread.modelProvider ?? null,
        model: thread.model ?? null,
        reasoningEffort: thread.reasoningEffort ?? null,
        source: formatSessionSource(thread.source),
        cliVersion: thread.cliVersion ?? null,
        originator: thread.originator ?? null,
        ephemeral: Boolean(thread.ephemeral),
        createdAt: formatUnixTimestampIso(thread.createdAt),
        updatedAt: formatUnixTimestampIso(thread.updatedAt),
        gitInfo: thread.gitInfo ?? null
      },
      pagination: {
        limit,
        all,
        returnedTurns: turns.length,
        totalTurns: history.totalTurns,
        hasMore: Boolean(history.hasMore)
      },
      turns
    };
  });
}

export async function findLatestTaskThread(cwd) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error("Codex CLI is not installed or is missing required runtime support. Install it with `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, then rerun `/codex-setup`.");
  }

  return withAppServer(cwd, async (client) => {
    const response = await client.request("thread/list", {
      cwd,
      limit: 20,
      sortKey: "updated_at",
      sourceKinds: ["appServer"],
      searchTerm: TASK_THREAD_PREFIX
    });

    return (
      response.data.find((thread) => typeof thread.name === "string" && thread.name.startsWith(TASK_THREAD_PREFIX)) ??
      null
    );
  });
}

export function buildPersistentTaskThreadName(prompt) {
  return buildTaskThreadName(prompt);
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Codex did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export { DEFAULT_CONTINUE_PROMPT, DEFAULT_READ_LIMIT, TASK_THREAD_PREFIX };
