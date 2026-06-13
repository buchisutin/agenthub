import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentHubServer } from "../src/app.js";
import { WorkspaceIsolationService } from "../src/modules/workspaces/workspace-isolation.service.js";
import { DatabaseClient } from "../src/db/client.js";
import inject from "light-my-request";
import { createTestHarness, waitFor } from "./helpers.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix = "agenthub-isolation-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function makeDbClient(dir: string) {
  const dbPath = path.join(dir, "test.sqlite");
  return new DatabaseClient(dbPath);
}

function makeGitRepo(dir: string) {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "# test");
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync("git commit -m 'init'", { cwd: dir, stdio: "ignore" });
}

describe("WorkspaceIsolationService", () => {
  let tempDir: string;
  let db: DatabaseClient;
  let service: WorkspaceIsolationService;

  beforeEach(() => {
    tempDir = makeTempDir();
    db = makeDbClient(tempDir);
    // Disable FK constraints so unit tests don't need to create referenced rows
    db.db.exec("PRAGMA foreign_keys = OFF");
    service = new WorkspaceIsolationService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("git_worktree mode", () => {
    it("creates a git worktree for a git repo", async () => {
      const baseDir = path.join(tempDir, "myrepo");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      const result = await service.createForRun({
        runId: "run-abc123",
        conversationId: "conv-1",
        baseWorkspaceId: "ws-1",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.mode).toBe("git_worktree");
      expect(result.status).toBe("ready");
      expect(result.root_path).toBe(path.join(baseDir, ".agenthub", "worktrees", "run-abc123"));
      expect(result.branch_name).toMatch(/^agenthub\/run-runabc1/);
      expect(fs.existsSync(result.root_path)).toBe(true);
      expect(fs.statSync(result.root_path).isDirectory()).toBe(true);
    });

    it("persists the run workspace record in db", async () => {
      const baseDir = path.join(tempDir, "repo2");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      const result = await service.createForRun({
        runId: "run-xyz789",
        conversationId: "conv-2",
        baseWorkspaceId: "ws-2",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.run_id).toBe("run-xyz789");
      const fetched = service.getByRunId("run-xyz789");
      expect(fetched).not.toBeNull();
      expect(fetched?.status).toBe("ready");
      expect(fetched?.mode).toBe("git_worktree");
    });

    it("handles branch already exists by appending suffix", async () => {
      const baseDir = path.join(tempDir, "repo3");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      const runId = "run-dup123";
      const branchName = `agenthub/${runId.slice(0, 8)}`;
      execSync(`git branch ${branchName}`, { cwd: baseDir, stdio: "ignore" });

      const result = await service.createForRun({
        runId,
        conversationId: "conv-3",
        baseWorkspaceId: "ws-3",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.status).toBe("ready");
      expect(result.branch_name).not.toBe(branchName);
      expect(result.branch_name).toMatch(/^agenthub\//);
    });

    it("falls back to git_clone mode and includes current workspace changes", async () => {
      const baseDir = path.join(tempDir, "repo-dirty");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);
      fs.writeFileSync(path.join(baseDir, "hello.txt"), "hello world\n");

      const result = await service.createForRun({
        runId: "run-dirty123",
        conversationId: "conv-dirty",
        baseWorkspaceId: "ws-dirty",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.mode).toBe("git_clone");
      expect(result.status).toBe("ready");
      expect(result.branch_name).toMatch(/^agenthub\/run-/);
      expect(fs.existsSync(path.join(result.root_path, "hello.txt"))).toBe(true);
      expect(fs.readFileSync(path.join(result.root_path, "hello.txt"), "utf8")).toBe("hello world\n");
    });

    it("syncs deletions from the current workspace into git_clone fallback workspaces", async () => {
      const baseDir = path.join(tempDir, "repo-delete");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);
      fs.writeFileSync(path.join(baseDir, "stale.txt"), "stale\n");
      execSync("git add stale.txt", { cwd: baseDir, stdio: "ignore" });
      execSync("git commit -m 'add stale file'", { cwd: baseDir, stdio: "ignore" });
      fs.rmSync(path.join(baseDir, "stale.txt"));

      const result = await service.createForRun({
        runId: "run-delete123",
        conversationId: "conv-delete",
        baseWorkspaceId: "ws-delete",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.mode).toBe("git_clone");
      expect(result.status).toBe("ready");
      expect(fs.existsSync(path.join(result.root_path, "stale.txt"))).toBe(false);
    });
  });

  describe("non-git workspace handling", () => {
    it("fails run workspace creation for a non-git repo", async () => {
      const baseDir = path.join(tempDir, "plain");
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(path.join(baseDir, "index.html"), "<html>hello</html>");
      fs.writeFileSync(path.join(baseDir, "app.js"), "console.log(1);");

      const result = await service.createForRun({
        runId: "run-non-git-1",
        conversationId: "conv-4",
        baseWorkspaceId: "ws-4",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.status).toBe("failed");
      expect(result.error_message).toContain("not a git repository");
    });

    it("does not create .agenthub copies for a non-git repo", async () => {
      const baseDir = path.join(tempDir, "withexcludes");
      fs.mkdirSync(baseDir, { recursive: true });
      fs.mkdirSync(path.join(baseDir, "node_modules", "some-pkg"), { recursive: true });
      fs.writeFileSync(path.join(baseDir, "node_modules", "some-pkg", "index.js"), "");
      fs.mkdirSync(path.join(baseDir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(baseDir, ".git", "HEAD"), "ref: refs/heads/main");
      fs.mkdirSync(path.join(baseDir, "dist"), { recursive: true });
      fs.writeFileSync(path.join(baseDir, "dist", "bundle.js"), "");
      fs.mkdirSync(path.join(baseDir, "build"), { recursive: true });
      fs.writeFileSync(path.join(baseDir, "build", "out.js"), "");
      fs.mkdirSync(path.join(baseDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(baseDir, "src", "main.ts"), "");

      const result = await service.createForRun({
        runId: "run-excl",
        conversationId: "conv-5",
        baseWorkspaceId: "ws-5",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.status).toBe("failed");
      expect(fs.existsSync(path.join(baseDir, ".agenthub", "copies", "run-excl"))).toBe(false);
    });
  });

  describe("error cases", () => {
    it("returns failed status when base path does not exist", async () => {
      const result = await service.createForRun({
        runId: "run-nobase",
        conversationId: "conv-7",
        baseWorkspaceId: "ws-7",
        baseRootPath: "/nonexistent/path",
        agentId: "agent-1",
      });

      expect(result.status).toBe("failed");
      expect(result.error_message).toBeTruthy();
    });

    it("does not escape base workspace path", async () => {
      const baseDir = path.join(tempDir, "safecheck");
      fs.mkdirSync(baseDir, { recursive: true });

      const mockExecGit = vi.fn((args: string[]) => {
        const joined = args.join(" ");
        if (joined.includes("rev-parse")) return baseDir;
        if (joined.includes("worktree add")) return "";
        return "";
      });

      const unsafeService = new WorkspaceIsolationService(db, { execGit: mockExecGit });
      const result = await unsafeService.createForRun({
        runId: "../../../etc/hack",
        conversationId: "conv-8",
        baseWorkspaceId: "ws-8",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      if (result.status === "ready") {
        expect(result.root_path).toContain(".agenthub");
        expect(result.root_path.startsWith(path.resolve(baseDir))).toBe(true);
      }
    });
  });
});

describe("run_workspaces migration", () => {
  it("creates run_workspaces table on db init", () => {
    const dir = makeTempDir("agenthub-mig-");
    const db = makeDbClient(dir);

    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='run_workspaces'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const indexes = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_run_workspaces%'")
      .all() as Array<{ name: string }>;
    expect(indexes.length).toBeGreaterThanOrEqual(3);

    db.close();
  });
});

describe("run workspace API (GET /runs/:runId/workspace)", () => {
  it("returns legacy when run has no run_workspace record", async () => {
    const harness = await createTestHarness();
    const client = harness.client;

    const conversation = await client.post("/conversations", { title: "test", type: "single" });
    const conversationId = conversation.json().id;
    await client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const runRes = await client.post(`/conversations/${conversationId}/runs`, { prompt: "hello" });
    const runId = runRes.json().id;
    await waitFor(async () => {
      const r = await client.get(`/runs/${runId}`);
      return r.json().status === "completed";
    });

    const wsRes = await client.get(`/runs/${runId}/workspace`);
    expect(wsRes.statusCode).toBe(200);
    // harness disables workspace isolation, so no run_workspace record is created -> legacy
    expect(wsRes.json().mode).toBe("legacy");

    await harness.close();
  });

  it("returns 404 when run does not exist", async () => {
    const harness = await createTestHarness();

    const res = await harness.client.get("/runs/not-a-real-run/workspace");
    expect(res.statusCode).toBe(404);

    await harness.close();
  });
});

describe("workspace isolation integration with git clone mode", () => {
  it("run uses run workspace path when it exists and is ready", async () => {
    const tempDir = makeTempDir("agenthub-int-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    makeGitRepo(workspacePath);
    fs.writeFileSync(path.join(workspacePath, ".DS_Store"), "force clone mode\n");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conversation = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Isolation Test", type: "single" },
    });
    const conversationId = conversation.json().id;

    await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/workspace`,
      payload: { rootPath: workspacePath },
    });

    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/runs`,
      payload: { prompt: "build something" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const run = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (run.json().status === "completed") {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error("timeout"));
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    expect(wsRes.statusCode).toBe(200);
    const wsData = wsRes.json();
    expect(wsData.status).toBe("ready");
    expect(wsData.mode).toBe("git_clone");
    expect(wsData.rootPath).toContain(".agenthub");
    expect(wsData.rootPath).toContain("clones");
    expect(wsData.rootPath).toContain(runId);

    const runWorkspacePath = wsData.rootPath as string;
    fs.mkdirSync(path.join(runWorkspacePath, "src"), { recursive: true });
    fs.writeFileSync(path.join(runWorkspacePath, "src", "result.ts"), "export const done = true;\n");

    server.app.locals.runsService.appendEvent(runId, conversationId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed",
      runId,
      conversationId,
      agentId: runRes.json().agent_id,
      taskId: null,
      toolUseId: "tool-write",
      toolName: "Write",
      input: {
        file_path: "src/result.ts",
        content: "export const done = true;\n",
      },
    });

    const changesRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/file-changes` });
    expect(changesRes.statusCode).toBe(200);
    expect(changesRes.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: "src/result.ts" }),
      ]),
    );

    await server.close();
  }, 15000);

  it("two isolated runs modify same filename, file-changes are isolated", async () => {
    const tempDir = makeTempDir("agenthub-iso2-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conversation = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Two Runs Isolation", type: "single" },
    });
    const conversationId = conversation.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/workspace`,
      payload: { rootPath: workspacePath },
    });

    const runRes1 = await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/runs`,
      payload: { prompt: "first run" },
    });
    const runId1 = runRes1.json().id;

    const runRes2 = await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/runs`,
      payload: { prompt: "second run" },
    });
    const runId2 = runRes2.json().id;

    const waitForDone = async (runId: string) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const run = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (run.json().status === "completed") return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("timeout");
    };

    await Promise.all([waitForDone(runId1), waitForDone(runId2)]);

    const ws1 = (await inject(server.app, { method: "GET", url: `/runs/${runId1}/workspace` })).json();
    const ws2 = (await inject(server.app, { method: "GET", url: `/runs/${runId2}/workspace` })).json();

    expect(ws1.rootPath).not.toBe(ws2.rootPath);

    fs.mkdirSync(path.join(ws1.rootPath, "shared"), { recursive: true });
    fs.writeFileSync(path.join(ws1.rootPath, "shared", "config.ts"), "export const A = 1;\n");

    fs.mkdirSync(path.join(ws2.rootPath, "shared"), { recursive: true });
    fs.writeFileSync(path.join(ws2.rootPath, "shared", "config.ts"), "export const B = 2;\n");

    for (const [runId, content] of [[runId1, "export const A = 1;\n"], [runId2, "export const B = 2;\n"]] as const) {
      const agentId = (await inject(server.app, { method: "GET", url: `/runs/${runId}` })).json().agent_id;
      server.app.locals.runsService.appendEvent(runId, conversationId, server.app.locals.runsService.nextEventSeq(runId), {
        type: "tool_completed",
        runId,
        conversationId,
        agentId,
        taskId: null,
        toolUseId: `tool-write-${runId}`,
        toolName: "Write",
        input: { file_path: "shared/config.ts", content },
      });
    }

    const changes1 = (await inject(server.app, { method: "GET", url: `/runs/${runId1}/file-changes` })).json();
    const changes2 = (await inject(server.app, { method: "GET", url: `/runs/${runId2}/file-changes` })).json();

    expect(changes1).toEqual([expect.objectContaining({ filePath: "shared/config.ts", newContent: "export const A = 1;\n" })]);
    expect(changes2).toEqual([expect.objectContaining({ filePath: "shared/config.ts", newContent: "export const B = 2;\n" })]);

    await server.close();
  });

  it("run workspace fails gracefully when creation fails, run is marked failed", async () => {
    const tempDir = makeTempDir("agenthub-fail-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const db = new DatabaseClient(dbPath);
    const failingService = new WorkspaceIsolationService(db, {
      execGit: vi.fn(() => { throw new Error("git not found"); }),
    });
    // Override createForRun to always fail
    (failingService as any).createForRun = async (input: any) => {
      return {
        id: crypto.randomUUID(),
        run_id: input.runId,
        conversation_id: input.conversationId,
        base_workspace_id: input.baseWorkspaceId,
        mode: "copy",
        root_path: "",
        branch_name: null,
        base_ref: null,
        status: "failed",
        error_message: "Intentional failure",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    };
    db.close();

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { workspaceIsolationService: failingService, enableWorkspaceIsolation: true },
    );

    const conversation = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Failure Test", type: "single" },
    });
    const conversationId = conversation.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/workspace`,
      payload: { rootPath: workspacePath },
    });

    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${conversationId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = async () => {
        const run = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        const status = run.json().status;
        if (status === "failed") {
          resolve();
        } else if (status === "completed") {
          reject(new Error("Expected failed but got completed"));
        } else if (Date.now() > deadline) {
          reject(new Error(`timeout with status: ${status}`));
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    const finalRun = (await inject(server.app, { method: "GET", url: `/runs/${runId}` })).json();
    expect(finalRun.status).toBe("failed");
    expect(finalRun.error_message).toBeTruthy();

    await server.close();
  });
});

describe("preview with run workspace fallback", () => {
  it("preview falls back to base workspace when run has no run_workspace", async () => {
    const harness = await createTestHarness();
    const client = harness.client;

    const conversation = await client.post("/conversations", { title: "preview-fallback", type: "single" });
    const conversationId = conversation.json().id;
    await client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });
    const runRes = await client.post(`/conversations/${conversationId}/runs`, { prompt: "hello" });
    const runId = runRes.json().id;
    await waitFor(async () => {
      const r = await client.get(`/runs/${runId}`);
      return r.json().status === "completed";
    });

    fs.writeFileSync(path.join(harness.workspacePath, "index.html"), "<html>ok</html>");

    const { PreviewService } = await import("../src/modules/preview/preview.service.js");
    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      {
        spawnProcess: vi.fn(() => {
          const { EventEmitter } = require("node:events");
          const proc = new EventEmitter() as any;
          proc.exitCode = null;
          proc.killed = false;
          proc.kill = () => { proc.killed = true; proc.exitCode = 0; };
          proc.stdout = { resume() {} };
          proc.stderr = { resume() {} };
          return proc;
        }),
        waitForUrl: vi.fn(async () => undefined),
        isPortAvailable: vi.fn(async () => true),
      },
    );

    const preview = await previewService.startPreviewForRun(runId);
    expect(preview.port).toBe(3100);

    await harness.close();
  });
});

describe("Workspace Lifecycle & Cleanup", () => {
  let tempDir: string;
  let db: DatabaseClient;
  let service: WorkspaceIsolationService;

  beforeEach(() => {
    tempDir = makeTempDir("agenthub-lifecycle-");
    db = makeDbClient(tempDir);
    db.db.exec("PRAGMA foreign_keys = OFF");
    service = new WorkspaceIsolationService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("cleanup git_worktree", () => {
    it("removes worktree using git worktree remove --force", async () => {
      const baseDir = path.join(tempDir, "repo");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      const result = await service.createForRun({
        runId: "run-clean-1",
        conversationId: "conv-1",
        baseWorkspaceId: "ws-1",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      expect(result.status).toBe("ready");
      expect(fs.existsSync(result.root_path)).toBe(true);

      const cleaned = await service.cleanupRunWorkspace("run-clean-1");
      expect(cleaned.status).toBe("cleaned");
      expect(fs.existsSync(result.root_path)).toBe(false);
    });

    it("is idempotent when workspace already cleaned", async () => {
      const baseDir = path.join(tempDir, "repo2");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      await service.createForRun({
        runId: "run-idem-1",
        conversationId: "conv-2",
        baseWorkspaceId: "ws-2",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      const first = await service.cleanupRunWorkspace("run-idem-1");
      expect(first.status).toBe("cleaned");

      const second = await service.cleanupRunWorkspace("run-idem-1");
      expect(second.status).toBe("cleaned");
    });
  });

  describe("cleanup copy (legacy compatibility)", () => {
    it("removes copy directory for existing legacy records", async () => {
      const baseDir = path.join(tempDir, "plain");
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(path.join(baseDir, "app.ts"), "console.log(1);");
      const legacyRoot = path.join(baseDir, ".agenthub", "copies", "run-copy-clean");
      fs.mkdirSync(legacyRoot, { recursive: true });
      fs.writeFileSync(path.join(legacyRoot, "app.ts"), "console.log(1);");
      db.db.prepare(`
        INSERT INTO run_workspaces (
          id, run_id, conversation_id, base_workspace_id, mode, root_path,
          branch_name, base_ref, status, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "rws-copy-clean",
        "run-copy-clean",
        "conv-3",
        "ws-3",
        "copy",
        legacyRoot,
        null,
        null,
        "ready",
        null,
        new Date().toISOString(),
        new Date().toISOString(),
      );

      const cleaned = await service.cleanupRunWorkspace("run-copy-clean");
      expect(cleaned.status).toBe("cleaned");
      expect(fs.existsSync(legacyRoot)).toBe(false);
    });
  });

  describe("safety checks", () => {
    it("rejects cleanup when root_path is not under .agenthub", async () => {
      const baseDir = path.join(tempDir, "saferepo");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      await service.createForRun({
        runId: "run-safe-1",
        conversationId: "conv-4",
        baseWorkspaceId: "ws-4",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      // Manually update root_path to an unsafe path
      db.db.prepare("UPDATE run_workspaces SET root_path = ? WHERE run_id = ?")
        .run("/etc/passwd", "run-safe-1");

      await expect(service.cleanupRunWorkspace("run-safe-1")).rejects.toMatchObject({
        message: expect.stringContaining("Unsafe cleanup path"),
        statusCode: 400,
      });
    });

    it("marks cleaned when root_path does not exist on disk", async () => {
      const baseDir = path.join(tempDir, "phantom");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      await service.createForRun({
        runId: "run-phantom",
        conversationId: "conv-5",
        baseWorkspaceId: "ws-5",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      // The real path is valid, now remove it
      const record = service.getByRunId("run-phantom");
      fs.rmSync(record!.root_path, { recursive: true, force: true });

      const cleaned = await service.cleanupRunWorkspace("run-phantom");
      expect(cleaned.status).toBe("cleaned");
    });

    it("returns 404 when run workspace does not exist", async () => {
      await expect(service.cleanupRunWorkspace("nonexistent")).rejects.toMatchObject({
        message: "Run workspace not found",
        statusCode: 404,
      });
    });
  });

  describe("preview protection", () => {
    it("returns 400 when preview is running", async () => {
      const baseDir = path.join(tempDir, "prevrepo");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      await service.createForRun({
        runId: "run-prev-1",
        conversationId: "conv-6",
        baseWorkspaceId: "ws-6",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      const svc = new WorkspaceIsolationService(db, {
        isPreviewRunning: () => true,
      });

      await expect(svc.cleanupRunWorkspace("run-prev-1")).rejects.toMatchObject({
        message: "Cannot clean workspace while preview is running",
        statusCode: 400,
      });
    });
  });

  describe("conversation cleanup", () => {
    function makeRun(runId: string, convId: string, runStatus: string) {
      // Insert a minimal agent_runs record so the runsService can find it
      db.db.prepare(`
        INSERT INTO agent_runs (id, conversation_id, task_id, agent_id, runtime_id, agent_session_id,
          assignment_id, source_message_id, workspace_id, prompt, trigger_type, trigger_source_id,
          requested_by, status, pid, exit_code, error_message, started_at, finished_at)
        VALUES (?, ?, NULL, 'agent-1', NULL, NULL, NULL, NULL, 'ws-1', 'test', 'chat', 'conv-1',
          'user', ?, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', ?)
      `).run(runId, convId, runStatus, runStatus === "running" || runStatus === "queued" ? null : "2026-01-01T00:01:00.000Z");
    }

    const mockRunsService = {
      getById: (runId: string) => {
        const row = db.db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId) as { status: string } | undefined;
        return row ? { status: row.status } as any : null;
      },
    };

    it("cleans only completed/failed/interrupted/cancelled runs", async () => {
      const baseDir = path.join(tempDir, "convclean");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      for (const [runId, runStatus] of [
        ["run-done", "completed"],
        ["run-fail", "failed"],
        ["run-intr", "interrupted"],
        ["run-canc", "cancelled"],
      ] as const) {
        makeRun(runId, "conv-c1", runStatus);
        await service.createForRun({
          runId,
          conversationId: "conv-c1",
          baseWorkspaceId: "ws-1",
          baseRootPath: baseDir,
          agentId: "agent-1",
        });
      }

      const result = await service.cleanupConversationWorkspaces("conv-c1", mockRunsService);
      expect(result.cleaned).toHaveLength(4);
      expect(result.skipped).toHaveLength(0);

      for (const ws of result.cleaned) {
        expect(ws.status).toBe("cleaned");
      }
    });

    it("skips running and queued runs", async () => {
      const baseDir = path.join(tempDir, "convskip");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      makeRun("run-run", "conv-c2", "running");
      await service.createForRun({
        runId: "run-run",
        conversationId: "conv-c2",
        baseWorkspaceId: "ws-1",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      makeRun("run-que", "conv-c2", "queued");
      await service.createForRun({
        runId: "run-que",
        conversationId: "conv-c2",
        baseWorkspaceId: "ws-1",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      const result = await service.cleanupConversationWorkspaces("conv-c2", mockRunsService);
      expect(result.cleaned).toHaveLength(0);
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped[0]!.reason).toContain("running");
      expect(result.skipped[1]!.reason).toContain("queued");
    });

    it("skips runs with active preview", async () => {
      const baseDir = path.join(tempDir, "convprev");
      fs.mkdirSync(baseDir, { recursive: true });
      makeGitRepo(baseDir);

      makeRun("run-prev-a", "conv-c3", "completed");
      await service.createForRun({
        runId: "run-prev-a",
        conversationId: "conv-c3",
        baseWorkspaceId: "ws-1",
        baseRootPath: baseDir,
        agentId: "agent-1",
      });

      const svc = new WorkspaceIsolationService(db, {
        isPreviewRunning: (rid) => rid === "run-prev-a",
      });

      const result = await svc.cleanupConversationWorkspaces("conv-c3", mockRunsService);
      expect(result.cleaned).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.reason).toBe("Preview is running");
    });
  });
});

describe("cleaned workspace API behavior", () => {
  it("file-changes returns 400 when workspace is cleaned", async () => {
    const tempDir = makeTempDir("agenthub-cleaned-api-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Cleaned Test", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    // Wait for run to complete
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error("timeout"));
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    // Clean the workspace
    const cleanupRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/workspace/cleanup`,
      payload: { mode: "execute" },
    } as any);
    expect(cleanupRes.statusCode).toBe(200);

    // Verify file-changes returns error
    const fcRes = await inject(server.app, {
      method: "GET",
      url: `/runs/${runId}/file-changes`,
    });
    expect(fcRes.statusCode).toBe(400);
    expect(fcRes.json().detail).toContain("cleaned");

    await server.close();
  });

  it("preview/start returns 400 when workspace is cleaned", async () => {
    const tempDir = makeTempDir("agenthub-preview-cleaned-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    // Create a valid index.html so preview doesn't fail on "cannot be previewed"
    fs.writeFileSync(path.join(workspacePath, "index.html"), "<html>ok</html>");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Preview Cleaned", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") {
          resolve();
        } else if (Date.now() > deadline) {
          reject(new Error("timeout"));
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 100);
    });

    // Clean the workspace
    await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/workspace/cleanup`,
      payload: { mode: "execute" },
    });

    // Try to start preview - should fail
    const previewRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/preview/start`,
    });
    expect(previewRes.statusCode).toBe(400);
    expect(previewRes.json().detail).toContain("cleaned");

    await server.close();
  });
});

describe("Run Change Application", () => {
  it("apply changes merge a git-backed run branch into the base workspace", async () => {
    const tempDir = makeTempDir("agenthub-apply-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    makeGitRepo(workspacePath);
    fs.writeFileSync(path.join(workspacePath, "original.ts"), "export const VERSION = 1;\n");
    execSync("git add original.ts", { cwd: workspacePath, stdio: "ignore" });
    execSync("git commit -m 'add original'", { cwd: workspacePath, stdio: "ignore" });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Apply Test", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "update file" },
    });
    const runId = runRes.json().id;

    // Wait for completion
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    // Create a file in the run workspace
    const wsRes = await inject(server.app, {
      method: "GET",
      url: `/runs/${runId}/workspace`,
    });
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "new-feature.ts"), "export const feature = true;\n");

    // Register a file change event
    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(
      runId, convId,
      server.app.locals.runsService.nextEventSeq(runId),
      {
        type: "tool_completed",
        runId,
        conversationId: convId,
        agentId,
        taskId: null,
        toolUseId: "tool-write-apply",
        toolName: "Write",
        input: {
          file_path: "new-feature.ts",
          content: "export const feature = true;\n",
        },
      },
    );

    // Apply changes
    const applyRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(applyRes.statusCode).toBe(200);
    const app = applyRes.json();
    expect(app.status).toBe("applied");
    expect(app.appliedFiles).toContain("new-feature.ts");

    // Verify file was merged back into the base workspace
    expect(fs.existsSync(path.join(workspacePath, "new-feature.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(workspacePath, "new-feature.ts"), "utf8")).toBe(
      "export const feature = true;\n",
    );
    expect(execSync("git log -1 --pretty=%B", { cwd: workspacePath, encoding: "utf8" })).toContain(
      `agenthub(apply): run ${runId}`,
    );

    // Existing files should not be affected
    expect(fs.existsSync(path.join(workspacePath, "original.ts"))).toBe(true);

    await server.close();
  });

  it("apply changes merge a git_clone run branch after the base repo is cleaned", async () => {
    const tempDir = makeTempDir("agenthub-apply-clone-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    makeGitRepo(workspacePath);
    fs.writeFileSync(path.join(workspacePath, ".DS_Store"), "dirty base state\n");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Apply Clone Test", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "update file from clone" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    expect(wsRes.json().mode).toBe("git_clone");
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "clone-feature.ts"), "export const cloneFeature = true;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(
      runId,
      convId,
      server.app.locals.runsService.nextEventSeq(runId),
      {
        type: "tool_completed",
        runId,
        conversationId: convId,
        agentId,
        taskId: null,
        toolUseId: "tool-write-clone-apply",
        toolName: "Write",
        input: {
          file_path: "clone-feature.ts",
          content: "export const cloneFeature = true;\n",
        },
      },
    );

    execSync("git add .DS_Store", { cwd: workspacePath, stdio: "ignore" });
    execSync("git commit -m 'clean base before apply'", { cwd: workspacePath, stdio: "ignore" });

    const applyRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().status).toBe("applied");
    expect(fs.readFileSync(path.join(workspacePath, "clone-feature.ts"), "utf8")).toBe(
      "export const cloneFeature = true;\n",
    );

    await server.close();
  }, 15000);

  it("apply and commit returns merge metadata for git-backed runs", async () => {
    const tempDir = makeTempDir("agenthub-apply-commit-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    makeGitRepo(workspacePath);
    fs.writeFileSync(path.join(workspacePath, "original.ts"), "export const VERSION = 1;\n");
    execSync("git add original.ts", { cwd: workspacePath, stdio: "ignore" });
    execSync("git commit -m 'add original'", { cwd: workspacePath, stdio: "ignore" });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Apply Commit Test", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "create committed file" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, {
      method: "GET",
      url: `/runs/${runId}/workspace`,
    });
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "committed.ts"), "export const committed = true;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(
      runId,
      convId,
      server.app.locals.runsService.nextEventSeq(runId),
      {
        type: "tool_completed",
        runId,
        conversationId: convId,
        agentId,
        taskId: null,
        toolUseId: "tool-write-commit",
        toolName: "Write",
        input: {
          file_path: "committed.ts",
          content: "export const committed = true;\n",
        },
      },
    );

    const requestRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "request", actionType: "apply_and_commit" },
    });
    expect(requestRes.statusCode).toBe(201);
    expect(requestRes.json().actionType).toBe("apply_and_commit");

    const approveRes = await inject(server.app, {
      method: "POST",
      url: `/approvals/${requestRes.json().id}/approve`,
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe("executed");
    expect(approveRes.json().result.commitSha).toBeTruthy();
    expect(approveRes.json().result.branchName).toMatch(/^agenthub\/run-/);

    const headMessage = execSync("git log -1 --pretty=%B", { cwd: workspacePath, encoding: "utf8" });
    expect(headMessage).toContain(`agenthub(apply): run ${runId} by @claude-code`);
    expect(fs.readFileSync(path.join(workspacePath, "committed.ts"), "utf8")).toBe(
      "export const committed = true;\n",
    );

    const committedFiles = execSync("git diff-tree -m --no-commit-id --name-only -r HEAD", {
      cwd: workspacePath,
      encoding: "utf8",
    });
    expect(committedFiles).toContain("committed.ts");

    await server.close();
  });

  it("returns 400 when run is not completed", async () => {
    const tempDir = makeTempDir("agenthub-apply-running-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    // Manually insert a queued run with a workspace
    const db = new DatabaseClient(dbPath);
    db.db.exec("PRAGMA foreign_keys = OFF");
    db.db.prepare(`
      INSERT INTO workspaces (id, conversation_id, root_path, mode, created_at, updated_at)
      VALUES ('ws-test', 'conv-test', ?, 'direct', '2026-01-01', '2026-01-01')
    `).run(workspacePath);
    db.db.prepare(`
      INSERT INTO agent_runs (id, conversation_id, task_id, agent_id, runtime_id,
        agent_session_id, assignment_id, source_message_id, workspace_id, prompt,
        trigger_type, trigger_source_id, requested_by, status, pid, exit_code,
        error_message, started_at, finished_at)
      VALUES ('run-not-done', 'conv-test', NULL, 'agent-1', NULL, NULL, NULL, NULL,
        'ws-test', 'test', 'chat', 'conv-test', 'user', 'running', NULL, NULL, NULL,
        '2026-01-01T00:00:00.000Z', NULL)
    `).run();
    db.db.prepare(`
      INSERT INTO run_workspaces (id, run_id, conversation_id, base_workspace_id,
        mode, root_path, branch_name, base_ref, status, error_message, created_at, updated_at)
      VALUES ('rws-test', 'run-not-done', 'conv-test', 'ws-test', 'copy', ?, NULL, NULL,
        'ready', NULL, '2026-01-01', '2026-01-01')
    `).run(workspacePath);
    db.close();

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const applyRes = await inject(server.app, {
      method: "POST",
      url: "/runs/run-not-done/apply-changes",
      payload: { mode: "execute" },
    });
    expect(applyRes.statusCode).toBe(400);
    expect(applyRes.json().detail).toContain("completed");

    await server.close();
  });

  it("returns 400 when workspace is cleaned", async () => {
    const tempDir = makeTempDir("agenthub-apply-cleaned-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "index.html"), "<html>ok</html>");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Apply Cleaned", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    // Clean the workspace first
    await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/workspace/cleanup`,
      payload: { mode: "execute" },
    });

    // Try to apply changes after cleaning
    const applyRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(applyRes.statusCode).toBe(400);
    expect(applyRes.json().detail).toContain("cleaned");

    await server.close();
  });

  it("apply is idempotent", async () => {
    const tempDir = makeTempDir("agenthub-apply-idem-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Idempotent", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const first = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(first.statusCode).toBe(200);

    const second = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);

    await server.close();
  });

  it("GET change-application returns null when no application exists", async () => {
    const tempDir = makeTempDir("agenthub-apply-null-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "No Apply", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const res = await inject(server.app, {
      method: "GET",
      url: `/runs/${runId}/change-application`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();

    await server.close();
  });

  it("apply with no file changes returns skipped", async () => {
    const tempDir = makeTempDir("agenthub-apply-skip-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, {
      method: "POST",
      url: "/conversations",
      payload: { title: "Skip Apply", type: "single" },
    });
    const convId = conv.json().id;
    await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/workspace`,
      payload: { rootPath: workspacePath },
    });
    const runRes = await inject(server.app, {
      method: "POST",
      url: `/conversations/${convId}/runs`,
      payload: { prompt: "test" },
    });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > deadline) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const applyRes = await inject(server.app, {
      method: "POST",
      url: `/runs/${runId}/apply-changes`,
      payload: { mode: "execute" },
    });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().status).toBe("skipped");

    await server.close();
  });

  it("run_change_applications table exists after migration", () => {
    const dir = makeTempDir("agenthub-mig-change-");
    const db = makeDbClient(dir);

    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='run_change_applications'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);

    const indexes = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_run_change_applications%'")
      .all() as Array<{ name: string }>;
    expect(indexes.length).toBeGreaterThanOrEqual(2);

    db.close();
  });
});

describe("Apply Check & Conflict Guard", () => {
  it("create file when base does not exist -> safe", async () => {
    const tempDir = makeTempDir("agenthub-check-create-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Check Create", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "create" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "new.ts"), "export const x = 1;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-create", toolName: "Write",
      input: { file_path: "new.ts", content: "export const x = 1;\n" },
    });

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(200);
    const result = checkRes.json();
    expect(result.canApply).toBe(true);
    expect(result.summary.safe).toBe(1);
    expect(result.summary.conflict).toBe(0);
    expect(result.files[0].status).toBe("safe");

    await server.close();
  });

  it("write existing tracked file with unchanged base -> safe", async () => {
    const tempDir = makeTempDir("agenthub-check-create-conflict-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "existing.ts"), "export const OLD = true;\n");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Conflict Create", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "create conflict" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "existing.ts"), "export const NEW = false;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-conflict-create", toolName: "Write",
      input: { file_path: "existing.ts", content: "export const NEW = false;\n" },
    });

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(200);
    const result = checkRes.json();
    expect(result.canApply).toBe(true);
    expect(result.summary.safe).toBe(1);
    expect(result.files[0].status).toBe("safe");

    await server.close();
  });

  it("edit file where base content equals oldContent -> safe", async () => {
    const tempDir = makeTempDir("agenthub-check-edit-safe-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "edit.ts"), "const VERSION = 1;\n");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Edit Safe", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "edit" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-edit-safe", toolName: "Edit",
      input: {
        file_path: "edit.ts",
        old_string: "const VERSION = 1;\n",
        new_string: "const VERSION = 2;\n",
      },
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    fs.writeFileSync(path.join(wsRes.json().rootPath, "edit.ts"), "const VERSION = 2;\n");

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(200);
    const result = checkRes.json();
    expect(result.canApply).toBe(true);

    await server.close();
  });

  it("edit file where base changed since run -> conflict", async () => {
    const tempDir = makeTempDir("agenthub-check-edit-conflict-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const originalContent = "const V = 1;\n";
    fs.writeFileSync(path.join(workspacePath, "changed.ts"), originalContent);
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Edit Conflict", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "edit" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    // Base file was changed from the original
    fs.writeFileSync(path.join(workspacePath, "changed.ts"), "const V = MODIFIED;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-edit-conflict", toolName: "Edit",
      input: {
        file_path: "changed.ts",
        old_string: originalContent,
        new_string: "const V = 2;\n",
      },
    });
    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    fs.writeFileSync(path.join(wsRes.json().rootPath, "changed.ts"), "const V = 2;\n");

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(200);
    const result = checkRes.json();
    expect(result.canApply).toBe(false);
    expect(result.summary.conflict).toBeGreaterThanOrEqual(1);
    expect(result.files.some((f: any) =>
      f.status === "conflict" &&
      typeof f.reason === "string" &&
      f.reason.length > 0,
    )).toBe(true);

    await server.close();
  });

  it("check returns 200 success for run with no file changes", async () => {
    const tempDir = makeTempDir("agenthub-check-empty-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Empty Check", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "nothing" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(200);
    const result = checkRes.json();
    expect(result.canApply).toBe(true);
    expect(result.summary.safe).toBe(0);
    expect(result.summary.conflict).toBe(0);
    expect(result.summary.skipped).toBe(0);

    await server.close();
  });

  it("apply with dirty base changes returns 409 with check result", async () => {
    const tempDir = makeTempDir("agenthub-apply-409-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "preexist.ts"), "ORIGINAL;\n");
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "409 Test", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "409" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    fs.writeFileSync(path.join(wsRes.json().rootPath, "preexist.ts"), "NEW;\n");
    fs.writeFileSync(path.join(workspacePath, "preexist.ts"), "DIRTY-BASE;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-409", toolName: "Write",
      input: { file_path: "preexist.ts", content: "NEW;\n" },
    });

    const applyRes = await inject(server.app, { method: "POST", url: `/runs/${runId}/apply-changes`, payload: { mode: "execute" } });
    expect(applyRes.statusCode).toBe(409);
    const body = applyRes.json();
    expect(body.detail).toContain("conflicts");
    expect(body.check).toBeTruthy();
    expect(body.check.canApply).toBe(false);

    await server.close();
  });

  it("apply with no conflict copies safe files", async () => {
    const tempDir = makeTempDir("agenthub-apply-safe-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Safe Apply", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "safe" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    const wsRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/workspace` });
    const runWsPath = wsRes.json().rootPath;
    fs.writeFileSync(path.join(runWsPath, "safe-file.ts"), "export const SAFE = true;\n");

    const agentId = runRes.json().agent_id;
    server.app.locals.runsService.appendEvent(runId, convId, server.app.locals.runsService.nextEventSeq(runId), {
      type: "tool_completed", runId, conversationId: convId, agentId, taskId: null,
      toolUseId: "tool-safe", toolName: "Write",
      input: { file_path: "safe-file.ts", content: "export const SAFE = true;\n" },
    });

    const applyRes = await inject(server.app, { method: "POST", url: `/runs/${runId}/apply-changes`, payload: { mode: "execute" } });
    expect(applyRes.statusCode).toBe(200);
    expect(applyRes.json().status).toBe("applied");
    expect(applyRes.json().appliedFiles).toContain("safe-file.ts");
    expect(fs.existsSync(path.join(workspacePath, "safe-file.ts"))).toBe(true);

    await server.close();
  });

  it("already applied run is idempotent even with new conflicts in base", async () => {
    const tempDir = makeTempDir("agenthub-apply-idem-conflict-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Idem Conflict", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "idem" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    // First apply (no changes = skipped)
    await inject(server.app, { method: "POST", url: `/runs/${runId}/apply-changes`, payload: { mode: "execute" } });

    // Now modify base to create a potential conflict situation
    fs.writeFileSync(path.join(workspacePath, "fresh.ts"), "BASE_CONTENT;\n");

    // Second apply should still return the existing record, not re-check
    const secondRes = await inject(server.app, { method: "POST", url: `/runs/${runId}/apply-changes`, payload: { mode: "execute" } });
    expect(secondRes.statusCode).toBe(200);
    // Should have same id as the first application
    const firstApp = await inject(server.app, { method: "GET", url: `/runs/${runId}/change-application` });
    expect(secondRes.json().id).toBe(firstApp.json().id);

    await server.close();
  });

  it("cleaned workspace returns 400 for check", async () => {
    const tempDir = makeTempDir("agenthub-check-cleaned-");
    const workspacePath = path.join(tempDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    const dbPath = path.join(tempDir, "test.sqlite");
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const server = createAgentHubServer(
      { port: 8000, dbPath, claudeCommand: process.execPath, claudeBaseArgs: [mockCliPath], claudeAllowedTools: [] },
      { enableWorkspaceIsolation: true },
    );

    const conv = await inject(server.app, { method: "POST", url: "/conversations", payload: { title: "Check Cleaned", type: "single" } });
    const convId = conv.json().id;
    await inject(server.app, { method: "POST", url: `/conversations/${convId}/workspace`, payload: { rootPath: workspacePath } });
    const runRes = await inject(server.app, { method: "POST", url: `/conversations/${convId}/runs`, payload: { prompt: "test" } });
    const runId = runRes.json().id;

    await new Promise<void>((resolve, reject) => {
      const dl = Date.now() + 8000;
      const check = async () => {
        const r = await inject(server.app, { method: "GET", url: `/runs/${runId}` });
        if (r.json().status === "completed") resolve();
        else if (Date.now() > dl) reject(new Error("timeout"));
        else setTimeout(check, 100);
      };
      setTimeout(check, 100);
    });

    await inject(server.app, { method: "POST", url: `/runs/${runId}/workspace/cleanup`, payload: { mode: "execute" } });

    const checkRes = await inject(server.app, { method: "GET", url: `/runs/${runId}/apply-check` });
    expect(checkRes.statusCode).toBe(400);
    expect(checkRes.json().detail).toContain("cleaned");

    await server.close();
  });
});
