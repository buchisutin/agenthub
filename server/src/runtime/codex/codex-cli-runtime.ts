import fs from "node:fs";
import os from "node:os";
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

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-codex-"));
    const outputFile = path.join(tempDir, "last-message.txt");

    const args = [...baseArgs, "-C", input.workspacePath, "exec"];
    if (input.resumeSessionId) {
      args.push("resume", "--json", "--skip-git-repo-check", "-o", outputFile, input.resumeSessionId, input.prompt);
    } else {
      args.push("--json", "--skip-git-repo-check", "-o", outputFile, input.prompt);
    }

    const child = spawn(command, args, {
      cwd: input.workspacePath,
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
