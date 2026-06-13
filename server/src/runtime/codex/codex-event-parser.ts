import { RuntimeEvent } from "../../shared/types.js";

type JsonObject = Record<string, unknown>;

interface ToolState {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  partialJson: string;
  completed: boolean;
  resultSeen: boolean;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asObject(parsed);
    } catch {
      return null;
    }
  }
  return asObject(value);
}

function stringifyPreview(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function summarizeText(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const array = asArray(value);
  if (array) {
    return array.map((entry) => extractText(entry)).filter(Boolean).join("\n");
  }
  const object = asObject(value);
  if (!object) {
    return "";
  }

  const direct =
    asString(object.text) ??
    asString(object.content) ??
    asString(object.output_text) ??
    asString(object.output) ??
    asString(object.result) ??
    asString(object.message);
  if (direct) {
    return direct;
  }

  if (object.type === "text" && typeof object.text === "string") {
    return object.text;
  }

  const content = asArray(object.content);
  if (content) {
    return content.map((entry) => extractText(entry)).filter(Boolean).join("\n");
  }

  return "";
}

function getToolCandidate(event: JsonObject): {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  partialJson: string;
  resultText: string;
  completed: boolean;
} | null {
  const sources = [
    asObject(event.item),
    asObject(asObject(event.delta)?.item),
    asObject(event.call),
    asObject(event.tool),
  ].filter((value): value is JsonObject => value !== null);

  for (const source of sources) {
    const itemType =
      asString(source.type) ??
      asString(source.kind) ??
      asString(source.item_type) ??
      "";
    const toolName =
      asString(source.name) ??
      asString(source.tool_name) ??
      (typeof source.command === "string" ? "shell" : null) ??
      null;
    const toolUseId =
      asString(source.id) ??
      asString(source.call_id) ??
      asString(source.tool_call_id) ??
      null;
    const input =
      parseJsonObject(source.input) ??
      parseJsonObject(source.arguments) ??
      parseJsonObject(source.args) ??
      {};

    if (typeof source.command === "string" && !("command" in input)) {
      input.command = source.command;
    }
    if (typeof source.path === "string" && !("path" in input)) {
      input.path = source.path;
    }

    const partialJson =
      stringifyPreview(source.arguments) ||
      stringifyPreview(source.input) ||
      stringifyPreview(source.args);
    const resultText =
      extractText(source.output) ||
      extractText(source.result) ||
      extractText(source.content) ||
      extractText(source.stdout) ||
      extractText(source.stderr);
    const completed =
      event.type === "item.completed" ||
      event.type === "item.done" ||
      event.type === "tool.completed";

    const toolLike =
      Boolean(toolName && toolUseId) ||
      /tool|function|shell|patch|exec|command/i.test(itemType);

    if (!toolLike) {
      continue;
    }

    return {
      toolUseId: toolUseId ?? `${(toolName ?? itemType) || "tool"}-${Math.random().toString(36).slice(2, 8)}`,
      toolName: (toolName ?? itemType) || "tool",
      input,
      partialJson,
      resultText,
      completed,
    };
  }

  return null;
}

export class CodexEventParser {
  private emittedThreadId: string | null = null;
  private readonly toolsById = new Map<string, ToolState>();

  parseLine(runId: string, conversationId: string, line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: JsonObject | null = null;
    try {
      parsed = JSON.parse(trimmed) as JsonObject;
    } catch {
      return [];
    }

    const events: RuntimeEvent[] = [];
    const eventType = asString(parsed.type) ?? "";

    if (eventType === "thread.started") {
      const threadId = asString(parsed.thread_id);
      if (threadId && threadId !== this.emittedThreadId) {
        this.emittedThreadId = threadId;
        events.push({
          type: "session_bound",
          runId,
          conversationId,
          sessionId: threadId,
        });
      }
    }

    const tool = getToolCandidate(parsed);
    if (tool) {
      const existing = this.toolsById.get(tool.toolUseId);
      const state =
        existing ??
        {
          toolUseId: tool.toolUseId,
          toolName: tool.toolName,
          input: tool.input,
          partialJson: "",
          completed: false,
          resultSeen: false,
        };

      state.input = Object.keys(tool.input).length > 0 ? tool.input : state.input;

      if (!existing) {
        this.toolsById.set(tool.toolUseId, state);
        events.push({
          type: "tool_started",
          runId,
          conversationId,
          toolUseId: state.toolUseId,
          toolName: state.toolName,
        });
      }

      if (tool.partialJson && tool.partialJson !== state.partialJson) {
        state.partialJson = tool.partialJson;
        events.push({
          type: "tool_input_delta",
          runId,
          conversationId,
          toolUseId: state.toolUseId,
          toolName: state.toolName,
          partialJson: tool.partialJson,
          parsedInput: state.input,
        });
      }

      if (tool.completed && !state.completed) {
        state.completed = true;
        events.push({
          type: "tool_completed",
          runId,
          conversationId,
          toolUseId: state.toolUseId,
          toolName: state.toolName,
          input: state.input,
        });
      }

      if (tool.resultText && !state.resultSeen) {
        state.resultSeen = true;
        events.push({
          type: "tool_result",
          runId,
          conversationId,
          toolUseId: state.toolUseId,
          toolName: state.toolName,
          summary: summarizeText(tool.resultText),
          content: tool.resultText,
          isError: false,
        });
      }
    }

    if (/approval|permission/i.test(JSON.stringify(parsed))) {
      events.push({
        type: "approval_required",
        runId,
        conversationId,
        reason:
          asString(parsed.message) ??
          asString(asObject(parsed.error)?.message) ??
          "Codex CLI requested approval",
        rawEvent: parsed,
      });
    }

    const text = extractText(parsed);
    if (text && !tool) {
      events.push({
        type: "text_delta",
        runId,
        conversationId,
        delta: text,
      });
    }

    return events;
  }
}
