import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import { Readable } from "node:stream";

// Codex hook response format differs from Claude Code:
// allow → {} (empty object)
// deny  → {"permissionDecision":"deny","stopReason":"..."}
const CODEX_HOOK_SCRIPT = `#!/bin/bash
# AgentHub HITL hook for Codex CLI
INPUT=$(cat)

RESPONSE=$(echo "$INPUT" | curl -s -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-Run-Id: $AGENTHUB_RUN_ID" \\
  -H "X-Conv-Id: $AGENTHUB_CONV_ID" \\
  --data-binary @- \\
  "$AGENTHUB_API_URL/internal/hook/approval")

APPROVAL_ID=$(echo "$RESPONSE" | grep -o '"approvalId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$APPROVAL_ID" ]; then
  echo '{"permissionDecision":"deny","stopReason":"Failed to create approval request"}'
  exit 0
fi

for i in $(seq 1 120); do
  STATUS=$(curl -s "$AGENTHUB_API_URL/approvals/$APPROVAL_ID" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$STATUS" != "pending" ]; then
    if [ "$STATUS" = "approved" ]; then
      echo '{}'
    else
      echo '{"permissionDecision":"deny","stopReason":"User rejected this tool call"}'
    fi
    exit 0
  fi
  sleep 5
done

echo '{"permissionDecision":"deny","stopReason":"Approval timed out"}'
exit 0
`;
import {
  AgentRuntime,
  RuntimeCompletion,
  RuntimeEventHandler,
  RuntimeRunHandle,
  RuntimeStartInput,
} from "../base/agent-runtime.js";
import { EnvConfig } from "../../config/env.js";
import { CodexEventParser } from "./codex-event-parser.js";

export class CodexCliRuntime implements AgentRuntime {
  readonly displayName = "Codex CLI";
  readonly capabilities = ["planning", "text_generation", "tool_use", "file_editing"];

  private readonly activeRuns = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();

  constructor(private readonly env: EnvConfig) {}

  async startRun(
    input: RuntimeStartInput,
    handler: RuntimeEventHandler,
  ): Promise<RuntimeRunHandle> {
    const command =
      typeof input.agentConfig?.command === "string"
        ? String(input.agentConfig.command)
        : this.env.codexCommand;
    const baseArgs = Array.isArray(input.agentConfig?.baseArgs)
      ? (input.agentConfig.baseArgs as string[])
      : this.env.codexBaseArgs;

    const hitlEnabled =
      input.agentConfig?.hitlEnabled === true ||
      (input.agentConfig?.hitlEnabled === undefined && this.env.hitlEnabled);

    // Replace -a never with full-auto so Codex doesn't block on stdin;
    // our hook handles the approval gate instead.
    const effectiveBaseArgs = hitlEnabled
      ? baseArgs.map((a, i, arr) =>
          a === "never" && arr[i - 1] === "-a" ? "full-auto" : a,
        )
      : baseArgs;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-codex-"));
    const outputFile = path.join(tempDir, "last-message.txt");

    const args = [...effectiveBaseArgs, "-C", input.workspacePath, "exec"];
    if (input.resumeSessionId) {
      args.push("resume", "--json", "--skip-git-repo-check", "-o", outputFile, input.resumeSessionId, input.prompt);
    } else {
      args.push("--json", "--skip-git-repo-check", "-o", outputFile, input.prompt);
    }

    const spawnEnv = { ...process.env };
    if (hitlEnabled) {
      this.writeCodexHitlHook(input.workspacePath);
      spawnEnv.AGENTHUB_RUN_ID = input.runId;
      spawnEnv.AGENTHUB_CONV_ID = input.conversationId;
      spawnEnv.AGENTHUB_API_URL = this.env.apiBaseUrl;
    }

    const child = spawn(command, args, {
      cwd: input.workspacePath,
      env: spawnEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.activeRuns.set(input.runId, child);
    const parser = new CodexEventParser();
    let latestErrorMessage: string | null = null;
    const pendingEventTasks = new Set<Promise<void>>();

    const queueHandlerEvent = (event: Parameters<typeof handler.onEvent>[0]) => {
      const task = handler
        .onEvent(event)
        .finally(() => pendingEventTasks.delete(task));
      pendingEventTasks.add(task);
    };

    const stdoutReader = readline.createInterface({ input: child.stdout });
    const stdoutClosed = new Promise<void>((resolve) => {
      stdoutReader.once("close", () => resolve());
    });
    stdoutReader.on("line", (line) => {
      const parsedEvents = parser.parseLine(input.runId, input.conversationId, line);
      for (const event of parsedEvents) {
        queueHandlerEvent(event);
      }
    });

    const stderrReader = readline.createInterface({ input: child.stderr });
    const stderrClosed = new Promise<void>((resolve) => {
      stderrReader.once("close", () => resolve());
    });
    stderrReader.on("line", (line) => {
      if (line.trim()) {
        latestErrorMessage = line.trim();
      }
      queueHandlerEvent({
        type: "command_output",
        runId: input.runId,
        conversationId: input.conversationId,
        stream: "stderr",
        chunk: `${line}\n`,
      });
    });

    const completion = new Promise<RuntimeCompletion>((resolve) => {
      child.once("error", (error) => {
        this.activeRuns.delete(input.runId);
        resolve({
          status: "failed",
          exitCode: null,
          errorMessage: error.message,
        });
      });

      child.once("close", (code, signal) => {
        this.activeRuns.delete(input.runId);
        void Promise.allSettled([
          stdoutClosed,
          stderrClosed,
          ...Array.from(pendingEventTasks),
        ]).then(async () => {
          const finalText = this.readLastMessage(outputFile);
          if (finalText) {
            await handler.onEvent({
              type: "text_delta",
              runId: input.runId,
              conversationId: input.conversationId,
              delta: finalText,
            });
          }
          fs.rmSync(tempDir, { recursive: true, force: true });

          if (signal === "SIGINT") {
            resolve({ status: "interrupted", exitCode: code });
            return;
          }

          if ((code ?? 1) === 0) {
            resolve({ status: "completed", exitCode: code ?? 0 });
            return;
          }

          resolve({
            status: "failed",
            exitCode: code,
            errorMessage:
              latestErrorMessage ??
              `Codex CLI exited with code ${code ?? "unknown"}`,
          });
        });
      });
    });

    return {
      pid: child.pid,
      completion,
    };
  }

  async interruptRun(runId: string): Promise<void> {
    const child = this.activeRuns.get(runId);
    if (!child) {
      throw new Error("Run is not active");
    }
    child.kill("SIGINT");
  }

  checkAvailabilitySync() {
    const executablePath = this.env.codexCommand;
    try {
      const result = spawnSync(executablePath, ["--version"], {
        encoding: "utf8",
      });
      return this.mapCheckResult(
        executablePath,
        result.status ?? null,
        result.stdout,
        result.stderr,
        result.error,
      );
    } catch (error) {
      return {
        adapterType: "codex_cli",
        available: false,
        message: error instanceof Error ? error.message : "Codex CLI check failed",
        version: null,
        executablePath,
      };
    }
  }

  async checkAvailability() {
    const executablePath = this.env.codexCommand;
    try {
      const result = await this.runVersionCheck(executablePath);
      return this.mapCheckResult(
        executablePath,
        result.status,
        result.stdout,
        result.stderr,
        result.error,
      );
    } catch (error) {
      return {
        adapterType: "codex_cli",
        available: false,
        message: error instanceof Error ? error.message : "Codex CLI check failed",
        version: null,
        executablePath,
      };
    }
  }

  private runVersionCheck(executablePath: string): Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
    error?: Error;
  }> {
    return new Promise((resolve) => {
      const child = spawn(executablePath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (result: {
        status: number | null;
        stdout: string;
        stderr: string;
        error?: Error;
      }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", (error) => {
        finish({ status: null, stdout, stderr, error });
      });
      child.once("close", (code) => {
        finish({ status: code, stdout, stderr });
      });
    });
  }

  private mapCheckResult(
    executablePath: string,
    status: number | null,
    stdout: string | null | undefined,
    stderr: string | null | undefined,
    error?: Error,
  ) {
    if (error) {
      return {
        adapterType: "codex_cli",
        available: false,
        message: error.message,
        version: null,
        executablePath,
      };
    }
    if ((status ?? 1) !== 0) {
      return {
        adapterType: "codex_cli",
        available: false,
        message: (stderr || stdout || "Codex CLI check failed").trim(),
        version: null,
        executablePath,
      };
    }
    return {
      adapterType: "codex_cli",
      available: true,
      version: (stdout || stderr || "").trim() || null,
      executablePath,
    };
  }

  private writeCodexHitlHook(workspacePath: string): void {
    const hooksDir = path.join(workspacePath, ".codex", "hooks");
    const scriptPath = path.join(hooksDir, "agenthub-approval.sh");
    const configPath = path.join(workspacePath, ".codex", "hooks.json");

    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(scriptPath, CODEX_HOOK_SCRIPT, { mode: 0o755 });

    const config = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|shell|exec",
            hooks: [
              {
                type: "command",
                command: scriptPath,
                timeout: 600,
              },
            ],
          },
        ],
      },
    };

    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      // no existing config
    }

    const merged = { ...existing, hooks: config.hooks };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  }

  private readLastMessage(outputFile: string): string | null {
    try {
      if (!fs.existsSync(outputFile)) {
        return null;
      }
      const content = fs.readFileSync(outputFile, "utf8").trim();
      return content || null;
    } catch {
      return null;
    }
  }
}
