import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseClient } from "../../db/client.js";
import {
  AgentRunRecord,
  FileChange,
  RunDetail,
  RunEventRecord,
  RunStatus,
  RunSummary,
  RuntimeEvent,
} from "../../shared/types.js";
import { filterRelativePaths, loadIgnorePatterns } from "./path-ignore.js";

const nowIso = () => new Date().toISOString();
const COPY_DIFF_EXCLUDES = new Set([".git", ".agenthub"]);
const WRITE_TOOL_NAMES = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Create",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function extractFilePath(input: Record<string, unknown> | null): string | null {
  return asString(input?.file_path) ?? asString(input?.path) ?? null;
}

function extractToolOldContent(input: Record<string, unknown> | null): string | null {
  return (
    asString(input?.old_content) ??
    asString(input?.oldContent) ??
    asString(input?.old_string) ??
    null
  );
}

function extractToolNewContent(input: Record<string, unknown> | null): string | null {
  const direct =
    asString(input?.content) ??
    asString(input?.new_content) ??
    asString(input?.newContent) ??
    asString(input?.new_string);
  if (direct) {
    return direct;
  }

  const edits = Array.isArray(input?.edits) ? input.edits : null;
  if (!edits) {
    return null;
  }

  const pieces = edits
    .map((edit) => asRecord(edit))
    .map((edit) => asString(edit?.new_string) ?? asString(edit?.content))
    .filter((value): value is string => Boolean(value));

  return pieces.length > 0 ? pieces.join("\n") : null;
}

function extractToolInput(event: RunEventRecord): Record<string, unknown> | null {
  const payload = event.payload_json;
  const input = asRecord(payload.input);
  if (input) {
    return input;
  }

  const parsedInput = asRecord(payload.parsedInput);
  if (parsedInput) {
    return parsedInput;
  }

  const partialJson = asString(payload.partialJson);
  return partialJson ? parseJsonObject(partialJson) : null;
}

function resolveWorkspacePath(
  rootPath: string,
  filePath: string,
): { absolutePath: string; relativePath: string } | null {
  const normalizedRoot = path.resolve(rootPath);
  const candidate = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(normalizedRoot, filePath);
  const relativePath = path.relative(normalizedRoot, candidate);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return {
    absolutePath: candidate,
    relativePath: relativePath.split(path.sep).join("/"),
  };
}

function collectWorkspaceFiles(
  rootPath: string,
  ignorePatterns: string[],
  currentPath = rootPath,
): string[] {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (COPY_DIFF_EXCLUDES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
    const normalizedRelativePath = entry.isDirectory() ? `${relativePath}/` : relativePath;
    if (filterRelativePaths([normalizedRelativePath], ignorePatterns).length === 0) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectWorkspaceFiles(rootPath, ignorePatterns, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(relativePath);
  }

  return files;
}

interface ReadSnapshot {
  content: string;
}

interface TouchedFileState {
  filePath: string;
  toolName: string;
  oldContentFromTool: string | null;
  newContentFromTool: string | null;
  readSnapshot: ReadSnapshot | null;
}

function parseRunEvent(row: Record<string, unknown>): RunEventRecord {
  return {
    id: String(row.id),
    event_id: row.event_id ? String(row.event_id) : String(row.id),
    run_id: String(row.run_id),
    conversation_id: String(row.conversation_id),
    event_type: row.event_type as RunEventRecord["event_type"],
    event_family: row.event_family ? String(row.event_family) : String(row.event_type),
    dedup_key:
      row.dedup_key ? String(row.dedup_key) : `${String(row.run_id)}:${Number(row.seq)}`,
    seq: Number(row.seq),
    payload_json: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    occurred_at: row.occurred_at ? String(row.occurred_at) : String(row.created_at),
    created_at: String(row.created_at),
  };
}

export class RunsService {
  constructor(private readonly database: DatabaseClient) {}

  create(input: {
    conversationId: string;
    taskId: string | null;
    assignmentId?: string | null;
    agentId: string;
    runtimeId: string | null;
    agentSessionId: string | null;
    sourceMessageId?: string | null;
    workspaceId: string;
    prompt: string;
    triggerType?: AgentRunRecord["trigger_type"];
    triggerSourceId?: string | null;
    requestedBy?: string | null;
  }): AgentRunRecord {
    const record: AgentRunRecord = {
      id: crypto.randomUUID(),
      conversation_id: input.conversationId,
      task_id: input.taskId,
      assignment_id: input.assignmentId ?? null,
      agent_id: input.agentId,
      runtime_id: input.runtimeId,
      agent_session_id: input.agentSessionId,
      source_message_id: input.sourceMessageId ?? null,
      workspace_id: input.workspaceId,
      prompt: input.prompt,
      trigger_type: input.triggerType ?? "chat",
      trigger_source_id: input.triggerSourceId ?? input.conversationId,
      requested_by: input.requestedBy ?? "user",
      status: "queued",
      pid: null,
      exit_code: null,
      error_message: null,
      started_at: nowIso(),
      finished_at: null,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO agent_runs (
        id, conversation_id, task_id, agent_id, runtime_id, agent_session_id,
        assignment_id, source_message_id, workspace_id, prompt, trigger_type, trigger_source_id, requested_by, status,
        pid, exit_code, error_message, started_at, finished_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.conversation_id,
      record.task_id,
      record.agent_id,
      record.runtime_id,
      record.agent_session_id,
      record.assignment_id,
      record.source_message_id,
      record.workspace_id,
      record.prompt,
      record.trigger_type,
      record.trigger_source_id,
      record.requested_by,
      record.status,
      record.pid,
      record.exit_code,
      record.error_message,
      record.started_at,
      record.finished_at,
    );
    return record;
  }

  updateStatus(
    runId: string,
    input: {
      status: RunStatus;
      pid?: number | null;
      exitCode?: number | null;
      errorMessage?: string | null;
      finishedAt?: string | null;
    },
  ): void {
    const stmt = this.database.db.prepare(`
      UPDATE agent_runs
      SET status = ?,
          pid = COALESCE(?, pid),
          exit_code = ?,
          error_message = ?,
          finished_at = ?
      WHERE id = ?
    `);
    stmt.run(
      input.status,
      input.pid ?? null,
      input.exitCode ?? null,
      input.errorMessage ?? null,
      input.finishedAt ?? null,
      runId,
    );
  }

  appendEvent(
    runId: string,
    conversationId: string,
    seq: number,
    event: RuntimeEvent,
  ): RunEventRecord {
    const timestamp = nowIso();
    const record: RunEventRecord = {
      id: crypto.randomUUID(),
      event_id: crypto.randomUUID(),
      run_id: runId,
      conversation_id: conversationId,
      event_type: event.type,
      event_family: event.type,
      dedup_key: `${runId}:${seq}:${event.type}`,
      seq,
      payload_json: event as unknown as Record<string, unknown>,
      occurred_at: timestamp,
      created_at: timestamp,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO run_events (
        id, event_id, run_id, conversation_id, event_type, event_family,
        dedup_key, seq, payload_json, occurred_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.event_id,
      record.run_id,
      record.conversation_id,
      record.event_type,
      record.event_family,
      record.dedup_key,
      record.seq,
      JSON.stringify(record.payload_json),
      record.occurred_at,
      record.created_at,
    );

    return record;
  }

  listByConversationId(conversationId: string): RunSummary[] {
    const stmt = this.database.db.prepare(`
      SELECT
        r.*,
        COUNT(e.id) AS event_count
      FROM agent_runs r
      LEFT JOIN run_events e ON e.run_id = r.id
      WHERE r.conversation_id = ?
      GROUP BY r.id
      ORDER BY r.started_at DESC
    `);
    return stmt.all(conversationId).map((row) => ({
      ...(row as unknown as AgentRunRecord),
      pid: row.pid === null ? null : Number(row.pid),
      exit_code: row.exit_code === null ? null : Number(row.exit_code),
      event_count: Number(row.event_count),
    }));
  }

  getById(runId: string): AgentRunRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agent_runs
      WHERE id = ?
    `);
    return (stmt.get(runId) as AgentRunRecord | undefined) ?? null;
  }

  getDetail(runId: string): RunDetail | null {
    const run = this.getById(runId);
    if (!run) {
      return null;
    }

    const eventsStmt = this.database.db.prepare(`
      SELECT *
      FROM run_events
      WHERE run_id = ?
      ORDER BY seq ASC
    `);
    const events = eventsStmt
      .all(runId)
      .map((row) => parseRunEvent(row as Record<string, unknown>));

    return { ...run, events };
  }

  getRunWorkspace(runId: string): { root_path: string; mode: string; branch_name: string | null; status: string; error_message: string | null } | null {
    const stmt = this.database.db.prepare(`
      SELECT root_path, mode, branch_name, status, error_message
      FROM run_workspaces
      WHERE run_id = ?
      LIMIT 1
    `);
    const row = stmt.get(runId) as { root_path: string; mode: string; branch_name: string | null; status: string; error_message: string | null } | undefined;
    return row ?? null;
  }

  getFileChanges(runId: string): FileChange[] {
    const run = this.getDetail(runId);
    if (!run) {
      throw new Error("Run not found");
    }

    const cleanedStmt = this.database.db.prepare(`
      SELECT status FROM run_workspaces
      WHERE run_id = ? AND status = 'cleaned'
      LIMIT 1
    `);
    const cleanedWs = cleanedStmt.get(runId) as { status: string } | undefined;
    if (cleanedWs) {
      throw new Error("Run workspace has been cleaned");
    }

    const runWorkspaceStmt = this.database.db.prepare(`
      SELECT root_path, base_ref, mode FROM run_workspaces
      WHERE run_id = ? AND status = 'ready'
      LIMIT 1
    `);
    const runWorkspace = runWorkspaceStmt.get(runId) as
      | { root_path: string; base_ref: string | null; mode: string }
      | undefined;
    const runWorkspaceValid =
      runWorkspace?.root_path &&
      fs.existsSync(runWorkspace.root_path) &&
      fs.statSync(runWorkspace.root_path).isDirectory();

    const workspaceStmt = this.database.db.prepare(`
      SELECT root_path
      FROM workspaces
      WHERE id = ?
    `);
    const workspace = workspaceStmt.get(run.workspace_id) as
      | { root_path: string }
      | undefined;
    if (!workspace?.root_path) {
      throw new Error("Workspace not bound");
    }

    if (!runWorkspaceValid || !runWorkspace?.root_path) {
      return [];
    }

    if (!runWorkspace.base_ref) {
      const baseRootPath = path.resolve(workspace.root_path);
      const runRootPath = path.resolve(runWorkspace.root_path);
      const ignorePatterns = loadIgnorePatterns(baseRootPath);
      const filePaths = new Set<string>([
        ...collectWorkspaceFiles(baseRootPath, ignorePatterns),
        ...collectWorkspaceFiles(runRootPath, ignorePatterns),
      ]);

      const changes: FileChange[] = [];
      for (const filePath of filePaths) {
        const basePath = resolveWorkspacePath(baseRootPath, filePath);
        const runPath = resolveWorkspacePath(runRootPath, filePath);
        if (!basePath || !runPath) {
          continue;
        }

        const oldContent = this.readWorkspaceFile(basePath.absolutePath);
        const newContent = this.readWorkspaceFile(runPath.absolutePath);
        if (oldContent === newContent) {
          continue;
        }

        const changeType: FileChange["changeType"] =
          oldContent === null ? "create" : newContent === null ? "delete" : "edit";

        changes.push({
          filePath,
          changeType,
          oldContent: oldContent ?? "",
          newContent: newContent ?? "",
          confidence: "exact",
          source: "filesystem",
        });
      }

      return changes.sort((a, b) => a.filePath.localeCompare(b.filePath));
    }

    const workspaceRootPath = runWorkspace.root_path;
    const baseRef = runWorkspace.base_ref;
    const ignorePatterns = loadIgnorePatterns(path.resolve(workspace.root_path));
    const fileStatuses = new Map<string, FileChange["changeType"]>();

    const diffLines = this.runGitLines(workspaceRootPath, [
      "diff",
      "--name-status",
      "--no-renames",
      baseRef,
      "--",
    ]);
    for (const line of diffLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const [rawStatus, ...rest] = trimmed.split("\t");
      const filePath = rest.join("\t").trim();
      if (!filePath) {
        continue;
      }
      if (filterRelativePaths([filePath], ignorePatterns).length === 0) {
        continue;
      }
      const status = rawStatus.trim().charAt(0);
      fileStatuses.set(
        filePath,
        status === "A" ? "create" :
        status === "D" ? "delete" :
        "edit",
      );
    }

    const untrackedLines = this.runGitLines(workspaceRootPath, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
    ]);
    for (const line of untrackedLines) {
      const filePath = line.trim();
      if (!filePath || fileStatuses.has(filePath)) {
        continue;
      }
      if (filterRelativePaths([filePath], ignorePatterns).length === 0) {
        continue;
      }
      fileStatuses.set(filePath, "create");
    }

    const changes: FileChange[] = [];
    for (const [filePath, changeType] of fileStatuses.entries()) {
      const safePath = resolveWorkspacePath(workspaceRootPath, filePath);
      if (!safePath) {
        continue;
      }

      const oldContent = this.readGitFileAtRef(workspaceRootPath, baseRef, filePath);
      const newContent = this.readWorkspaceFile(safePath.absolutePath);

      changes.push({
        filePath,
        changeType,
        oldContent: oldContent ?? "",
        newContent: newContent ?? "",
        confidence: oldContent !== null || changeType === "create" ? "exact" : "best_effort",
        source: "filesystem",
      });
    }

    return changes.sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  private runGitLines(cwd: string, args: string[]): string[] {
    try {
      const output = execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return output
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private readGitFileAtRef(cwd: string, ref: string, filePath: string): string | null {
    try {
      const output = execFileSync("git", ["show", `${ref}:${filePath}`], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return normalizeLineEndings(output);
    } catch {
      return null;
    }
  }

  private readWorkspaceFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return null;
      }
      return normalizeLineEndings(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  nextEventSeq(runId: string): number {
    const stmt = this.database.db.prepare(`
      SELECT COALESCE(MAX(seq), 0) AS max_seq
      FROM run_events
      WHERE run_id = ?
    `);
    const row = stmt.get(runId) as { max_seq: number };
    return Number(row.max_seq) + 1;
  }
}
