import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseClient } from "../src/db/client.js";
import { WorkspacesService } from "../src/modules/workspaces/workspaces.service.js";

const tempRoots: string[] = [];
const databases: DatabaseClient[] = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

function createWorkspaceRepo() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-workspace-status-"));
  tempRoots.push(tempRoot);

  const workspacePath = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  execSync("git init", { cwd: workspacePath, stdio: "ignore" });
  execSync("git config user.name AgentHub", { cwd: workspacePath, stdio: "ignore" });
  execSync("git config user.email agenthub@local", { cwd: workspacePath, stdio: "ignore" });
  fs.writeFileSync(path.join(workspacePath, "README.md"), "baseline\n");
  execSync("git add README.md", { cwd: workspacePath, stdio: "ignore" });
  execSync('git commit -m "baseline"', { cwd: workspacePath, stdio: "ignore" });

  const db = new DatabaseClient(path.join(tempRoot, "test.sqlite"));
  databases.push(db);
  const service = new WorkspacesService(db);

  return { workspacePath, service };
}

describe("WorkspacesService execution status", () => {
  it("ignores .DS_Store and .agenthub paths when computing dirty status", () => {
    const { workspacePath, service } = createWorkspaceRepo();

    fs.writeFileSync(path.join(workspacePath, ".DS_Store"), "finder");
    fs.mkdirSync(path.join(workspacePath, ".agenthub", "worktrees", "run-1"), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, ".agenthub", "worktrees", "run-1", "note.txt"),
      "temp",
    );

    const status = service.getExecutionStatus(workspacePath);

    expect(status.state).toBe("clean");
    expect(status.dirtyFilesCount).toBe(0);
    expect(status.dirtyFilesSample).toEqual([]);
  });

  it("still reports real source changes as dirty", () => {
    const { workspacePath, service } = createWorkspaceRepo();

    fs.writeFileSync(path.join(workspacePath, "index.ts"), "console.log('hi');\n");

    const status = service.getExecutionStatus(workspacePath);

    expect(status.state).toBe("dirty");
    expect(status.dirtyFilesCount).toBe(1);
    expect(status.dirtyFilesSample).toEqual(["index.ts"]);
  });
});
