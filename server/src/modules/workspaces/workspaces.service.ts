import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseClient } from "../../db/client.js";
import {
  BindWorkspaceInput,
  WorkspaceRecord,
  WorkspaceExecutionStatus,
  WorkspaceValidationResult,
} from "../../shared/types.js";

const nowIso = () => new Date().toISOString();
const WORKSPACE_STATUS_SAMPLE_LIMIT = 5;
const WORKSPACE_STATUS_IGNORES = [".DS_Store"];

export class WorkspacesService {
  constructor(private readonly database: DatabaseClient) {}

  private detectGitRepo(dirPath: string): { isGitRepo: boolean; gitRoot: string | null } {
    try {
      const topLevel = execSync("git rev-parse --show-toplevel", {
        cwd: dirPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (topLevel) {
        return {
          isGitRepo: true,
          gitRoot: topLevel,
        };
      }
    } catch {
      // Not a git repo.
    }

    return {
      isGitRepo: false,
      gitRoot: null,
    };
  }

  private listDirtyFiles(dirPath: string): string[] {
    try {
      const output = execSync("git status --porcelain --untracked-files=all", {
        cwd: dirPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (!output) {
        return [];
      }

      return output
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .flatMap((line) => {
          const payload = line.length > 3 ? line.slice(3) : "";
          return payload.split(" -> ").map((part) => part.trim());
        })
        .filter(Boolean)
        .filter((filePath) => filePath !== ".agenthub" && !filePath.startsWith(".agenthub/"))
        .filter(
          (filePath) =>
            !WORKSPACE_STATUS_IGNORES.includes(filePath) &&
            !filePath.split("/").some((segment) => WORKSPACE_STATUS_IGNORES.includes(segment)),
        );
    } catch {
      return [];
    }
  }

  private getLastCommitSha(dirPath: string): string | null {
    try {
      return execSync("git rev-parse --short HEAD", {
        cwd: dirPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim() || null;
    } catch {
      return null;
    }
  }

  private hasGitBaselineCommit(dirPath: string): boolean {
    try {
      execSync("git rev-parse --verify HEAD", {
        cwd: dirPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  private ensureGitWorkspaceReady(dirPath: string): { isGitRepo: boolean; gitRoot: string | null; error?: string } {
    let gitState = this.detectGitRepo(dirPath);

    try {
      if (!gitState.isGitRepo) {
        execSync("git init", {
          cwd: dirPath,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        gitState = this.detectGitRepo(dirPath);
      }

      const gitRoot = gitState.gitRoot ?? dirPath;
      if (gitState.isGitRepo && !this.hasGitBaselineCommit(gitRoot)) {
        execSync("git add -A", {
          cwd: gitRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        execSync(
          'git -c user.name="AgentHub" -c user.email="agenthub@local" -c commit.gpgsign=false commit --allow-empty -m "AgentHub workspace baseline"',
          {
            cwd: gitRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      }

      gitState = this.detectGitRepo(dirPath);
      return gitState;
    } catch (error) {
      return {
        ...gitState,
        error: error instanceof Error ? error.message : "Git initialization failed",
      };
    }
  }

  getById(id: string): WorkspaceRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT id, conversation_id, root_path, mode, created_at, updated_at
      FROM workspaces
      WHERE id = ?
    `);
    return (stmt.get(id) as WorkspaceRecord | undefined) ?? null;
  }

  getByConversationId(conversationId: string): WorkspaceRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT id, conversation_id, root_path, mode, created_at, updated_at
      FROM workspaces
      WHERE conversation_id = ?
    `);
    return (stmt.get(conversationId) as WorkspaceRecord | undefined) ?? null;
  }

  getExecutionStatusByConversationId(conversationId: string): WorkspaceExecutionStatus {
    const workspace = this.getByConversationId(conversationId);
    if (!workspace) {
      return {
        state: "unavailable",
        gitRoot: null,
        dirtyFilesCount: 0,
        dirtyFilesSample: [],
        lastCommit: null,
        suggestion: "Bind a workspace before starting agent runs.",
      };
    }
    return this.getExecutionStatus(workspace.root_path);
  }

  getExecutionStatus(rootPath: string): WorkspaceExecutionStatus {
    const resolvedRoot = path.resolve(rootPath);
    if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
      return {
        state: "unavailable",
        gitRoot: null,
        dirtyFilesCount: 0,
        dirtyFilesSample: [],
        lastCommit: null,
        suggestion: "Workspace path is unavailable.",
      };
    }

    const gitState = this.detectGitRepo(resolvedRoot);
    if (!gitState.isGitRepo || !gitState.gitRoot) {
      return {
        state: "unavailable",
        gitRoot: gitState.gitRoot,
        dirtyFilesCount: 0,
        dirtyFilesSample: [],
        lastCommit: null,
        suggestion: "Workspace must be a git repository before starting write tasks.",
      };
    }

    const dirtyFiles = this.listDirtyFiles(gitState.gitRoot);
    return {
      state: dirtyFiles.length > 0 ? "dirty" : "clean",
      gitRoot: gitState.gitRoot,
      dirtyFilesCount: dirtyFiles.length,
      dirtyFilesSample: dirtyFiles.slice(0, WORKSPACE_STATUS_SAMPLE_LIMIT),
      lastCommit: this.getLastCommitSha(gitState.gitRoot),
      suggestion:
        dirtyFiles.length > 0
          ? "Commit or stash local changes before starting write tasks."
          : "Workspace is ready for write tasks.",
    };
  }

  bindWorkspace(
    conversationId: string,
    input: BindWorkspaceInput,
  ): WorkspaceRecord {
    const resolvedRoot = path.resolve(input.rootPath);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error("Workspace path does not exist");
    }
    if (!fs.statSync(resolvedRoot).isDirectory()) {
      throw new Error("Workspace path must be a directory");
    }

    // Best-effort git baseline init for plain folders so downstream diff/apply features
    // always have a commit to compare against.
    this.ensureGitWorkspaceReady(resolvedRoot);

    const existing = this.getByConversationId(conversationId);
    const record: WorkspaceRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      conversation_id: conversationId,
      root_path: resolvedRoot,
      mode: "direct",
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO workspaces (id, conversation_id, root_path, mode, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        root_path = excluded.root_path,
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      record.id,
      record.conversation_id,
      record.root_path,
      record.mode,
      record.created_at,
      record.updated_at,
    );

    return record;
  }

  validateWorkspacePath(rootPath: string): WorkspaceValidationResult {
    const errors: string[] = [];
    const resolvedRoot = path.resolve(rootPath);

    if (!path.isAbsolute(rootPath)) {
      errors.push("Path must be absolute");
      return {
        rootPath: resolvedRoot,
        exists: false,
        isDirectory: false,
        isGitRepo: false,
        gitRoot: null,
        packageJsonExists: false,
        previewCapable: false,
        errors,
      };
    }

    const exists = fs.existsSync(resolvedRoot);
    if (!exists) {
      errors.push("Path does not exist");
    }

    let isDirectory = false;
    if (exists) {
      try {
        isDirectory = fs.statSync(resolvedRoot).isDirectory();
      } catch {
        errors.push("Cannot read path stats");
      }
      if (!isDirectory) {
        errors.push("Path is not a directory");
      }
    }

    let isGitRepo = false;
    let gitRoot: string | null = null;
    if (exists && isDirectory) {
      const gitState = this.ensureGitWorkspaceReady(resolvedRoot);
      isGitRepo = gitState.isGitRepo;
      gitRoot = gitState.gitRoot;
      if (gitState.error) {
        errors.push(`Git initialization warning: ${gitState.error}`);
      }
    }

    let packageJsonExists = false;
    let previewCapable = false;
    if (exists && isDirectory) {
      const pkgPath = path.join(resolvedRoot, "package.json");
      packageJsonExists = fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile();

      const indexPath = path.join(resolvedRoot, "index.html");
      const indexExists = fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();

      if (packageJsonExists) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
          const scripts = pkg.scripts as Record<string, string> | undefined;
          if (scripts && (scripts.dev || scripts.start)) {
            previewCapable = true;
          }
        } catch {
          // Invalid package.json
        }
      }

      if (!previewCapable && indexExists) {
        previewCapable = true;
      }
    }

    return {
      rootPath: resolvedRoot,
      exists,
      isDirectory,
      isGitRepo,
      gitRoot,
      packageJsonExists,
      previewCapable,
      errors,
    };
  }
}
