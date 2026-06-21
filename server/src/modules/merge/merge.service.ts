import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseClient } from "../../db/client.js";
import {
  ConflictResolutionChoice,
  MergeConflictFile,
  RunMerge,
  RunMergeRecord,
  RunMergeStatus,
} from "../../shared/types.js";
import {
  indexResolutions,
  MergeResolutionResult,
  MergeServiceDeps,
  PersistMergeInput,
  recordToRunMerge,
} from "./merge.types.js";

const MAX_LLM_FILE_BYTES = 100 * 1024;

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafePath(filePath: string): void {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Unsafe file path: ${filePath}`);
  }
  const normalized = path.normalize(filePath);
  if (normalized.startsWith("..") || normalized.includes(`..${path.sep}`)) {
    throw new Error(`Unsafe file path: ${filePath}`);
  }
}

function resolveUnderRoot(rootPath: string, filePath: string): string {
  assertSafePath(filePath);
  const resolvedRoot = path.resolve(rootPath);
  const targetPath = path.resolve(resolvedRoot, filePath);
  if (!targetPath.startsWith(`${resolvedRoot}${path.sep}`) && targetPath !== resolvedRoot) {
    throw new Error(`Path escapes workspace: ${filePath}`);
  }
  return targetPath;
}

function readTextFile(filePath: string): string | null {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString("utf8");
}

function fileTooLarge(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size > MAX_LLM_FILE_BYTES;
  } catch {
    return false;
  }
}

function buildConflict(
  change: { filePath: string; changeType: "create" | "edit" | "delete" | "unknown"; oldContent: string; newContent: string },
  currentContent: string | null,
  reason: string,
  llmAvailable: boolean,
): MergeConflictFile {
  return {
    filePath: change.filePath,
    changeType: change.changeType,
    reason,
    baseContent: change.oldContent,
    currentContent: currentContent ?? "",
    runContent: change.newContent,
    llmAvailable,
  };
}

export class MergeService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly deps: MergeServiceDeps,
  ) {}

  getByRunId(runId: string): RunMerge | null {
    const stmt = this.database.db.prepare("SELECT * FROM run_merges WHERE run_id = ?");
    const row = stmt.get(runId) as RunMergeRecord | undefined;
    return row ? recordToRunMerge(row) : null;
  }

  mergeRunToMain(runId: string): MergeResolutionResult {
    const existing = this.getByRunId(runId);
    if (
      existing &&
      (existing.status === "auto_merged" ||
        existing.status === "conflict_resolved" ||
        existing.status === "needs_approval")
    ) {
      return existing.status === "needs_approval"
        ? { status: "needs_approval", merge: existing }
        : { status: "merged", merge: existing };
    }

    const run = this.deps.getRun(runId);
    if (!run) {
      throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    }
    if (run.status !== "completed") {
      throw Object.assign(new Error("Can only merge completed runs"), { statusCode: 400 });
    }

    const runWorkspace = this.deps.getRunWorkspace(runId);
    const changes = this.deps.getFileChanges(runId);
    if ((!runWorkspace || runWorkspace.status === "cleaned") && changes.length === 0) {
      const merge = this.persist({
        runId: run.id,
        conversationId: run.conversation_id,
        taskId: run.task_id,
        assignmentId: run.assignment_id,
        status: "auto_merged",
        appliedFiles: [],
        conflicts: [],
        blockedReason: null,
        mergedAt: nowIso(),
        approvalId: existing?.approvalId ?? null,
      });
      return { status: "merged", merge };
    }
    if (!runWorkspace || runWorkspace.status === "cleaned") {
      throw Object.assign(new Error("Run workspace not available"), { statusCode: 400 });
    }

    const mainRootPath = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!mainRootPath) {
      throw Object.assign(new Error("Main workspace not found"), { statusCode: 400 });
    }

    const runRootPath = path.resolve(runWorkspace.root_path);
    const mainRoot = path.resolve(mainRootPath);
    const appliedFiles: string[] = [];
    const conflicts: MergeConflictFile[] = [];

    for (const change of changes) {
      const runFilePath = resolveUnderRoot(runRootPath, change.filePath);
      const mainFilePath = resolveUnderRoot(mainRoot, change.filePath);

      if (change.changeType === "unknown" || change.changeType === "delete") {
        conflicts.push(
          buildConflict(change, readTextFile(mainFilePath), "Delete and unknown changes require review", false),
        );
        continue;
      }

      if (!fs.existsSync(runFilePath)) {
        conflicts.push(
          buildConflict(change, readTextFile(mainFilePath), "Run file no longer exists", false),
        );
        continue;
      }

      if (fileTooLarge(runFilePath)) {
        conflicts.push(
          buildConflict(change, readTextFile(mainFilePath), "File is larger than 100KB and requires review", false),
        );
        continue;
      }

      const runContent = readTextFile(runFilePath);
      if (runContent === null) {
        conflicts.push(
          buildConflict(change, readTextFile(mainFilePath), "Binary or unsupported file requires review", false),
        );
        continue;
      }

      const currentContent = readTextFile(mainFilePath);
      const mainMatchesBase =
        currentContent === change.oldContent ||
        (change.changeType === "create" && currentContent === null && !change.oldContent);
      const alreadyMerged = currentContent === runContent;

      if (alreadyMerged) {
        appliedFiles.push(change.filePath);
        continue;
      }

      if (mainMatchesBase) {
        fs.mkdirSync(path.dirname(mainFilePath), { recursive: true });
        fs.writeFileSync(mainFilePath, runContent, "utf8");
        appliedFiles.push(change.filePath);
        continue;
      }

      conflicts.push(
        buildConflict(
          { ...change, newContent: runContent },
          currentContent,
          "Main workspace changed since this run started",
          Boolean(this.deps.canAutoResolveConflict),
        ),
      );
    }

    const merge = this.persist({
      runId: run.id,
      conversationId: run.conversation_id,
      taskId: run.task_id,
      assignmentId: run.assignment_id,
      status: conflicts.length > 0
        ? "needs_approval"
        : "auto_merged",
      appliedFiles,
      conflicts,
      blockedReason: conflicts.length > 0 ? "Manual review required before merge can complete" : null,
      mergedAt: conflicts.length > 0 ? null : nowIso(),
      approvalId: existing?.approvalId ?? null,
    });

    if (conflicts.length === 0 && appliedFiles.length > 0) {
      this.deps.onWorkspaceChanged?.({
        type: "workspace_changed",
        conversationId: run.conversation_id,
        workspaceId: run.workspace_id,
        reason: "merge_completed",
      });
    }

    return conflicts.length > 0
      ? { status: "needs_approval", merge }
      : { status: "merged", merge };
  }

  attachApproval(runId: string, approvalId: string): RunMerge {
    const merge = this.getByRunId(runId);
    if (!merge) {
      throw Object.assign(new Error("Merge record not found"), { statusCode: 404 });
    }
    return this.persist({
      runId: merge.runId,
      conversationId: merge.conversationId,
      taskId: merge.taskId,
      assignmentId: merge.assignmentId,
      status: merge.status,
      appliedFiles: merge.appliedFiles,
      conflicts: merge.conflicts,
      blockedReason: merge.blockedReason,
      approvalId,
      mergedAt: merge.mergedAt,
    });
  }

  resolveConflicts(
    runId: string,
    resolutions: ConflictResolutionChoice[],
  ): RunMerge {
    const merge = this.getByRunId(runId);
    if (!merge) {
      throw Object.assign(new Error("Merge record not found"), { statusCode: 404 });
    }
    if (merge.status !== "needs_approval") {
      return merge;
    }

    const run = this.deps.getRun(runId);
    const runWorkspace = this.deps.getRunWorkspace(runId);
    if (!run || !runWorkspace) {
      throw Object.assign(new Error("Run context not found"), { statusCode: 404 });
    }
    const mainRootPath = this.deps.getBaseWorkspaceRootPath(run.workspace_id);
    if (!mainRootPath) {
      throw Object.assign(new Error("Main workspace not found"), { statusCode: 400 });
    }

    const resolutionByPath = indexResolutions(resolutions);
    const unresolved = merge.conflicts
      .filter((conflict) => !resolutionByPath.has(conflict.filePath));
    if (unresolved.length > 0) {
      throw Object.assign(
        new Error(`Missing resolutions for: ${unresolved.map((item) => item.filePath).join(", ")}`),
        { statusCode: 400 },
      );
    }

    const runRootPath = path.resolve(runWorkspace.root_path);
    const mainRoot = path.resolve(mainRootPath);
    const appliedFiles = [...merge.appliedFiles];
    const remainingConflicts: MergeConflictFile[] = [];

    for (const conflict of merge.conflicts) {
      const strategy = resolutionByPath.get(conflict.filePath);
      const mainFilePath = resolveUnderRoot(mainRoot, conflict.filePath);
      const runFilePath = resolveUnderRoot(runRootPath, conflict.filePath);

      if (strategy === "use_base") {
        continue;
      }

      if (strategy === "use_llm") {
        remainingConflicts.push({
          ...conflict,
          reason: "LLM conflict resolution is not configured for this server",
          llmAvailable: false,
        });
        continue;
      }

      const runContent = readTextFile(runFilePath);
      if (runContent === null) {
        remainingConflicts.push({
          ...conflict,
          reason: "Run file is missing or no longer readable",
        });
        continue;
      }

      fs.mkdirSync(path.dirname(mainFilePath), { recursive: true });
      fs.writeFileSync(mainFilePath, runContent, "utf8");
      appliedFiles.push(conflict.filePath);
    }

    const resolved = this.persist({
      runId: merge.runId,
      conversationId: merge.conversationId,
      taskId: merge.taskId,
      assignmentId: merge.assignmentId,
      status: remainingConflicts.length > 0 ? "needs_approval" : "conflict_resolved",
      appliedFiles: Array.from(new Set(appliedFiles)),
      conflicts: remainingConflicts,
      blockedReason: remainingConflicts.length > 0 ? "Manual review still required for unresolved conflicts" : null,
      approvalId: merge.approvalId,
      mergedAt: remainingConflicts.length > 0 ? null : nowIso(),
    });
    if (remainingConflicts.length === 0 && appliedFiles.length > 0) {
      this.deps.onWorkspaceChanged?.({
        type: "workspace_changed",
        conversationId: run.conversation_id,
        workspaceId: run.workspace_id,
        reason: "merge_completed",
      });
    }
    return resolved;
  }

  private persist(input: PersistMergeInput): RunMerge {
    const now = nowIso();
    const existing = this.getByRunId(input.runId);
    const record: RunMergeRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      run_id: input.runId,
      conversation_id: input.conversationId,
      task_id: input.taskId,
      assignment_id: input.assignmentId,
      status: input.status,
      applied_files_json: JSON.stringify(input.appliedFiles),
      conflict_files_json: JSON.stringify(input.conflicts),
      blocked_reason: input.blockedReason,
      approval_id: input.approvalId ?? null,
      merged_at: input.mergedAt ?? null,
      created_at: existing?.createdAt ?? now,
      updated_at: now,
    };

    this.database.db.prepare(`
      INSERT INTO run_merges (
        id, run_id, conversation_id, task_id, assignment_id, status,
        applied_files_json, conflict_files_json, blocked_reason, approval_id,
        merged_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        task_id = excluded.task_id,
        assignment_id = excluded.assignment_id,
        status = excluded.status,
        applied_files_json = excluded.applied_files_json,
        conflict_files_json = excluded.conflict_files_json,
        blocked_reason = excluded.blocked_reason,
        approval_id = excluded.approval_id,
        merged_at = excluded.merged_at,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.run_id,
      record.conversation_id,
      record.task_id,
      record.assignment_id,
      record.status,
      record.applied_files_json,
      record.conflict_files_json,
      record.blocked_reason,
      record.approval_id,
      record.merged_at,
      record.created_at,
      record.updated_at,
    );

    return recordToRunMerge(record);
  }
}
