import fs from "node:fs";

const MAX_EXCERPT_CHARS = 1200;
const MAX_HANDOFF_TURNS = 12;

function stripUserRequestTags(text) {
  return String(text ?? "")
    .replace(/<USER_REQUEST>\s*/g, "")
    .replace(/\s*<\/USER_REQUEST>[\s\S]*$/g, "")
    .trim();
}

function truncateText(text, limit = MAX_EXCERPT_CHARS) {
  const normalized = String(text ?? "").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 16)}\n...[truncated]`;
}

function readTranscriptEntries(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return [];
  }
  const raw = fs.readFileSync(transcriptPath, "utf8");
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines.
    }
  }
  return entries;
}

export function extractLastAssistantMessageFromTranscript(transcriptPath) {
  const entries = readTranscriptEntries(transcriptPath);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type === "PLANNER_RESPONSE" && typeof entry.content === "string" && entry.content.trim()) {
      return entry.content.trim();
    }
    if (entry?.type === "assistant" && typeof entry?.message?.content === "string" && entry.message.content.trim()) {
      return entry.message.content.trim();
    }
  }
  return "";
}

export function extractAgyTranscriptHandoff(transcriptPath, options = {}) {
  const maxTurns = options.maxTurns ?? MAX_HANDOFF_TURNS;
  const entries = readTranscriptEntries(transcriptPath);
  const turns = [];

  for (const entry of entries) {
    if (entry?.type === "USER_INPUT" && typeof entry.content === "string") {
      const text = stripUserRequestTags(entry.content);
      if (text) {
        turns.push({ role: "User", text: truncateText(text) });
      }
      continue;
    }
    if (entry?.type === "PLANNER_RESPONSE" && typeof entry.content === "string" && entry.content.trim()) {
      turns.push({ role: "Assistant", text: truncateText(entry.content) });
    }
  }

  if (turns.length === 0) {
    return "";
  }

  const recent = turns.slice(-maxTurns);
  return recent.map((turn, index) => `### Turn ${index + 1} (${turn.role})\n${turn.text}`).join("\n\n");
}
