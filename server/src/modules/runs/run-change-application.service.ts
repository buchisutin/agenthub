import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseClient } from "../../db/client.js";
import {
  ApplyCheckFile,
  ApplyCheckResult,
  ConflictResolutionChoice,
  FileChange,
  RunChangeApplication,
  RunChangeApplicationRecord,
  RunChangeApplicationStatus,
  SkippedFileEntry,
} from "../../shared/types.js";

const nowIso = () => new Date().toISOString();
const SLOW_GIT_STATUS_MS = 100;

export interface ChangeApplicationDeps {
  getRun: (runId: string) => {
    id: string;
    conversation_id: string;
    workspace_id: string;
    agent_id: string;
    status: string;
  } | null;
  getRunWorkspace: (runId: string) => {
    root_path: string;
    status: string;
    mode?: string;
    branch_name?: string | null;
    base_ref?: string | null;
  } | null;
  getRunWorkspaceId: (runId: string) => string | null;
  getBaseWorkspaceRootPath: (workspaceId: string) => string | null;
  getFileChanges: (runId: string) => FileChange[];
  getAgentSlug?: (agentId: string) => string | null;
}

type ChangeRun = NonNullable<ReturnType<ChangeApplicationDeps["getRun"]>>;
type ChangeRunWorkspace = NonNullable<ReturnType<ChangeApplicationDeps["getRunWorkspace"]>>;

function assertSafePath(filePath: string): void {
  if (path.isAbsolute(filePath)) {
    throw Object.assign(new Error(`Unsafe file path: ${filePath}`), { statusCode: 400 });
  }
  const normalized = path.normalize(filePath);
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
    throw Object.assign(new Error(`Unsafe file path: ${filePath}`), { statusCode: 400 });
  }
}

function assertUnderBase(targetPath: string, basePath: string): string {
  const resolved = path.resolve(targetPath);
  const baseResolved = path.resolve(basePath);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw Object.assign(
      new Error(`Path escapes workspace: ${targetPath}`),
      { statusCode: 400 },
    );
  }
  return resolved;
}

function isAgenthubStatusPath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/^"+|"+$/g, "").replace(/\\/g, "/");
  return normalized === ".agenthub" || normalized.startsWith(".agenthub/");
}

function isGitBackedRunWorkspace(mode: string | undefined): boolean {
  return mode === "git_worktree" || mode === "git_clone";
}

function recordToApplication(record: RunChangeApplicationRecord): RunChangeApplication {
  return {
    id: record.id,
    runId: record.run_id,
    conversationId: record.conversation_id,
    runWorkspaceId: record.run_workspace_id,
    status: record.status,
    appliedFiles: record.applied_files_json
      ? (JSON.parse(record.applied_files_json) as string[])
      : [],
    skippedFiles: record.skipped_files_json
      ? (JSON.parse(record.skipped_files_json) as SkippedFileEntry[])
      : [],
    errorMessage: record.error_message,
    appliedAt: record.applied_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function readBaseFile(workspacePath: string, filePath: string): string | null {
  try {
    const fullPath = path.resolve(workspacePath, filePath);
    if (!fullPath.startsWith(path.resolve(workspacePath) + path.sep) && fullPath !== path.resolve(workspacePath)) {
      return null;
    }
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fs.readFileSync(fullPath, "utf8");
    }
  } catch { /* read error -> null */ }
  return null;
}

function checkFileConflict(
  change: FileChange,
  baseRootPath: string,
  runRootPath: string,
): ApplyCheckFile {
  try {
    assertSafePath(change.filePath);
    assertUnderBase(path.join(baseRootPath, change.filePath), baseRootPath);
    assertUnderBase(path.join(runRootPath, change.filePath), runRootPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      filePath: change.filePath,
      changeType: change.changeType,
      status: "skipped",
      reason: msg,
    };
  }

  const targetInAgenthub = path
    .resolve(baseRootPath, change.filePath)
    .includes(`${path.sep}.agenthub${path.sep}`);
  if (targetInAgenthub) {
    return {
      filePath: change.filePath,
      changeType: change.changeType,
      status: "skipped",
      reason: "Cannot write to .agenthub",
    };
  }

  const baseContent = readBaseFile(baseRootPath, change.filePath);

  if (change.changeType === "delete") {
    return {
      filePath: change.filePath,
      changeType: "delete",
      status: "skipped",
      reason: "Delete not supported",
    };
  }

  if (change.changeType === "unknown") {
    return {
      filePath: change.filePath,
      changeType: "unknown",
      status: "skipped",
      reason: "Unknown change type",
    };
  }

  if (change.changeType === "create") {
    if (baseContent === null) {
      return { filePath: change.filePath, changeType: "create", status: "safe" };
    }
    // Target already exists in base - check if contents match
    const newContent = change.newContent;
    if (newContent && baseContent === newContent) {
      return { filePath: change.filePath, changeType: "create", status: "safe", reason: "Already applied" };
    }
    return {
      filePath: change.filePath,
      changeType: "create",
      status: "conflict",
      reason: "Target already exists in base workspace",
    };
  }

  // changeType === "edit"
  const newContent = change.newContent;

  if (baseContent === null) {
    // Base file doesn't exist - treat like a create
    if (change.oldContent) {
      // Had old content but file disappeared - conflict
      return {
        filePath: change.filePath,
        changeType: "edit",
        status: "conflict",
        reason: "Base file no longer exists",
      };
    }
    // No old content, file doesn't exist - safe create
    return { filePath: change.filePath, changeType: "edit", status: "safe" };
  }

  // Base file exists - check if it matches new content (already applied)
  if (newContent && baseContent === newContent) {
    return { filePath: change.filePath, changeType: "edit", status: "safe", reason: "Already applied" };
  }

  // Check if base still matches old content (unchanged since run)
  if (change.oldContent) {
    if (baseContent === change.oldContent) {
      return { filePath: change.filePath, changeType: "edit", status: "safe" };
    }
    return {
      filePath: change.filePath,
      changeType: "edit",
      status: "conflict",
      reason: "Base file changed since run",
    };
  }

  // No old content available - can't safely determine
  if (change.confidence === "best_effort") {
    return {
      filePath: change.filePath,
      changeType: "edit",
      status: "conflict",
      reason: "Missing old content for safe edit",
    };
  }

  // Fallback: treat as conflict for safety
  return {
    filePath: change.filePath,
    changeType: "edit",
    status: "conflict",
    reason: "Missing old content for safe edit",
  };
}

export class RunChangeApplicationService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly deps: ChangeApplicationDeps,
  ) {}

  getApplicationForRun(runId: string): RunChangeApplication | null {
    const stmt = this.database.db.prepare(
      "SELECT * FROM run_change_applications WHERE run_id = ?",
    );
    const row = stmt.get(runId) as RunChangeApplicationRecord | undefined;
    return row ? recordToApplication(row) : null;
  }

  checkRunChanges(runId: string): ApplyCheckResult {
    const run = this.deps.getRun(runId);
    if (!run) {
      throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    }

    const runWorkspace = this.deps.getRunWorkspace(runId);
    if (!runWorkspace) {
      throw Object.assign(new Error("Run workspace not found"), { statusCode: 400 });
    }
    if (runWorkspace.status === "cleaned") {
      throw Object.assign(new Error("Run workspace has been cleaned"), { statusCode: 400 });
    }

    const baseRoot = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!baseRoot) {
      throw Object.assign(new Error("Base workspace not found"), { statusCode: 400 });
    }

    const baseRootPath = path.resolve(baseRoot);
    const runRootPath = path.resolve(runWorkspace.root_path);

    let fileChanges: FileChange[];
    try {
      fileChanges = this.deps.getFileChanges(runId);
    } catch {
      throw Object.assign(new Error("Failed to read file changes"), { statusCode: 500 });
    }

    if (fileChanges.length === 0) {
      return {
        runId,
        canApply: true,
        files: [],
        summary: { safe: 0, conflict: 0, skipped: 0 },
      };
    }

    const files: ApplyCheckFile[] = isGitBackedRunWorkspace(runWorkspace.mode)
      ? this.checkGitRunChanges(baseRootPath, fileChanges)
      : fileChanges.map((change) => checkFileConflict(change, baseRootPath, runRootPath));

    const summary = {
      safe: files.filter((f) => f.status === "safe").length,
      conflict: files.filter((f) => f.status === "conflict").length,
      skipped: files.filter((f) => f.status === "skipped").length,
    };

    return {
      runId,
      canApply: summary.conflict === 0,
      files,
      summary,
    };
  }

  applyRunChanges(
    runId: string,
    options?: { force?: boolean },
  ): RunChangeApplication {
    const existing = this.getApplicationForRun(runId);
    if (existing) {
      return existing;
    }

    const run = this.deps.getRun(runId);
    if (!run) {
      throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    }
    if (run.status !== "completed") {
      throw Object.assign(
        new Error("Can only apply changes for completed runs"),
        { statusCode: 400 },
      );
    }

    const runWorkspace = this.deps.getRunWorkspace(runId);
    if (!runWorkspace) {
      throw Object.assign(new Error("Run workspace not found"), { statusCode: 400 });
    }
    if (runWorkspace.status === "cleaned") {
      throw Object.assign(
        new Error("Run workspace has been cleaned"),
        { statusCode: 400 },
      );
    }

    const runWorkspaceId = this.deps.getRunWorkspaceId(runId);

    const baseRoot = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!baseRoot) {
      throw Object.assign(new Error("Base workspace not found"), { statusCode: 400 });
    }

    const baseRootPath = path.resolve(baseRoot);
    const runRootPath = path.resolve(runWorkspace.root_path);

    const check = this.checkRunChanges(runId);

    // If there are conflicts and force is not enabled, reject
    if (check.summary.conflict > 0 && !options?.force) {
      throw Object.assign(
        new Error("Apply conflicts detected"),
        { statusCode: 409, check },
      );
    }

    if (check.files.length === 0) {
      return this.persist({
        runId,
        conversationId: run.conversation_id,
        runWorkspaceId: runWorkspaceId,
        status: "skipped",
        appliedFiles: [],
        skippedFiles: [{ filePath: "-", reason: "No file changes to apply" }],
        errorMessage: null,
      });
    }

    if (isGitBackedRunWorkspace(runWorkspace.mode)) {
      return this.applyGitRunChanges(run, runWorkspace, runWorkspaceId, check.files, baseRootPath);
    }

    const appliedFiles: string[] = [];
    const skippedFiles: SkippedFileEntry[] = [];

    for (const file of check.files) {
      if (file.status === "skipped") {
        skippedFiles.push({ filePath: file.filePath, reason: file.reason ?? "Skipped" });
        continue;
      }

      if (file.status === "conflict") {
        skippedFiles.push({ filePath: file.filePath, reason: file.reason ?? "Conflict" });
        continue;
      }

      // file.status === "safe"
      try {
        const sourcePath = assertUnderBase(
          path.join(runRootPath, file.filePath),
          runRootPath,
        );
        const targetPath = assertUnderBase(
          path.join(baseRootPath, file.filePath),
          baseRootPath,
        );

        if (!fs.existsSync(sourcePath)) {
          skippedFiles.push({
            filePath: file.filePath,
            reason: "Source file no longer exists in run workspace",
          });
          continue;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        appliedFiles.push(file.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skippedFiles.push({ filePath: file.filePath, reason: msg });
      }
    }

    const status: RunChangeApplicationStatus =
      appliedFiles.length > 0 ? "applied" : "failed";

    let errorMessage: string | null = null;
    if (status === "failed") {
      errorMessage = "No files could be applied; all changes were skipped";
    }

    return this.persist({
      runId,
      conversationId: run.conversation_id,
      runWorkspaceId: runWorkspaceId,
      status,
      appliedFiles,
      skippedFiles,
      errorMessage,
    });
  }

  applyAndCommitRunChanges(runId: string): {
    application: RunChangeApplication;
    commitSha: string;
    branchName: string;
    commitMessage: string;
    committedFiles: string[];
    alreadyCommitted: boolean;
  } {
    const run = this.deps.getRun(runId);
    if (!run) {
      throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    }

    const baseRoot = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!baseRoot) {
      throw Object.assign(new Error("Base workspace not found"), { statusCode: 400 });
    }
    const baseRootPath = path.resolve(baseRoot);
    const headBefore = this.execGit(baseRootPath, ["rev-parse", "HEAD"]).trim();

    const runWorkspace = this.deps.getRunWorkspace(runId);
    const application = this.applyRunChanges(runId);
    if (application.status !== "applied" || application.appliedFiles.length === 0 || !runWorkspace) {
      throw Object.assign(new Error("No applied files available to commit"), { statusCode: 400 });
    }
    if (!isGitBackedRunWorkspace(runWorkspace.mode)) {
      throw Object.assign(new Error("Apply and Commit requires a git-backed workspace"), { statusCode: 400 });
    }

    const agentSlug = this.deps.getAgentSlug?.(run.agent_id) ?? run.agent_id;
    const commitMessage = `agenthub(apply): run ${runId} by @${agentSlug}`;
    const branchName = runWorkspace.branch_name ?? this.execGit(baseRootPath, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const headAfter = this.execGit(baseRootPath, ["rev-parse", "HEAD"]).trim();
    const alreadyCommitted = headBefore === headAfter;

    return {
      application,
      commitSha: headAfter,
      branchName,
      commitMessage,
      committedFiles: application.appliedFiles,
      alreadyCommitted,
    };
  }

  applyConflictResolutions(
    runId: string,
    resolutions: ConflictResolutionChoice[],
    options?: { commit?: boolean },
  ): RunChangeApplication | {
    application: RunChangeApplication;
    commitSha: string;
    branchName: string;
    commitMessage: string;
    committedFiles: string[];
    alreadyCommitted: boolean;
  } {
    const existing = this.getApplicationForRun(runId);
    if (existing) {
      if (options?.commit) {
        return {
          application: existing,
          commitSha: "",
          branchName: "",
          commitMessage: "",
          committedFiles: existing.appliedFiles,
          alreadyCommitted: true,
        };
      }
      return existing;
    }

    const run = this.deps.getRun(runId);
    if (!run) {
      throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    }
    if (run.status !== "completed") {
      throw Object.assign(
        new Error("Can only resolve conflicts for completed runs"),
        { statusCode: 400 },
      );
    }

    const runWorkspace = this.deps.getRunWorkspace(runId);
    if (!runWorkspace) {
      throw Object.assign(new Error("Run workspace not found"), { statusCode: 400 });
    }
    if (runWorkspace.status === "cleaned") {
      throw Object.assign(
        new Error("Run workspace has been cleaned"),
        { statusCode: 400 },
      );
    }

    const runWorkspaceId = this.deps.getRunWorkspaceId(runId);
    const baseRoot = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!baseRoot) {
      throw Object.assign(new Error("Base workspace not found"), { statusCode: 400 });
    }

    const baseRootPath = path.resolve(baseRoot);
    const runRootPath = path.resolve(runWorkspace.root_path);
    const check = this.checkRunChanges(runId);
    const conflictFiles = check.files.filter((file) => file.status === "conflict");
    if (conflictFiles.length === 0) {
      throw Object.assign(new Error("Run has no conflicts to resolve"), { statusCode: 400 });
    }

    const resolutionByPath = new Map(resolutions.map((resolution) => [resolution.filePath, resolution.strategy]));
    const missingResolutions = conflictFiles
      .filter((file) => !resolutionByPath.has(file.filePath))
      .map((file) => file.filePath);
    if (missingResolutions.length > 0) {
      throw Object.assign(
        new Error(`Missing resolutions for: ${missingResolutions.join(", ")}`),
        { statusCode: 400 },
      );
    }

    const appliedFiles: string[] = [];
    const skippedFiles: SkippedFileEntry[] = [];

    for (const file of check.files) {
      if (file.status === "skipped") {
        skippedFiles.push({ filePath: file.filePath, reason: file.reason ?? "Skipped" });
        continue;
      }

      if (file.status === "conflict") {
        const strategy = resolutionByPath.get(file.filePath);
        if (strategy === "use_base") {
          skippedFiles.push({ filePath: file.filePath, reason: "Kept base workspace version" });
          continue;
        }
      }

      try {
        const sourcePath = assertUnderBase(
          path.join(runRootPath, file.filePath),
          runRootPath,
        );
        const targetPath = assertUnderBase(
          path.join(baseRootPath, file.filePath),
          baseRootPath,
        );

        if (!fs.existsSync(sourcePath)) {
          skippedFiles.push({
            filePath: file.filePath,
            reason: "Source file no longer exists in run workspace",
          });
          continue;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        appliedFiles.push(file.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skippedFiles.push({ filePath: file.filePath, reason: msg });
      }
    }

    const application = this.persist({
      runId,
      conversationId: run.conversation_id,
      runWorkspaceId,
      status: appliedFiles.length > 0 ? "applied" : "skipped",
      appliedFiles,
      skippedFiles,
      errorMessage: appliedFiles.length > 0 ? null : "No files were applied during conflict resolution",
    });

    if (!options?.commit) {
      return application;
    }

    if (appliedFiles.length === 0) {
      throw Object.assign(new Error("No resolved files available to commit"), { statusCode: 400 });
    }

    const headBefore = this.execGit(baseRootPath, ["rev-parse", "HEAD"]).trim();
    this.execGit(baseRootPath, ["add", "-A"]);
    const agentSlug = this.deps.getAgentSlug?.(run.agent_id) ?? run.agent_id;
    const commitMessage = `agenthub(resolve): run ${runId} by @${agentSlug}`;
    this.execGit(baseRootPath, ["commit", "-m", commitMessage]);
    const headAfter = this.execGit(baseRootPath, ["rev-parse", "HEAD"]).trim();

    return {
      application,
      commitSha: headAfter,
      branchName: runWorkspace.branch_name ?? "",
      commitMessage,
      committedFiles: appliedFiles,
      alreadyCommitted: headBefore === headAfter,
    };
  }

  private checkGitRunChanges(baseRootPath: string, fileChanges: FileChange[]): ApplyCheckFile[] {
    if (this.hasUserVisibleGitChanges(baseRootPath)) {
      return fileChanges.map((change) => ({
        filePath: change.filePath,
        changeType: change.changeType,
        status: "conflict",
        reason: "Base workspace has uncommitted changes",
      }));
    }

    return fileChanges.map((change) => ({
      filePath: change.filePath,
      changeType: change.changeType,
      status: change.changeType === "unknown" ? "skipped" : "safe",
      reason: change.changeType === "unknown" ? "Unknown change type" : undefined,
    }));
  }

  private hasUserVisibleGitChanges(baseRootPath: string): boolean {
    try {
      const startedAt = Date.now();
      const output = this.execGit(baseRootPath, ["status", "--porcelain", "--untracked-files=all"]);
      const durationMs = Date.now() - startedAt;
      if (durationMs >= SLOW_GIT_STATUS_MS) {
        console.log(
          `[slow git status] cwd=${baseRootPath} duration=${durationMs}ms`,
        );
      }
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
      return true;
    }
  }

  private applyGitRunChanges(
    run: ChangeRun,
    runWorkspace: ChangeRunWorkspace,
    runWorkspaceId: string | null,
    files: ApplyCheckFile[],
    baseRootPath: string,
  ): RunChangeApplication {
    const branchName = runWorkspace.branch_name;
    if (!branchName) {
      throw Object.assign(new Error("Run workspace branch not found"), { statusCode: 400 });
    }

    const appliedFiles = files
      .filter((file) => file.status === "safe")
      .map((file) => file.filePath);
    const skippedFiles = files
      .filter((file) => file.status !== "safe")
      .map((file) => ({ filePath: file.filePath, reason: file.reason ?? "Skipped" }));

    const agentSlug = this.deps.getAgentSlug?.(run.agent_id) ?? run.agent_id;
    const runCommitMessage = `agenthub(run): run ${run.id} by @${agentSlug}`;
    const mergeCommitMessage = `agenthub(apply): run ${run.id} by @${agentSlug}`;

    const commitSha = this.ensureRunWorkspaceCommit(runWorkspace.root_path, runCommitMessage);

    if (runWorkspace.mode === "git_clone") {
      this.execGit(baseRootPath, ["fetch", runWorkspace.root_path, `${branchName}:${branchName}`]);
    }

    if (!this.isCommitReachable(baseRootPath, commitSha)) {
      throw Object.assign(new Error("Run branch is not available in the base repository"), { statusCode: 400 });
    }

    if (!this.isCommitMerged(baseRootPath, commitSha)) {
      try {
        this.execGit(baseRootPath, ["merge", "--no-ff", "--no-commit", branchName]);
      } catch (error) {
        try {
          this.execGit(baseRootPath, ["merge", "--abort"]);
        } catch {
          // Best-effort cleanup after a failed merge.
        }
        const detail = error instanceof Error ? error.message : "Merge conflicts detected while applying run branch";
        throw Object.assign(new Error(`Merge conflicts detected while applying run branch: ${detail}`), {
          statusCode: 409,
        });
      }

      this.execGit(baseRootPath, ["commit", "-m", mergeCommitMessage]);
    }

    return this.persist({
      runId: run.id,
      conversationId: run.conversation_id,
      runWorkspaceId,
      status: appliedFiles.length > 0 ? "applied" : "failed",
      appliedFiles,
      skippedFiles,
      errorMessage: appliedFiles.length > 0 ? null : "No files could be applied; all changes were skipped",
    });
  }

  private ensureRunWorkspaceCommit(runRootPath: string, commitMessage: string): string {
    const pendingStatus = this.execGit(runRootPath, ["status", "--porcelain", "--untracked-files=all"]).trim();
    if (pendingStatus) {
      this.execGit(runRootPath, ["add", "-A"]);
      this.execGit(runRootPath, ["commit", "-m", commitMessage]);
    }
    return this.execGit(runRootPath, ["rev-parse", "HEAD"]).trim();
  }

  private isCommitReachable(baseRootPath: string, commitSha: string): boolean {
    try {
      this.execGit(baseRootPath, ["cat-file", "-e", `${commitSha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  private isCommitMerged(baseRootPath: string, commitSha: string): boolean {
    try {
      this.execGit(baseRootPath, ["merge-base", "--is-ancestor", commitSha, "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private execGit(cwd: string, args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (error) {
      const message =
        error instanceof Error && "stderr" in error && typeof (error as { stderr?: unknown }).stderr === "string"
          ? ((error as { stderr: string }).stderr.trim() || error.message)
          : error instanceof Error
            ? error.message
            : "Git command failed";
      throw Object.assign(new Error(message), { statusCode: 400 });
    }
  }

  private persist(input: {
    runId: string;
    conversationId: string;
    runWorkspaceId: string | null;
    status: RunChangeApplicationStatus;
    appliedFiles: string[];
    skippedFiles: SkippedFileEntry[];
    errorMessage: string | null;
  }): RunChangeApplication {
    const now = nowIso();
    const record: RunChangeApplicationRecord = {
      id: crypto.randomUUID(),
      run_id: input.runId,
      conversation_id: input.conversationId,
      run_workspace_id: input.runWorkspaceId,
      status: input.status,
      applied_files_json: JSON.stringify(input.appliedFiles),
      skipped_files_json: JSON.stringify(input.skippedFiles),
      error_message: input.errorMessage,
      applied_at: input.status === "applied" ? now : null,
      created_at: now,
      updated_at: now,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO run_change_applications (
        id, run_id, conversation_id, run_workspace_id, status,
        applied_files_json, skipped_files_json, error_message,
        applied_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.run_id,
      record.conversation_id,
      record.run_workspace_id,
      record.status,
      record.applied_files_json,
      record.skipped_files_json,
      record.error_message,
      record.applied_at,
      record.created_at,
      record.updated_at,
    );

    return recordToApplication(record);
  }
}
