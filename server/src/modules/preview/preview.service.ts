import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { PreviewStartResponse } from "../../shared/types.js";
import { RunsService } from "../runs/runs.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";

interface PreviewRecord {
  runId: string;
  port: number;
  url: string;
  process: ChildProcess;
  workspacePath: string;
  startedAt: string;
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export interface PreviewServiceDeps {
  spawnProcess?: SpawnProcess;
  waitForUrl?: (url: string, timeoutMs: number, process: ChildProcess) => Promise<void>;
  isPortAvailable?: (port: number) => Promise<boolean>;
}

function fileExists(filePath: string) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function isDirectory(filePath: string) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readPackageScripts(workspacePath: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(workspacePath, "package.json");
  if (!isFile(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
      return null;
    }
    return scripts as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function defaultIsPortAvailable(port: number): Promise<boolean> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }).catch(() => {
    throw new Error("port unavailable");
  });

  return true;
}

async function defaultWaitForUrl(
  url: string,
  timeoutMs: number,
  process: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error("Preview process exited before becoming ready");
    }

    const reachable = await new Promise<boolean>((resolve) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 500);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
    });

    if (reachable) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Preview server did not become ready within 30s");
}

export class PreviewService {
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly spawnProcess: SpawnProcess;
  private readonly waitForUrl: (url: string, timeoutMs: number, process: ChildProcess) => Promise<void>;
  private readonly isPortAvailable: (port: number) => Promise<boolean>;

  constructor(
    private readonly runsService: RunsService,
    private readonly workspacesService: WorkspacesService,
    deps: PreviewServiceDeps = {},
  ) {
    this.spawnProcess = deps.spawnProcess ?? spawn;
    this.waitForUrl = deps.waitForUrl ?? defaultWaitForUrl;
    this.isPortAvailable = deps.isPortAvailable ?? defaultIsPortAvailable;
  }

  async startPreviewForRun(runId: string): Promise<PreviewStartResponse> {
    const existing = this.previews.get(runId);
    if (existing && existing.process.exitCode === null) {
      return {
        url: existing.url,
        port: existing.port,
      };
    }
    if (existing) {
      this.previews.delete(runId);
    }

    const run = this.runsService.getById(runId);
    if (!run) {
      throw new Error("Run not found");
    }
    if (run.status !== "completed") {
      throw new Error("Preview is only available for completed runs");
    }
    if (!run.workspace_id) {
      throw new Error("Workspace not bound");
    }

    const runWorkspace = this.runsService.getRunWorkspace(runId);
    if (runWorkspace?.status === "cleaned") {
      throw new Error("Run workspace has been cleaned");
    }

    let workspacePath: string;

    const runWorkspaceIsValid =
      runWorkspace?.root_path &&
      runWorkspace.status === "ready" &&
      fileExists(path.resolve(runWorkspace.root_path)) &&
      isDirectory(path.resolve(runWorkspace.root_path));

    if (runWorkspaceIsValid && runWorkspace?.root_path) {
      workspacePath = path.resolve(runWorkspace.root_path);
    } else {
      const workspace = this.workspacesService.getById(run.workspace_id);
      if (!workspace) {
        throw new Error("Workspace not bound");
      }
      workspacePath = path.resolve(workspace.root_path);
    }
    if (!fileExists(workspacePath) || !isDirectory(workspacePath)) {
      throw new Error("Workspace path is invalid");
    }

    const port = await this.findAvailablePort();
    const url = `http://127.0.0.1:${port}`;
    const process = this.spawnPreviewProcess(workspacePath, port);
    const preview: PreviewRecord = {
      runId,
      port,
      url,
      process,
      workspacePath,
      startedAt: new Date().toISOString(),
    };
    this.previews.set(runId, preview);

    try {
      await this.waitForUrl(url, 30000, process);
      return { url, port };
    } catch (error) {
      this.killPreviewProcess(process);
      this.previews.delete(runId);
      throw error;
    }
  }

  async stopPreviewForRun(runId: string): Promise<{ ok: true }> {
    const preview = this.previews.get(runId);
    if (!preview) {
      return { ok: true };
    }

    this.killPreviewProcess(preview.process);
    this.previews.delete(runId);
    return { ok: true };
  }

  async cleanupAllPreviews(): Promise<void> {
    const runIds = Array.from(this.previews.keys());
    await Promise.all(runIds.map((runId) => this.stopPreviewForRun(runId)));
  }

  getPreview(runId: string) {
    const preview = this.previews.get(runId);
    if (!preview || preview.process.exitCode !== null) {
      return null;
    }
    return preview;
  }

  isPreviewRunning(runId: string): boolean {
    const preview = this.previews.get(runId);
    return preview !== undefined && preview.process.exitCode === null;
  }

  private async findAvailablePort(): Promise<number> {
    for (let port = 3100; port <= 3199; port += 1) {
      try {
        const available = await this.isPortAvailable(port);
        if (available) {
          return port;
        }
      } catch {
        continue;
      }
    }
    throw new Error("No preview ports available in 3100-3199");
  }

  private spawnPreviewProcess(workspacePath: string, port: number): ChildProcess {
    const packageScripts = readPackageScripts(workspacePath);
    const hasIndexHtml = isFile(path.join(workspacePath, "index.html"));

    let command: string | null = null;
    let args: string[] = [];

    if (packageScripts && typeof packageScripts.dev === "string") {
      command = "npm";
      args = ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)];
    } else if (packageScripts && typeof packageScripts.start === "string") {
      command = "npm";
      args = ["run", "start", "--", "--host", "127.0.0.1", "--port", String(port)];
    } else if (hasIndexHtml) {
      command = "npx";
      args = ["serve", "-l", String(port), workspacePath];
    }

    if (!command) {
      throw new Error("Current workspace cannot be previewed");
    }

    try {
      const child = this.spawnProcess(command, args, {
        cwd: workspacePath,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.resume();
      child.stderr?.resume();
      return child;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start preview";
      if (/ENOENT/i.test(message)) {
        throw new Error(`Preview command not found: ${command}`);
      }
      throw error;
    }
  }

  private killPreviewProcess(process: ChildProcess) {
    if (process.exitCode === null && !process.killed) {
      process.kill("SIGTERM");
    }
  }
}
