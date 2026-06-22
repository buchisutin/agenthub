import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ProjectFileChange,
  WorkspaceDiffResponse,
} from "../../shared/types.js";
import { filterRelativePaths, loadIgnorePatterns } from "../runs/path-ignore.js";
import { WorkspacesService } from "./workspaces.service.js";

function countNonEmptyLines(content: string): number {
  return content.split("\n").filter((line) => line.length > 0).length;
}

function resolveWorkspaceFile(rootPath: string, relativePath: string): string | null {
  const absolutePath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolutePath;
}

export class WorkspaceDiffService {
  constructor(private readonly workspacesService: WorkspacesService) {}

  getFileChanges(workspaceId: string): WorkspaceDiffResponse {
    const workspace = this.workspacesService.getById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const rootPath = path.resolve(workspace.root_path);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      throw new Error("Workspace path is invalid");
    }

    this.runGit(rootPath, ["rev-parse", "--verify", "HEAD"]);
    const ignorePatterns = loadIgnorePatterns(rootPath);
    const trackedChanges = this.runGit(rootPath, [
      "diff",
      "--name-status",
      "--no-renames",
      "HEAD",
      "--",
    ]).flatMap<ProjectFileChange>((line) => {
      const [rawStatus, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      if (!filePath || filterRelativePaths([filePath], ignorePatterns).length === 0) {
        return [];
      }
      const status = rawStatus.charAt(0);
      return [this.readTrackedChange(
        rootPath,
        filePath,
        status === "A" ? "create" : status === "D" ? "delete" : "edit",
      )];
    });
    const untracked = filterRelativePaths(
      this.runGit(rootPath, ["ls-files", "--others", "--exclude-standard", "--"]),
      ignorePatterns,
    );
    const untrackedChanges = untracked.flatMap<ProjectFileChange>((filePath) => {
      const absolutePath = resolveWorkspaceFile(rootPath, filePath);
      if (!absolutePath || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        return [];
      }
      const buffer = fs.readFileSync(absolutePath);
      const binary = buffer.includes(0);
      const newContent = binary ? "" : buffer.toString("utf8");
      return [{
        filePath,
        changeType: "create",
        oldContent: "",
        newContent,
        confidence: "exact",
        source: "filesystem",
        additions: binary ? 0 : countNonEmptyLines(newContent),
        deletions: 0,
        binary,
      }];
    });
    const files = [...trackedChanges, ...untrackedChanges]
      .sort((a, b) => a.filePath.localeCompare(b.filePath));

    return {
      workspaceId,
      baseRef: "HEAD",
      files,
      summary: files.reduce(
        (summary, file) => ({
          files: summary.files + 1,
          additions: summary.additions + file.additions,
          deletions: summary.deletions + file.deletions,
        }),
        { files: 0, additions: 0, deletions: 0 },
      ),
    };
  }

  private readTrackedChange(
    rootPath: string,
    filePath: string,
    changeType: ProjectFileChange["changeType"],
  ): ProjectFileChange {
    const oldBuffer = changeType === "create"
      ? Buffer.alloc(0)
      : execFileSync("git", ["show", `HEAD:${filePath}`], {
          cwd: rootPath,
          stdio: ["ignore", "pipe", "pipe"],
        });
    const absolutePath = resolveWorkspaceFile(rootPath, filePath);
    const newBuffer = changeType === "delete" || !absolutePath || !fs.existsSync(absolutePath)
      ? Buffer.alloc(0)
      : fs.readFileSync(absolutePath);
    const binary = oldBuffer.includes(0) || newBuffer.includes(0);
    const [numstat] = this.runGit(rootPath, ["diff", "--numstat", "HEAD", "--", filePath]);
    const [rawAdditions = "0", rawDeletions = "0"] = (numstat ?? "").split("\t");

    return {
      filePath,
      changeType,
      oldContent: binary ? "" : oldBuffer.toString("utf8"),
      newContent: binary ? "" : newBuffer.toString("utf8"),
      confidence: "exact",
      source: "filesystem",
      additions: rawAdditions === "-" ? 0 : Number(rawAdditions),
      deletions: rawDeletions === "-" ? 0 : Number(rawDeletions),
      binary,
    };
  }

  private runGit(rootPath: string, args: string[]): string[] {
    return execFileSync("git", args, {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
}
