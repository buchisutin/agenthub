import fs from "node:fs";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import {
  DeployRecord,
  DeployScriptsResponse,
  WorkspaceDeployRecord,
  WorkspaceDeployScriptsResponse,
} from "../../shared/types.js";
import { RunsService } from "../runs/runs.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";

type SpawnProcess = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export interface DeployServiceDeps {
  spawnProcess?: SpawnProcess;
}

function isFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
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

function hasNodeModules(workspacePath: string): boolean {
  return isDirectory(path.join(workspacePath, "node_modules"));
}

function readPackageScripts(workspacePath: string): Record<string, string> | null {
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
    const result: Record<string, string> = {};
    for (const key of ["dev", "build", "start"]) {
      const value = (scripts as Record<string, unknown>)[key];
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return null;
  }
}

function chooseDefaultScript(scripts: string[]): string | null {
  if (scripts.includes("build")) return "build";
  if (scripts.includes("start")) return "start";
  if (scripts.includes("dev")) return "dev";
  return scripts[0] ?? null;
}

export class DeployService {
  private readonly deploys = new Map<string, DeployRecord & { process?: ChildProcess }>();
  private readonly workspaceDeploys = new Map<string, WorkspaceDeployRecord & { process?: ChildProcess }>();
  private readonly spawnProcess: SpawnProcess;

  constructor(
    private readonly runsService: RunsService,
    private readonly workspacesService: WorkspacesService,
    deps: DeployServiceDeps = {},
  ) {
    this.spawnProcess = deps.spawnProcess ?? spawn;
  }

  getScriptsForRun(runId: string): DeployScriptsResponse {
    const workspacePath = this.resolveWorkspacePath(runId);
    const scripts = Object.keys(readPackageScripts(workspacePath) ?? {});
    return {
      runId,
      scripts,
      defaultScript: chooseDefaultScript(scripts),
    };
  }

  getScriptsForWorkspace(workspaceId: string): WorkspaceDeployScriptsResponse {
    const workspacePath = this.resolveBaseWorkspacePath(workspaceId);
    const scripts = Object.keys(readPackageScripts(workspacePath) ?? {});
    return {
      workspaceId,
      scripts,
      defaultScript: chooseDefaultScript(scripts),
    };
  }

  startDeployForWorkspace(workspaceId: string, script?: string): WorkspaceDeployRecord {
    const existing = this.workspaceDeploys.get(workspaceId);
    if (existing?.status === "running" && existing.process?.exitCode === null) {
      return this.publicWorkspaceRecord(existing);
    }

    const workspacePath = this.resolveBaseWorkspacePath(workspaceId);
    const scripts = readPackageScripts(workspacePath);
    if (!scripts) throw new Error("No package.json scripts found");
    const availableScripts = Object.keys(scripts);
    const selectedScript = script ?? chooseDefaultScript(availableScripts);
    if (!selectedScript || !availableScripts.includes(selectedScript)) {
      throw new Error("Deploy script is not available");
    }

    const process = this.spawnProcess("npm", ["run", selectedScript], {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record: WorkspaceDeployRecord & { process?: ChildProcess } = {
      workspaceId,
      status: "running",
      script: selectedScript,
      command: `npm run ${selectedScript}`,
      logs: [],
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      errorMessage: null,
      process,
    };
    this.workspaceDeploys.set(workspaceId, record);

    process.stdout?.on("data", (chunk: Buffer | string) => {
      record.logs.push({ stream: "stdout", chunk: chunk.toString(), at: new Date().toISOString() });
    });
    process.stderr?.on("data", (chunk: Buffer | string) => {
      record.logs.push({ stream: "stderr", chunk: chunk.toString(), at: new Date().toISOString() });
    });
    process.once("error", (error) => {
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      record.errorMessage = error instanceof Error ? error.message : "Deploy failed";
    });
    process.once("exit", (code) => {
      record.status = code === 0 ? "succeeded" : "failed";
      record.exitCode = code;
      record.finishedAt = new Date().toISOString();
      if (code !== 0) record.errorMessage = `Deploy exited with code ${code}`;
    });

    return this.publicWorkspaceRecord(record);
  }

  getDeployForWorkspace(workspaceId: string): WorkspaceDeployRecord | null {
    const record = this.workspaceDeploys.get(workspaceId);
    return record ? this.publicWorkspaceRecord(record) : null;
  }

  startDeploy(runId: string, script?: string): DeployRecord {
    const existing = this.deploys.get(runId);
    if (existing?.status === "running" && existing.process?.exitCode === null) {
      return this.publicRecord(existing);
    }

    const workspacePath = this.resolveWorkspacePath(runId);
    const scripts = readPackageScripts(workspacePath);
    if (!scripts) {
      throw new Error("No package.json scripts found");
    }

    const availableScripts = Object.keys(scripts);
    const selectedScript = script ?? chooseDefaultScript(availableScripts);
    if (!selectedScript || !availableScripts.includes(selectedScript)) {
      throw new Error("Deploy script is not available");
    }

    const process = this.spawnProcess("npm", ["run", selectedScript], {
      cwd: workspacePath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const now = new Date().toISOString();
    const record: DeployRecord & { process?: ChildProcess } = {
      runId,
      status: "running",
      script: selectedScript,
      command: `npm run ${selectedScript}`,
      logs: [],
      exitCode: null,
      startedAt: now,
      finishedAt: null,
      errorMessage: null,
      process,
    };
    this.deploys.set(runId, record);

    process.stdout?.on("data", (chunk: Buffer | string) => {
      record.logs.push({
        stream: "stdout",
        chunk: chunk.toString(),
        at: new Date().toISOString(),
      });
    });
    process.stderr?.on("data", (chunk: Buffer | string) => {
      record.logs.push({
        stream: "stderr",
        chunk: chunk.toString(),
        at: new Date().toISOString(),
      });
    });
    process.once("error", (error) => {
      record.status = "failed";
      record.exitCode = null;
      record.finishedAt = new Date().toISOString();
      record.errorMessage = error instanceof Error ? error.message : "Deploy failed";
    });
    process.once("exit", (code) => {
      record.status = code === 0 ? "succeeded" : "failed";
      record.exitCode = code;
      record.finishedAt = new Date().toISOString();
      if (code !== 0) {
        record.errorMessage = `Deploy exited with code ${code}`;
      }
    });

    return this.publicRecord(record);
  }

  getDeploy(runId: string): DeployRecord | null {
    const record = this.deploys.get(runId);
    return record ? this.publicRecord(record) : null;
  }

  async cleanupAllDeploys(): Promise<void> {
    for (const record of this.deploys.values()) {
      if (record.status === "running" && record.process?.exitCode === null) {
        record.process.kill();
      }
    }
    this.deploys.clear();
    for (const record of this.workspaceDeploys.values()) {
      if (record.status === "running" && record.process?.exitCode === null) {
        record.process.kill();
      }
    }
    this.workspaceDeploys.clear();
  }

  private resolveWorkspacePath(runId: string): string {
    const run = this.runsService.getById(runId);
    if (!run) {
      throw new Error("Run not found");
    }
    if (run.status !== "completed") {
      throw new Error("Deploy is only available for completed runs");
    }
    if (!run.workspace_id) {
      throw new Error("Workspace not bound");
    }

    const baseWorkspacePath = this.resolveBaseWorkspacePath(run.workspace_id);
    const runWorkspace = this.runsService.getRunWorkspace(runId);
    if (runWorkspace?.status === "cleaned") {
      throw new Error("Run workspace has been cleaned");
    }
    if (runWorkspace?.root_path && runWorkspace.status === "ready") {
      const resolved = path.resolve(runWorkspace.root_path);
      if (isDirectory(resolved)) {
        if (!hasNodeModules(resolved) && hasNodeModules(baseWorkspacePath)) {
          return baseWorkspacePath;
        }
        return resolved;
      }
    }

    return baseWorkspacePath;
  }

  private resolveBaseWorkspacePath(workspaceId: string): string {
    const workspace = this.workspacesService.getById(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not bound");
    }
    const resolved = path.resolve(workspace.root_path);
    if (!isDirectory(resolved)) {
      throw new Error("Workspace path is invalid");
    }
    return resolved;
  }

  private publicRecord(record: DeployRecord & { process?: ChildProcess }): DeployRecord {
    const { process: _process, ...rest } = record;
    return {
      ...rest,
      logs: [...rest.logs],
    };
  }

  private publicWorkspaceRecord(
    record: WorkspaceDeployRecord & { process?: ChildProcess },
  ): WorkspaceDeployRecord {
    const { process: _process, ...rest } = record;
    return { ...rest, logs: [...rest.logs] };
  }
}
