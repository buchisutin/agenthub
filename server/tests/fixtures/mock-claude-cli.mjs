import process from "node:process";

const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1] ?? "";
const resumeIndex = argv.indexOf("--resume");
const resumeSessionId =
  resumeIndex >= 0 && typeof argv[resumeIndex + 1] === "string"
    ? argv[resumeIndex + 1]
    : null;
const SESSION_ID = "mock-session-1";

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("SIGINT", () => {
  process.exit(130);
});

async function main() {
  if (resumeSessionId && resumeSessionId !== SESSION_ID) {
    process.stdout.write(
      `No conversation found with session ID: ${resumeSessionId}\n`,
    );
    writeJson({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "mock-invalid-session",
      errors: [`No conversation found with session ID: ${resumeSessionId}`],
    });
    process.exit(1);
    return;
  }

  if (prompt.includes("fail")) {
    process.stderr.write("mock cli failed\n");
    process.exit(1);
    return;
  }

  writeJson({
    type: "system",
    subtype: "init",
    session_id: SESSION_ID,
  });

  writeJson({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "toolu_mock_read",
        name: "Read",
      },
    },
  });
  writeJson({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: "{\"file_path\":\"server/src/main.ts\"}",
      },
    },
  });
  writeJson({
    type: "stream_event",
    event: {
      type: "content_block_stop",
      index: 0,
    },
  });
  writeJson({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_mock_read",
          content: "import express from \"express\";\nconsole.log(\"hello\");\n",
        },
      ],
    },
  });

  writeJson({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello " },
    },
  });
  await sleep(prompt.includes("slow") ? 1200 : 50);
  writeJson({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "world" },
    },
  });
  await sleep(prompt.includes("slow") ? 1200 : 50);
  writeJson({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: SESSION_ID,
    result: "hello world",
  });
  process.exit(0);
}

main();
