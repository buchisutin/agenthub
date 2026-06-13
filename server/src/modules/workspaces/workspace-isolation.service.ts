import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseClient } from "../../db/client.js";
import { RunWorkspaceRecord, RunWorkspaceMode } from "../../shared/types.js";
import { loadIgnorePatterns, shouldIgnoreRelativePath } from "../runs/path-ignore.js";

const nowIso = () => new Date().toISOString();

type ExecGit = (args: string[], cwd: string) => string;

type CleanupSkipped = Array<{ runId: string; reason: string }>;

export interface WorkspaceIsolationServiceDeps {
  execGit?: ExecGit;
  isPreviewRunning?: (runId: string) => boolean;
}

function defaultExecGit(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const ENDED_RUN_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);

function isGitRepo(dirPath: string, execGit: ExecGit): boolean {
  try {
    execGit(["rev-parse", "--show-toplevel"], dirPath);
    return true;
  } catch {
    return false;
  }
}

function isAgenthubStatusPath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/^"+|"+$/g, "").replace(/\\/g, "/");
  return normalized === ".agenthub" || normalized.startsWith(".agenthub/");
}

function normalizeRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function shouldSkipWorkspacePath(filePath: string, ignorePatterns: string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized) {
    return false;
  }
  return (
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".agenthub" ||
    normalized.startsWith(".agenthub/") ||
    shouldIgnoreRelativePath(normalized, ignorePatterns)
  );
}

function hasUserVisibleChanges(dirPath: string, execGit: ExecGit): boolean {
  try {
    const output = execGit(["status", "--porcelain", "--untracked-files=all"], dirPath);
    return output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .some((line) => {
        const payload = line.length > 3 ? line.slice(3) : "";
        const [currentPath, renamedPath] = payload.split(" -> ").map((part) => part.trim());
        const paths = [currentPath, renamedPath].filter((part): part is string => Boolean(part));
        return paths.some((part) => !isAgenthubStatusPath(part));
      });
  } catch {
    return false;
  }
}

export class WorkspaceIsolationService {
  private readonly execGit: ExecGit;
  private readonly deps: WorkspaceIsolationServiceDeps;

  constructor(
    private readonly database: DatabaseClient,
    deps: WorkspaceIsolationServiceDeps = {},
  ) {
    this.deps = deps;
    this.execGit = deps.execGit ?? defaultExecGit;
  }

  setPreviewRunningCheck(fn: (runId: string) => boolean): void {
    this.deps.isPreviewRunning = fn;
  }

  getByRunId(runId: string): RunWorkspaceRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT * FROM run_workspaces WHERE run_id = ?
    `);
    const row = stmt.get(runId) as RunWorkspaceRecord | undefined;
    return row ?? null;
  }

  async createForRun(input: {
    runId: string;
    conversationId: string;
    baseWorkspaceId: string;
    baseRootPath: string;
    agentId: string;
    taskId?: string | null;
  }): Promise<RunWorkspaceRecord> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const baseRootPath = path.resolve(input.baseRootPath);

    if (!fs.existsSync(baseRootPath) || !fs.statSync(baseRootPath).isDirectory()) {
      return this.persistFailed(id, input, now, "Base workspace path does not exist or is not a directory");
    }

    const shortRunId = input.runId.slice(0, 8).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const agenthubDir = path.join(baseRootPath, ".agenthub");
    const useGit = isGitRepo(baseRootPath, this.execGit);
    const useGitWorktree = useGit && !hasUserVisibleChanges(baseRootPath, this.execGit);

    if (useGitWorktree) {
      return this.createGitWorktree(id, input, now, baseRootPath, agenthubDir, shortRunId);
    }
    if (useGit) {
      return this.createGitClone(id, input, now, baseRootPath, agenthubDir, shortRunId);
    }
    return this.persistFailed(
      id,
      input,
      now,
      "Workspace is not a git repository. Please bind a git-initialized directory.",
      "git_worktree",
    );
  }

  private createGitWorktree(
    id: string,
    input: { runId: string; conversationId: string; baseWorkspaceId: string; agentId: string },
    now: string,
    baseRootPath: string,
    agenthubDir: string,
    shortRunId: string,
  ): RunWorkspaceRecord {
    const worktreesDir = path.join(agenthubDir, "worktrees");
    const rootPath = path.join(worktreesDir, input.runId);
    const safePath = this.assertUnderAgenthub(rootPath, baseRootPath);
    if (!safePath) {
      return this.persistFailed(id, input, now, "Computed path escapes base workspace");
    }

    let branchName = `agenthub/run-${shortRunId}`;
    let baseRef = "HEAD";

    try {
      baseRef = this.execGit(["rev-parse", "HEAD"], baseRootPath);
    } catch {
      baseRef = "HEAD";
    }

    try {
      this.execGit(["worktree", "add", "-b", branchName, rootPath, "HEAD"], baseRootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/.test(msg) || /already checked out/.test(msg)) {
        branchName = `agenthub/run-${shortRunId}-${Date.now()}`;
        try {
          this.execGit(["worktree", "add", "-b", branchName, rootPath, "HEAD"], baseRootPath);
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          return this.persistFailed(id, input, now, `git worktree add failed: ${msg2}`);
        }
      } else {
        return this.persistFailed(id, input, now, `git worktree add failed: ${msg}`);
      }
    }

    return this.persist({
      id,
      runId: input.runId,
      conversationId: input.conversationId,
      baseWorkspaceId: input.baseWorkspaceId,
      mode: "git_worktree",
      rootPath,
      branchName,
      baseRef,
      status: "ready",
      errorMessage: null,
      now,
    });
  }

  private createGitClone(
    id: string,
    input: { runId: string; conversationId: string; baseWorkspaceId: string; agentId: string },
    now: string,
    baseRootPath: string,
    agenthubDir: string,
    shortRunId: string,
  ): RunWorkspaceRecord {
    const clonesDir = path.join(agenthubDir, "clones");
    const rootPath = path.join(clonesDir, input.runId);
    const safePath = this.assertUnderAgenthub(rootPath, baseRootPath);
    if (!safePath) {
      return this.persistFailed(id, input, now, "Computed path escapes base workspace");
    }

    let branchName = `agenthub/run-${shortRunId}`;
    let baseRef = "HEAD";

    try {
      baseRef = this.execGit(["rev-parse", "HEAD"], baseRootPath);
    } catch {
      baseRef = "HEAD";
    }

    try {
      this.execGit(["clone", "--no-hardlinks", baseRootPath, rootPath], baseRootPath);
      this.execGit(["checkout", "-b", branchName], rootPath);
      this.syncCurrentWorkspaceTree(baseRootPath, rootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (fs.existsSync(rootPath)) {
        fs.rmSync(rootPath, { recursive: true, force: true });
      }
      return this.persistFailed(id, input, now, `git clone failed: ${msg}`);
    }

    return this.persist({
      id,
      runId: input.runId,
      conversationId: input.conversationId,
      baseWorkspaceId: input.baseWorkspaceId,
      mode: "git_clone",
      rootPath,
      branchName,
      baseRef,
      status: "ready",
      errorMessage: null,
      now,
    });
  }

  private syncCurrentWorkspaceTree(sourceRootPath: string, targetRootPath: string): void {
    const ignorePatterns = loadIgnorePatterns(sourceRootPath);
    this.removeMissingWorkspaceEntries(sourceRootPath, targetRootPath, ignorePatterns, "");
    this.copyWorkspaceEntries(sourceRootPath, targetRootPath, ignorePatterns, "");
  }

  private removeMissingWorkspaceEntries(
    sourceRootPath: string,
    targetRootPath: string,
    ignorePatterns: string[],
    relativePath: string,
  ): void {
    const sourceDir = path.join(sourceRootPath, relativePath);
    const targetDir = path.join(targetRootPath, relativePath);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return;
    }

    const targetEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of targetEntries) {
      const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
      if (shouldSkipWorkspacePath(entryRelativePath, ignorePatterns)) {
        continue;
      }

      const sourceEntryPath = path.join(sourceRootPath, entryRelativePath);
      const targetEntryPath = path.join(targetRootPath, entryRelativePath);
      if (!fs.existsSync(sourceEntryPath)) {
        fs.rmSync(targetEntryPath, { recursive: true, force: true });
        continue;
      }
      if (entry.isDirectory()) {
        this.removeMissingWorkspaceEntries(sourceRootPath, targetRootPath, ignorePatterns, entryRelativePath);
      }
    }
  }

  private copyWorkspaceEntries(
    sourceRootPath: string,
    targetRootPath: string,
    ignorePatterns: string[],
    relativePath: string,
  ): void {
    const sourceDir = path.join(sourceRootPath, relativePath);
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return;
    }

    const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of sourceEntries) {
      const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;
      if (shouldSkipWorkspacePath(entryRelativePath, ignorePatterns)) {
        continue;
      }

      const sourceEntryPath = path.join(sourceRootPath, entryRelativePath);
      const targetEntryPath = path.join(targetRootPath, entryRelativePath);

      if (entry.isDirectory()) {
        fs.mkdirSync(targetEntryPath, { recursive: true });
        this.copyWorkspaceEntries(sourceRootPath, targetRootPath, ignorePatterns, entryRelativePath);
        continue;
      }

      fs.mkdirSync(path.dirname(targetEntryPath), { recursive: true });
      fs.copyFileSync(sourceEntryPath, targetEntryPath);
    }
  }

  private assertUnderAgenthub(targetPath: string, baseRootPath: string): string | null {
    const agenthubBase = path.resolve(baseRootPath, ".agenthub");
    const resolved = path.resolve(targetPath);
    if (!resolved.startsWith(agenthubBase + path.sep) && resolved !== agenthubBase) {
      return null;
    }
    return resolved;
  }

  private persistFailed(
    id: string,
    input: { runId: string; conversationId: string; baseWorkspaceId: string },
    now: string,
    errorMessage: string,
    mode: RunWorkspaceMode = "git_worktree",
  ): RunWorkspaceRecord {
    return this.persist({
      id,
      runId: input.runId,
      conversationId: input.conversationId,
      baseWorkspaceId: input.baseWorkspaceId,
      mode,
      rootPath: "",
      branchName: null,
      baseRef: null,
      status: "failed",
      errorMessage,
      now,
    });
  }

  async cleanupRunWorkspace(runId: string): Promise<RunWorkspaceRecord> {
    const record = this.getByRunId(runId);
    if (!record) {
      throw Object.assign(new Error("Run workspace not found"), { statusCode: 404 });
    }
    if (record.status === "cleaned") {
      return record;
    }
    if (record.status !== "ready" && record.status !== "failed") {
      throw Object.assign(new Error("Run workspace is not in a cleanable state"), { statusCode: 400 });
    }

    if (this.deps.isPreviewRunning?.(runId)) {
      throw Object.assign(new Error("Cannot clean workspace while preview is running"), { statusCode: 400 });
    }

    if (!record.root_path) {
      this.updateStatus(runId, "cleaned", null);
      return { ...record, status: "cleaned", error_message: null, updated_at: nowIso() };
    }

    this.assertSafeCleanupPath(record.root_path);

    try {
      if (record.mode === "git_worktree") {
        const baseRootPath = this.resolveBaseWorkspaceRootPath(record);
        if (!baseRootPath) {
          throw new Error("Base workspace not found");
        }
        this.execGit(["worktree", "remove", "--force", record.root_path], baseRootPath);
        this.tryDeleteBranch(baseRootPath, record.branch_name);
      } else if (record.mode === "git_clone") {
        const baseRootPath = this.resolveBaseWorkspaceRootPath(record);
        if (!baseRootPath) {
          throw new Error("Base workspace not found");
        }
        fs.rmSync(record.root_path, { recursive: true, force: true });
        this.tryDeleteBranch(baseRootPath, record.branch_name);
      } else if (record.mode === "copy") {
        fs.rmSync(record.root_path, { recursive: true, force: true });
      }
    } catch (err) {
      if (fs.existsSync(record.root_path)) {
        const msg = err instanceof Error ? err.message : String(err);
        this.updateStatus(runId, record.status, msg);
        throw Object.assign(new Error(`Cleanup failed: ${msg}`), { statusCode: 500 });
      }
    }

    const now = nowIso();
    this.updateStatus(runId, "cleaned", null);
    return { ...record, status: "cleaned", error_message: null, updated_at: now };
  }

  async cleanupConversationWorkspaces(
    conversationId: string,
    runsService: { getById: (runId: string) => { status: string } | null },
  ): Promise<{ cleaned: RunWorkspaceRecord[]; skipped: CleanupSkipped }> {
    const stmt = this.database.db.prepare(`
      SELECT * FROM run_workspaces WHERE conversation_id = ?
    `);
    const workspaces = stmt.all(conversationId).map((row) => row as unknown as RunWorkspaceRecord);

    const cleaned: RunWorkspaceRecord[] = [];
    const skipped: CleanupSkipped = [];

    for (const ws of workspaces) {
      if (ws.status === "cleaned") {
        continue;
      }

      const run = runsService.getById(ws.run_id);
      if (!run) {
        skipped.push({ runId: ws.run_id, reason: "Run not found" });
        continue;
      }

      if (run.status === "running" || run.status === "queued") {
        skipped.push({ runId: ws.run_id, reason: `Run is ${run.status}` });
        continue;
      }

      if (!ENDED_RUN_STATUSES.has(run.status)) {
        skipped.push({ runId: ws.run_id, reason: `Run status ${run.status} is not cleanup-eligible` });
        continue;
      }

      if (this.deps.isPreviewRunning?.(ws.run_id)) {
        skipped.push({ runId: ws.run_id, reason: "Preview is running" });
        continue;
      }

      try {
        const result = await this.cleanupRunWorkspace(ws.run_id);
        cleaned.push(result);
      } catch (err) {
        skipped.push({ runId: ws.run_id, reason: err instanceof Error ? err.message : "Cleanup failed" });
      }
    }

    return { cleaned, skipped };
  }

  private assertSafeCleanupPath(rootPath: string): void {
    const resolved = path.resolve(rootPath);
    if (!resolved.includes(`${path.sep}.agenthub${path.sep}worktrees${path.sep}`) &&
        !resolved.includes(`${path.sep}.agenthub${path.sep}clones${path.sep}`) &&
        !resolved.includes(`${path.sep}.agenthub${path.sep}copies${path.sep}`)) {
      throw Object.assign(
        new Error("Unsafe cleanup path: root_path must be under .agenthub/worktrees, .agenthub/clones, or .agenthub/copies"),
        { statusCode: 400 },
      );
    }
  }

  private getBaseWorkspaceRootPath(workspaceId: string): string | null {
    const stmt = this.database.db.prepare(`
      SELECT root_path FROM workspaces WHERE id = ? LIMIT 1
    `);
    const row = stmt.get(workspaceId) as { root_path: string } | undefined;
    return row?.root_path ?? null;
  }

  private resolveBaseWorkspaceRootPath(record: RunWorkspaceRecord): string | null {
    const fromWorkspace = this.getBaseWorkspaceRootPath(record.base_workspace_id);
    if (fromWorkspace) {
      return path.resolve(fromWorkspace);
    }

    const marker = `${path.sep}.agenthub${path.sep}`;
    const normalizedRoot = path.resolve(record.root_path);
    const markerIndex = normalizedRoot.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }
    return normalizedRoot.slice(0, markerIndex);
  }

  private tryDeleteBranch(baseRootPath: string, branchName: string | null): void {
    if (!branchName) {
      return;
    }
    try {
      this.execGit(["branch", "-d", branchName], baseRootPath);
    } catch {
      // Leave unmerged or missing branches behind rather than failing cleanup.
    }
  }

  private updateStatus(runId: string, status: RunWorkspaceRecord["status"], errorMessage: string | null): void {
    const stmt = this.database.db.prepare(`
      UPDATE run_workspaces SET status = ?, error_message = ?, updated_at = ? WHERE run_id = ?
    `);
    stmt.run(status, errorMessage, nowIso(), runId);
  }

  private persist(input: {
    id: string;
    runId: string;
    conversationId: string;
    baseWorkspaceId: string;
    mode: RunWorkspaceMode;
    rootPath: string;
    branchName: string | null;
    baseRef: string | null;
    status: RunWorkspaceRecord["status"];
    errorMessage: string | null;
    now: string;
  }): RunWorkspaceRecord {
    const record: RunWorkspaceRecord = {
      id: input.id,
      run_id: input.runId,
      conversation_id: input.conversationId,
      base_workspace_id: input.baseWorkspaceId,
      mode: input.mode,
      root_path: input.rootPath,
      branch_name: input.branchName,
      base_ref: input.baseRef,
      status: input.status,
      error_message: input.errorMessage,
      created_at: input.now,
      updated_at: input.now,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO run_workspaces (
        id, run_id, conversation_id, base_workspace_id, mode, root_path,
        branch_name, base_ref, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.run_id,
      record.conversation_id,
      record.base_workspace_id,
      record.mode,
      record.root_path,
      record.branch_name,
      record.base_ref,
      record.status,
      record.error_message,
      record.created_at,
      record.updated_at,
    );

    return record;
  }
}
