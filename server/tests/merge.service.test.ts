import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseClient } from "../src/db/client.js";
import { MergeService } from "../src/modules/merge/merge.service.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const target = tempRoots.pop();
    if (target) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

function createMergeHarness() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-merge-"));
  tempRoots.push(tempRoot);
  const mainRoot = path.join(tempRoot, "main");
  const runRoot = path.join(tempRoot, "run");
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(runRoot, { recursive: true });
  const database = new DatabaseClient(path.join(tempRoot, "test.sqlite"));
  const now = new Date().toISOString();
  database.db.prepare(`
    INSERT INTO conversations (id, title, type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("conv-1", "Merge", "single", now, now);
  database.db.prepare(`
    INSERT INTO workspaces (id, conversation_id, root_path, mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("workspace-1", "conv-1", mainRoot, "direct", now, now);
  database.db.prepare(`
    INSERT INTO tasks (id, conversation_id, title, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("task-1", "conv-1", "Merge task", "running", 1, now, now);
  database.db.prepare(`
    INSERT INTO agents (
      id, name, slug, platform, adapter_type, status, enabled, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("agent-1", "Agent", "agent", "claude-cli", "claude_cli", "active", 1, 0, now, now);
  database.db.prepare(`
    INSERT INTO task_assignments (
      id, task_id, conversation_id, agent_id, status, assigned_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run("assignment-1", "task-1", "conv-1", "agent-1", "running", now);
  database.db.prepare(`
    INSERT INTO agent_runs (
      id, conversation_id, task_id, assignment_id, agent_id, workspace_id, prompt, status, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("run-1", "conv-1", "task-1", "assignment-1", "agent-1", "workspace-1", "merge", "completed", now, now);

  const baseDeps = {
    getRun: () => ({
      id: "run-1",
      conversation_id: "conv-1",
      task_id: "task-1",
      assignment_id: "assignment-1",
      workspace_id: "workspace-1",
      agent_id: "agent-1",
      status: "completed",
    }),
    getRunWorkspace: () => ({
      root_path: runRoot,
      status: "ready",
    }),
    getBaseWorkspaceRootPath: () => mainRoot,
    getFileChanges: () => [],
  };

  return { database, baseDeps, mainRoot, runRoot };
}

describe("MergeService", () => {
  it("auto merges files when main workspace still matches base content", () => {
    const harness = createMergeHarness();
    const filePath = "src/app.ts";
    fs.mkdirSync(path.join(harness.mainRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(harness.runRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(harness.mainRoot, filePath), "old\n", "utf8");
    fs.writeFileSync(path.join(harness.runRoot, filePath), "new\n", "utf8");

    const service = new MergeService(harness.database, {
      ...harness.baseDeps,
      getFileChanges: () => [{
        filePath,
        changeType: "edit",
        oldContent: "old\n",
        newContent: "new\n",
      }],
    });

    const result = service.mergeRunToMain("run-1");
    expect(result.status).toBe("merged");
    expect(result.merge.status).toBe("auto_merged");
    expect(fs.readFileSync(path.join(harness.mainRoot, filePath), "utf8")).toBe("new\n");
  });

  it("creates merge review when main workspace diverged from base content", () => {
    const harness = createMergeHarness();
    const filePath = "src/app.ts";
    fs.mkdirSync(path.join(harness.mainRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(harness.runRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(harness.mainRoot, filePath), "main-current\n", "utf8");
    fs.writeFileSync(path.join(harness.runRoot, filePath), "run-new\n", "utf8");

    const service = new MergeService(harness.database, {
      ...harness.baseDeps,
      getFileChanges: () => [{
        filePath,
        changeType: "edit",
        oldContent: "base-old\n",
        newContent: "run-new\n",
      }],
    });

    const result = service.mergeRunToMain("run-1");
    expect(result.status).toBe("needs_approval");
    expect(result.merge.conflicts).toHaveLength(1);
    expect(result.merge.conflicts[0]?.currentContent).toBe("main-current\n");
  });

  it("applies approved use_run conflict resolutions back into the main workspace", () => {
    const harness = createMergeHarness();
    const filePath = "src/app.ts";
    fs.mkdirSync(path.join(harness.mainRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(harness.runRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(harness.mainRoot, filePath), "main-current\n", "utf8");
    fs.writeFileSync(path.join(harness.runRoot, filePath), "run-new\n", "utf8");

    const service = new MergeService(harness.database, {
      ...harness.baseDeps,
      getFileChanges: () => [{
        filePath,
        changeType: "edit",
        oldContent: "base-old\n",
        newContent: "run-new\n",
      }],
    });

    service.mergeRunToMain("run-1");
    const resolved = service.resolveConflicts("run-1", [{ filePath, strategy: "use_run" }]);
    expect(resolved.status).toBe("conflict_resolved");
    expect(fs.readFileSync(path.join(harness.mainRoot, filePath), "utf8")).toBe("run-new\n");
  });
});
