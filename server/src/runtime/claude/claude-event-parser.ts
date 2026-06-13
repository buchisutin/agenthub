import { RuntimeEvent } from "../../shared/types.js";

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

interface ToolState {
  toolUseId: string;
  toolName: string;
  contentBlockIndex: number | null;
  inputBuffer: string;
  input: Record<string, unknown>;
  started: boolean;
  completed: boolean;
  resultSeen: boolean;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function asArray(value: unknown): JsonArray | null {
  return Array.isArray(value) ? value : null;
}

function collectMessageContentBlocks(event: JsonObject): JsonObject[] {
  const message = asObject(event.message);
  const content = message ? asArray(message.content) : null;
  if (!content) {
    return [];
  }

  return content
    .map((item) => asObject(item))
    .filter((item): item is JsonObject => item !== null);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

function toContentString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const arrayValue = asArray(value);
  if (!arrayValue) {
    return "";
  }

  return arrayValue
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const block = asObject(item);
      if (!block) {
        return "";
      }
      if (typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function lineCount(value: string): number {
  if (!value) {
    return 0;
  }
  return value.replace(/\n$/, "").split("\n").length;
}

function trimForSummary(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildInputPreview(
  toolName: string,
  input: Record<string, unknown>,
  partialJson: string,
): string {
  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : null;
  if (filePath) {
    return filePath;
  }

  const command =
    typeof input.command === "string"
      ? input.command
      : typeof input.cmd === "string"
        ? input.cmd
        : null;
  if (command) {
    return command;
  }

  if (toolName === "Read" && partialJson.trim()) {
    return trimForSummary(partialJson, 60);
  }

  return "";
}

function buildToolSummary(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
): string {
  const filePath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : null;

  if (toolName === "Read") {
    if (filePath) {
      const lines = lineCount(content);
      return lines > 0 ? `读取 ${filePath}，共 ${lines} 行` : `读取 ${filePath}`;
    }
    return "读取文件完成";
  }

  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "命令";
    const lines = lineCount(content);
    return lines > 0
      ? `${command} 执行完成，输出 ${lines} 行`
      : `${command} 执行完成`;
  }

  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
    if (filePath) {
      return `已更新 ${filePath}`;
    }
    return `${toolName} 执行完成`;
  }

  if (filePath) {
    return `${toolName} ${filePath}`;
  }

  return `${toolName} 执行完成`;
}

function pickApprovalReason(event: JsonObject): string | null {
  if (typeof event.reason === "string") {
    return event.reason;
  }
  if (typeof event.message === "string") {
    return event.message;
  }

  const message = asObject(event.message);
  if (message && typeof message.content === "string") {
    return message.content;
  }

  return null;
}

export class ClaudeEventParser {
  private readonly toolsById = new Map<string, ToolState>();
  private readonly toolIdByContentBlock = new Map<number, string>();
  private emittedSessionId: string | null = null;

  parseLine(runId: string, conversationId: string, line: string): RuntimeEvent[] {
    const trimmed = line.trim();
    if (!trimmed) {
      return [];
    }

    let parsed: JsonObject | null = null;
    try {
      parsed = JSON.parse(trimmed) as JsonObject;
    } catch {
      return [
        {
          type: "text_delta",
          runId,
          conversationId,
          delta: `${line}\n`,
        },
      ];
    }

    const events: RuntimeEvent[] = [];
    this.collectSessionEvents(runId, conversationId, parsed, events);
    this.collectToolLifecycleEvents(runId, conversationId, parsed, events);
    this.collectToolResultEvents(runId, conversationId, parsed, events);
    this.collectTextEvents(runId, conversationId, parsed, events);
    this.collectApprovalEvents(runId, conversationId, parsed, events);
    return events;
  }

  private collectSessionEvents(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    const sessionId = typeof event.session_id === "string" ? event.session_id : null;
    if (!sessionId || sessionId === this.emittedSessionId) {
      return;
    }

    this.emittedSessionId = sessionId;
    output.push({
      type: "session_bound",
      runId,
      conversationId,
      sessionId,
    });
  }

  private collectTextEvents(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    const deltas = new Set<string>();

    if (typeof event.text === "string" && event.text.trim() !== "") {
      deltas.add(event.text);
    }
    if (typeof event.delta === "string" && event.delta.trim() !== "") {
      deltas.add(event.delta);
    }
    if (typeof event.result === "string" && event.result.trim() !== "") {
      deltas.add(event.result);
    }

    const rawEvent = asObject(event.event);
    const delta = rawEvent ? asObject(rawEvent.delta) : null;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      deltas.add(delta.text);
    }

    const message = asObject(event.message);
    if (message && typeof message.text === "string" && message.text.trim() !== "") {
      deltas.add(message.text);
    }

    for (const block of collectMessageContentBlocks(event)) {
      if (block.type === "text" && typeof block.text === "string") {
        deltas.add(block.text);
      }
    }

    for (const deltaText of deltas) {
      output.push({
        type: "text_delta",
        runId,
        conversationId,
        delta: deltaText,
      });
    }
  }

  private collectApprovalEvents(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    const serialized = JSON.stringify(event);
    const type = typeof event.type === "string" ? event.type : "";
    if (!/approval|permission/i.test(type || serialized)) {
      return;
    }

    output.push({
      type: "approval_required",
      runId,
      conversationId,
      reason: pickApprovalReason(event) ?? "Claude CLI requested approval",
      rawEvent: event,
    });
  }

  private collectToolLifecycleEvents(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    const rawEvent = asObject(event.event);
    if (!rawEvent) {
      this.collectToolUseBlocksFromMessage(runId, conversationId, event, output);
      return;
    }

    if (rawEvent.type === "content_block_start") {
      const contentBlock = asObject(rawEvent.content_block);
      if (!contentBlock || contentBlock.type !== "tool_use") {
        return;
      }

      const contentBlockIndex =
        typeof rawEvent.index === "number" ? rawEvent.index : null;
      const toolUseId =
        typeof contentBlock.id === "string"
          ? contentBlock.id
          : `tool-${contentBlockIndex ?? this.toolsById.size + 1}`;
      const toolName =
        typeof contentBlock.name === "string" ? contentBlock.name : "Tool";
      const input = asObject(contentBlock.input) ?? {};

      const toolState = this.ensureToolState(toolUseId, toolName, contentBlockIndex);
      toolState.input = input;
      if (!toolState.started) {
        toolState.started = true;
        output.push({
          type: "tool_started",
          runId,
          conversationId,
          toolUseId,
          toolName,
        });
      }
      return;
    }

    if (rawEvent.type === "content_block_delta") {
      const delta = asObject(rawEvent.delta);
      if (!delta || delta.type !== "input_json_delta") {
        return;
      }

      const contentBlockIndex =
        typeof rawEvent.index === "number" ? rawEvent.index : null;
      if (contentBlockIndex === null) {
        return;
      }

      const toolUseId = this.toolIdByContentBlock.get(contentBlockIndex);
      if (!toolUseId) {
        return;
      }

      const toolState = this.toolsById.get(toolUseId);
      if (!toolState) {
        return;
      }

      const partialJson =
        typeof delta.partial_json === "string" ? delta.partial_json : "";
      toolState.inputBuffer += partialJson;
      const parsedInput = parseJsonObject(toolState.inputBuffer);
      if (parsedInput) {
        toolState.input = parsedInput;
      }

      output.push({
        type: "tool_input_delta",
        runId,
        conversationId,
        toolUseId: toolState.toolUseId,
        toolName: toolState.toolName,
        partialJson,
        parsedInput: parsedInput ?? undefined,
      });
      return;
    }

    if (rawEvent.type === "content_block_stop") {
      const contentBlockIndex =
        typeof rawEvent.index === "number" ? rawEvent.index : null;
      if (contentBlockIndex === null) {
        return;
      }

      const toolUseId = this.toolIdByContentBlock.get(contentBlockIndex);
      if (!toolUseId) {
        return;
      }

      const toolState = this.toolsById.get(toolUseId);
      if (!toolState || toolState.completed) {
        return;
      }

      toolState.completed = true;
      output.push({
        type: "tool_completed",
        runId,
        conversationId,
        toolUseId: toolState.toolUseId,
        toolName: toolState.toolName,
        input: toolState.input,
      });
    }
  }

  private collectToolUseBlocksFromMessage(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    for (const block of collectMessageContentBlocks(event)) {
      if (block.type !== "tool_use") {
        continue;
      }

      const toolUseId =
        typeof block.id === "string" ? block.id : `tool-${this.toolsById.size + 1}`;
      const toolName = typeof block.name === "string" ? block.name : "Tool";
      const input = asObject(block.input) ?? {};
      const toolState = this.ensureToolState(toolUseId, toolName, null);
      toolState.input = input;

      if (!toolState.started) {
        toolState.started = true;
        output.push({
          type: "tool_started",
          runId,
          conversationId,
          toolUseId,
          toolName,
        });
      }

      if (!toolState.completed) {
        toolState.completed = true;
        output.push({
          type: "tool_completed",
          runId,
          conversationId,
          toolUseId,
          toolName,
          input,
        });
      }
    }
  }

  private collectToolResultEvents(
    runId: string,
    conversationId: string,
    event: JsonObject,
    output: RuntimeEvent[],
  ) {
    for (const block of collectMessageContentBlocks(event)) {
      if (block.type !== "tool_result") {
        continue;
      }

      const toolUseId =
        typeof block.tool_use_id === "string"
          ? block.tool_use_id
          : `tool-result-${this.toolsById.size + 1}`;
      const toolState = this.toolsById.get(toolUseId);
      const toolName = toolState?.toolName ?? "Tool";
      if (toolState?.resultSeen) {
        continue;
      }

      if (toolState) {
        toolState.resultSeen = true;
      }

      const content = toContentString(block.content);
      const input = toolState?.input ?? {};
      const summary = buildToolSummary(toolName, input, content);
      const isError = Boolean(block.is_error);

      if (isError) {
        output.push({
          type: "tool_error",
          runId,
          conversationId,
          toolUseId,
          toolName,
          error: trimForSummary(content || summary),
        });
        continue;
      }

      output.push({
        type: "tool_result",
        runId,
        conversationId,
        toolUseId,
        toolName,
        summary,
        content: content || undefined,
        isError: false,
      });
    }
  }

  private ensureToolState(
    toolUseId: string,
    toolName: string,
    contentBlockIndex: number | null,
  ): ToolState {
    const existing = this.toolsById.get(toolUseId);
    if (existing) {
      if (contentBlockIndex !== null) {
        existing.contentBlockIndex = contentBlockIndex;
        this.toolIdByContentBlock.set(contentBlockIndex, toolUseId);
      }
      return existing;
    }

    const created: ToolState = {
      toolUseId,
      toolName,
      contentBlockIndex,
      inputBuffer: "",
      input: {},
      started: false,
      completed: false,
      resultSeen: false,
    };
    this.toolsById.set(toolUseId, created);
    if (contentBlockIndex !== null) {
      this.toolIdByContentBlock.set(contentBlockIndex, toolUseId);
    }
    return created;
  }
}

export function buildToolInputPreview(
  toolName: string,
  input: Record<string, unknown>,
  partialJson = "",
): string {
  return buildInputPreview(toolName, input, partialJson);
}
