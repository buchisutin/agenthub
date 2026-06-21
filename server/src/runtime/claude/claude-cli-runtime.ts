import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import { Readable } from "node:stream";
import {
  AgentRuntime,
  RuntimeCompletion,
  RuntimeEventHandler,
  RuntimeRunHandle,
  RuntimeStartInput,
} from "../base/agent-runtime.js";
import { EnvConfig } from "../../config/env.js";
import { ClaudeEventParser } from "./claude-event-parser.js";

const HOOK_SCRIPT = `#!/bin/bash
# AgentHub HITL hook — blocks tool use until a human approves or rejects it.
INPUT=$(cat)

RESPONSE=$(echo "$INPUT" | curl -s -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-Run-Id: $AGENTHUB_RUN_ID" \\
  -H "X-Conv-Id: $AGENTHUB_CONV_ID" \\
  --data-binary @- \\
  "$AGENTHUB_API_URL/internal/hook/approval")

APPROVAL_ID=$(echo "$RESPONSE" | grep -o '"approvalId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$APPROVAL_ID" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Failed to create approval request"}}'
  exit 0
fi

for i in $(seq 1 120); do
  STATUS=$(curl -s "$AGENTHUB_API_URL/approvals/$APPROVAL_ID" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$STATUS" != "pending" ]; then
    if [ "$STATUS" = "approved" ]; then
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
    else
      echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"User rejected this tool call"}}'
    fi
    exit 0
  fi
  sleep 5
done

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Approval timed out"}}'
exit 0
`;

export class ClaudeCliRuntime implements AgentRuntime {
  readonly displayName = "Claude Code";
  readonly capabilities = ["planning", "text_generation", "tool_use", "file_editing"];

  private static readonly REQUIRED_ALLOWED_TOOLS = [
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
  ];

  private readonly activeRuns = new Map<
    string,
    ChildProcessByStdio<null, Readable, Readable>
  >();

  constructor(private readonly env: EnvConfig) {}

  async startRun(
    input: RuntimeStartInput,
    handler: RuntimeEventHandler,
  ): Promise<RuntimeRunHandle> {
    const baseArgs = Array.isArray(input.agentConfig?.baseArgs)
      ? (input.agentConfig?.baseArgs as string[])
      : this.env.claudeBaseArgs;
    const command =
      typeof input.agentConfig?.command === "string"
        ? String(input.agentConfig.command)
        : this.env.claudeCommand;
    const allowedTools = this.mergeToolRules(
      this.env.claudeAllowedTools,
      Array.isArray(input.agentConfig?.allowedTools)
        ? (input.agentConfig.allowedTools as string[])
        : [],
      ClaudeCliRuntime.REQUIRED_ALLOWED_TOOLS,
    );
    const disallowedTools = this.mergeToolRules(
      this.env.claudeDisallowedTools,
      Array.isArray(input.agentConfig?.disallowedTools)
        ? (input.agentConfig.disallowedTools as string[])
        : [],
    );

    const hitlEnabled =
      input.agentConfig?.hitlEnabled === true ||
      (input.agentConfig?.hitlEnabled === undefined && this.env.hitlEnabled);

    const effectiveBaseArgs = hitlEnabled
      ? baseArgs.filter((a) => a !== "--bare")
      : baseArgs;

    const args = [...effectiveBaseArgs];
    if (input.resumeSessionId) {
      args.push("--resume", input.resumeSessionId);
    }
    if (allowedTools.length > 0) {
      args.push("--allowedTools", allowedTools.join(","));
    }
    if (disallowedTools.length > 0) {
      args.push("--disallowedTools", disallowedTools.join(","));
    }
    args.push("--");
    args.push(input.prompt);

    const spawnEnv = { ...process.env };
    if (hitlEnabled) {
      this.writeHitlHook(input.workspacePath);
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
    const parser = new ClaudeEventParser();
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
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("{")) {
        latestErrorMessage = trimmed;
      }
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
      let interrupted = false;

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
        ]).then(() => {
          if (signal === "SIGINT") {
            interrupted = true;
          }

          if (interrupted) {
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
              `Claude CLI exited with code ${code ?? "unknown"}`,
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
    const executablePath = this.env.claudeCommand;
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
        adapterType: "claude_cli",
        available: false,
        message: error instanceof Error ? error.message : "Claude CLI check failed",
        version: null,
        executablePath,
      };
    }
  }

  async checkAvailability() {
    const executablePath = this.env.claudeCommand;
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
        adapterType: "claude_cli",
        available: false,
        message: error instanceof Error ? error.message : "Claude CLI check failed",
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
        adapterType: "claude_cli",
        available: false,
        message: error.message,
        version: null,
        executablePath,
      };
    }
    if ((status ?? 1) !== 0) {
      const message = (stderr || stdout || "Claude CLI check failed").trim();
      return {
        adapterType: "claude_cli",
        available: false,
        message,
        version: null,
        executablePath,
      };
    }

    const version = (stdout || stderr || "").trim() || null;
    return {
      adapterType: "claude_cli",
      available: true,
      version,
      executablePath,
    };
  }

  private writeHitlHook(workspacePath: string): void {
    const hooksDir = path.join(workspacePath, ".claude", "hooks");
    const scriptPath = path.join(hooksDir, "agenthub-approval.sh");
    const settingsPath = path.join(workspacePath, ".claude", "settings.json");

    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(scriptPath, HOOK_SCRIPT, { mode: 0o755 });

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|Write|Edit|MultiEdit",
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

    // Merge with existing settings if present
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      // no existing settings
    }

    const merged = { ...existing, hooks: settings.hooks };
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  }

  private mergeToolRules(...groups: string[][]): string[] {
    const merged = new Set<string>();
    for (const group of groups) {
      for (const tool of group) {
        const normalized = tool.trim();
        if (normalized) {
          merged.add(normalized);
        }
      }
    }
    return Array.from(merged);
  }
}
