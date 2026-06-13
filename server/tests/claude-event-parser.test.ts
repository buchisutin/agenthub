import { describe, expect, it } from "vitest";
import { ClaudeEventParser } from "../src/runtime/claude/claude-event-parser.js";

describe("ClaudeEventParser", () => {
  it("emits session_bound once from stream-json output", () => {
    const parser = new ClaudeEventParser();

    const first = parser.parseLine(
      "run-session",
      "conv-session",
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "session-123",
      }),
    );
    expect(first).toEqual([
      {
        type: "session_bound",
        runId: "run-session",
        conversationId: "conv-session",
        sessionId: "session-123",
      },
    ]);

    const second = parser.parseLine(
      "run-session",
      "conv-session",
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "session-123",
      }),
    );
    expect(second).toEqual([]);
  });

  it("builds a complete tool lifecycle from stream-json events", () => {
    const parser = new ClaudeEventParser();
    const runId = "run-1";
    const conversationId = "conv-1";

    const startEvents = parser.parseLine(
      runId,
      conversationId,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_read",
            name: "Read",
          },
        },
      }),
    );
    expect(startEvents).toEqual([
      {
        type: "tool_started",
        runId,
        conversationId,
        toolUseId: "toolu_read",
        toolName: "Read",
      },
    ]);

    const deltaEvents = parser.parseLine(
      runId,
      conversationId,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: "{\"file_path\":\"server/src/main.ts\"}",
          },
        },
      }),
    );
    expect(deltaEvents).toEqual([
      {
        type: "tool_input_delta",
        runId,
        conversationId,
        toolUseId: "toolu_read",
        toolName: "Read",
        partialJson: "{\"file_path\":\"server/src/main.ts\"}",
        parsedInput: { file_path: "server/src/main.ts" },
      },
    ]);

    const completedEvents = parser.parseLine(
      runId,
      conversationId,
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }),
    );
    expect(completedEvents).toEqual([
      {
        type: "tool_completed",
        runId,
        conversationId,
        toolUseId: "toolu_read",
        toolName: "Read",
        input: { file_path: "server/src/main.ts" },
      },
    ]);

    const resultEvents = parser.parseLine(
      runId,
      conversationId,
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_read",
              content: "line1\nline2\n",
            },
          ],
        },
      }),
    );
    expect(resultEvents).toEqual([
      {
        type: "tool_result",
        runId,
        conversationId,
        toolUseId: "toolu_read",
        toolName: "Read",
        summary: "读取 server/src/main.ts，共 2 行",
        content: "line1\nline2\n",
        isError: false,
      },
    ]);
  });

  it("keeps text and tool events separate", () => {
    const parser = new ClaudeEventParser();
    const events = parser.parseLine(
      "run-2",
      "conv-2",
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "done" },
            {
              type: "tool_use",
              id: "toolu_bash",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
        },
      }),
    );

    expect(events).toEqual([
      {
        type: "tool_started",
        runId: "run-2",
        conversationId: "conv-2",
        toolUseId: "toolu_bash",
        toolName: "Bash",
      },
      {
        type: "tool_completed",
        runId: "run-2",
        conversationId: "conv-2",
        toolUseId: "toolu_bash",
        toolName: "Bash",
        input: { command: "npm test" },
      },
      {
        type: "text_delta",
        runId: "run-2",
        conversationId: "conv-2",
        delta: "done",
      },
    ]);
  });
});
