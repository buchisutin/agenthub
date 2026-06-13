import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import inject from "light-my-request";
import { createAgentHubServer } from "../src/app.js";
import { DatabaseClient } from "../src/db/client.js";
import { createTestHarness, waitFor } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

async function createCompletedRun(options?: {
  beforeBind?: (workspacePath: string) => void;
}) {
  const harness = await createTestHarness({ enableWorkspaceIsolation: true });
  harnesses.push(harness);
  const client = harness.client;

  const conversation = await client.post("/conversations", {
    title: "Diff Artifact",
    type: "single",
  });
  const conversationId = conversation.json().id;

  options?.beforeBind?.(harness.workspacePath);
  await client.post(`/conversations/${conversationId}/workspace`, {
    rootPath: harness.workspacePath,
  });

  const run = await client.post(`/conversations/${conversationId}/runs`, {
    prompt: "hello",
  });
  const runId = run.json().id;

  await waitFor(async () => {
    const currentRun = await client.get(`/runs/${runId}`);
    return currentRun.json().status === "completed";
  });

  const runDetail = (await client.get(`/runs/${runId}`)).json();
  const runWorkspace = harness.server.app.locals.runsService.getRunWorkspace(runId);
  return {
    harness,
    client,
    conversationId,
    runId,
    runDetail,
    runWorkspacePath: runWorkspace?.root_path ?? null,
    runsService: harness.server.app.locals.runsService,
  };
}

describe("run file changes API", () => {
  it("returns create when a Write tool creates a new file", async () => {
    const { client, runId, runWorkspacePath } =
      await createCompletedRun();

    expect(runWorkspacePath).toBeTruthy();
    const newFilePath = path.join(runWorkspacePath!, "src", "new-file.ts");
    fs.mkdirSync(path.dirname(newFilePath), { recursive: true });
    fs.writeFileSync(newFilePath, "export const created = true;\n");

    const response = await client.get(`/runs/${runId}/file-changes`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        filePath: "src/new-file.ts",
        changeType: "create",
        oldContent: "",
        newContent: "export const created = true;\n",
        confidence: "exact",
        source: "filesystem",
      },
    ]);
  });

  it("returns edit diffs for a file changed inside the isolated run workspace", async () => {
    const { client, runId, runWorkspacePath } =
      await createCompletedRun({
        beforeBind: (workspacePath) => {
          const basePath = path.join(workspacePath, "src", "edited.ts");
          fs.mkdirSync(path.dirname(basePath), { recursive: true });
          fs.writeFileSync(basePath, "export const version = 1;\n");
        },
      });

    expect(runWorkspacePath).toBeTruthy();
    const runPath = path.join(runWorkspacePath!, "src", "edited.ts");
    fs.mkdirSync(path.dirname(runPath), { recursive: true });
    fs.writeFileSync(runPath, "export const version = 2;\n");

    const response = await client.get(`/runs/${runId}/file-changes`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        filePath: "src/edited.ts",
        changeType: "edit",
        oldContent: "export const version = 1;\n",
        newContent: "export const version = 2;\n",
        confidence: "exact",
        source: "filesystem",
      },
    ]);
  });

  it("returns create when a file only exists in the run workspace", async () => {
    const { client, runId, runWorkspacePath } =
      await createCompletedRun();

    expect(runWorkspacePath).toBeTruthy();
    const targetPath = path.join(runWorkspacePath!, "src", "best-effort.ts");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "export const done = true;\n");

    const response = await client.get(`/runs/${runId}/file-changes`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        filePath: "src/best-effort.ts",
        changeType: "create",
        oldContent: "",
        newContent: "export const done = true;\n",
        confidence: "exact",
        source: "filesystem",
      },
    ]);
  });

  it("returns an empty array when no file writes are detected", async () => {
    const { client, runId } = await createCompletedRun();

    const response = await client.get(`/runs/${runId}/file-changes`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("returns 404 when the run does not exist", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.get("/runs/does-not-exist/file-changes");
    expect(response.statusCode).toBe(404);
  });

  it("skips unsafe escaped file paths", async () => {
    const { client, runId, runWorkspacePath } =
      await createCompletedRun();

    expect(runWorkspacePath).toBeTruthy();
    fs.writeFileSync(path.resolve(runWorkspacePath!, "..", "outside.txt"), "unsafe\n");

    const response = await client.get(`/runs/${runId}/file-changes`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("keeps file changes isolated to the rerun runId", async () => {
    const harness = await createTestHarness({
      enableWorkspaceIsolation: true,
      orchestratorPlanner: async () => ({
        summary: "单任务计划",
        tasks: [
          {
            title: "实现登录页",
            description: "实现登录页",
            suggested_agent: null,
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Rerun Diff Isolation",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const userMessage = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个登录页",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });
    const orchestrated = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个登录页",
      sourceMessageId: userMessage.json().id,
    });
    const firstPlanItem = orchestrated.json().plan.items[0];

    await waitFor(async () => {
      const run = harness.server.app.locals.runsService.getDetail(firstPlanItem.runId);
      return run?.status === "completed";
    });
    const firstRunWorkspace = harness.server.app.locals.runsService.getRunWorkspace(firstPlanItem.runId);

    const rerun = await harness.client.post(`/tasks/${firstPlanItem.taskId}/rerun`);
    const rerunRunId = rerun.json().run.id;
    await waitFor(async () => {
      const run = harness.server.app.locals.runsService.getDetail(rerunRunId);
      return run?.status === "completed";
    });
    const rerunWorkspace = harness.server.app.locals.runsService.getRunWorkspace(rerunRunId);
    expect(firstRunWorkspace?.root_path).toBeTruthy();
    expect(rerunWorkspace?.root_path).toBeTruthy();
    const changedFile = path.join(rerunWorkspace!.root_path, "src", "rerun-only.ts");
    fs.mkdirSync(path.dirname(changedFile), { recursive: true });
    fs.writeFileSync(changedFile, "export const rerun = true;\n");

    const oldRunResponse = await harness.client.get(`/runs/${firstPlanItem.runId}/file-changes`);
    const newRunResponse = await harness.client.get(`/runs/${rerunRunId}/file-changes`);

    expect(oldRunResponse.statusCode).toBe(200);
    expect(oldRunResponse.json()).toEqual([]);
    expect(newRunResponse.statusCode).toBe(200);
    expect(newRunResponse.json()).toEqual([
      expect.objectContaining({
        filePath: "src/rerun-only.ts",
      }),
    ]);
  });

  it("filters generated directories and lockfiles from filesystem diff scans", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-ignore-fs-"));
    const workspacePath = path.join(tempRoot, "workspace");
    const runWorkspacePath = path.join(tempRoot, "run-workspace");
    const dbPath = path.join(tempRoot, "test.sqlite");
    fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "src"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "node_modules/pkg"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "dist"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "coverage"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "custom-cache"), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, ".gitignore"), "coverage/\ncustom-cache/\n");
    fs.writeFileSync(path.join(runWorkspacePath, ".gitignore"), "coverage/\ncustom-cache/\n");
    fs.writeFileSync(path.join(workspacePath, "src/app.ts"), "old\n");
    fs.writeFileSync(path.join(runWorkspacePath, "src/app.ts"), "new\n");
    fs.writeFileSync(path.join(runWorkspacePath, "node_modules/pkg/index.js"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "dist/app.js"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "coverage/out.txt"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "custom-cache/tmp.txt"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "package-lock.json"), "{}\n");

    const db = new DatabaseClient(dbPath);
    db.db.exec("PRAGMA foreign_keys = OFF");
    db.db.prepare(`
      INSERT INTO workspaces (id, conversation_id, root_path, mode, created_at, updated_at)
      VALUES ('ws-ignore-fs', 'conv-ignore-fs', ?, 'direct', '2026-01-01', '2026-01-01')
    `).run(workspacePath);
    db.db.prepare(`
      INSERT INTO agent_runs (id, conversation_id, task_id, agent_id, runtime_id,
        agent_session_id, assignment_id, source_message_id, workspace_id, prompt,
        trigger_type, trigger_source_id, requested_by, status, pid, exit_code,
        error_message, started_at, finished_at)
      VALUES ('run-ignore-fs', 'conv-ignore-fs', NULL, 'agent-1', NULL, NULL, NULL, NULL,
        'ws-ignore-fs', 'test', 'chat', 'conv-ignore-fs', 'user', 'completed', NULL, 0, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z')
    `).run();
    db.db.prepare(`
      INSERT INTO run_workspaces (id, run_id, conversation_id, base_workspace_id,
        mode, root_path, branch_name, base_ref, status, error_message, created_at, updated_at)
      VALUES ('rws-ignore-fs', 'run-ignore-fs', 'conv-ignore-fs', 'ws-ignore-fs', 'copy', ?, NULL, NULL,
        'ready', NULL, '2026-01-01', '2026-01-01')
    `).run(runWorkspacePath);
    db.close();

    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");
    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: false },
    );
    try {
      const response = await inject(server.app, {
        method: "GET",
        url: "/runs/run-ignore-fs/file-changes",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          filePath: "src/app.ts",
          changeType: "edit",
        }),
      ]);
    } finally {
      await server.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("filters generated directories and lockfiles from git diff scans", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-ignore-git-"));
    const workspacePath = path.join(tempRoot, "workspace");
    const runWorkspacePath = path.join(tempRoot, "run-workspace");
    const dbPath = path.join(tempRoot, "test.sqlite");
    fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, ".gitignore"), "coverage/\ncustom-cache/\n");
    fs.writeFileSync(path.join(workspacePath, "src/app.ts"), "old\n");
    fs.writeFileSync(path.join(workspacePath, "package.json"), '{ "name": "test" }\n');
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: workspacePath, stdio: "ignore" });
    execSync("git add -A", { cwd: workspacePath, stdio: "ignore" });
    execSync('git -c user.name="AgentHub" -c user.email="agenthub@local" commit -m "baseline"', { cwd: workspacePath, stdio: "ignore" });
    const baseRef = execSync("git rev-parse HEAD", { cwd: workspacePath, encoding: "utf8" }).trim();
    execSync(`git clone --no-hardlinks ${workspacePath} ${runWorkspacePath}`, { cwd: tempRoot, stdio: "ignore" });
    fs.writeFileSync(path.join(runWorkspacePath, "src/app.ts"), "new\n");
    fs.mkdirSync(path.join(runWorkspacePath, "node_modules/pkg"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "dist"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "coverage"), { recursive: true });
    fs.mkdirSync(path.join(runWorkspacePath, "custom-cache"), { recursive: true });
    fs.writeFileSync(path.join(runWorkspacePath, "node_modules/pkg/index.js"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "dist/app.js"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "coverage/out.txt"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "custom-cache/tmp.txt"), "ignored\n");
    fs.writeFileSync(path.join(runWorkspacePath, "package-lock.json"), "{}\n");

    const db = new DatabaseClient(dbPath);
    db.db.exec("PRAGMA foreign_keys = OFF");
    db.db.prepare(`
      INSERT INTO workspaces (id, conversation_id, root_path, mode, created_at, updated_at)
      VALUES ('ws-ignore-git', 'conv-ignore-git', ?, 'direct', '2026-01-01', '2026-01-01')
    `).run(workspacePath);
    db.db.prepare(`
      INSERT INTO agent_runs (id, conversation_id, task_id, agent_id, runtime_id,
        agent_session_id, assignment_id, source_message_id, workspace_id, prompt,
        trigger_type, trigger_source_id, requested_by, status, pid, exit_code,
        error_message, started_at, finished_at)
      VALUES ('run-ignore-git', 'conv-ignore-git', NULL, 'agent-1', NULL, NULL, NULL, NULL,
        'ws-ignore-git', 'test', 'chat', 'conv-ignore-git', 'user', 'completed', NULL, 0, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z')
    `).run();
    db.db.prepare(`
      INSERT INTO run_workspaces (id, run_id, conversation_id, base_workspace_id,
        mode, root_path, branch_name, base_ref, status, error_message, created_at, updated_at)
      VALUES ('rws-ignore-git', 'run-ignore-git', 'conv-ignore-git', 'ws-ignore-git', 'git_clone', ?, NULL, ?,
        'ready', NULL, '2026-01-01', '2026-01-01')
    `).run(runWorkspacePath, baseRef);
    db.close();

    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");
    const server = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      { enableWorkspaceIsolation: false },
    );
    try {
      const response = await inject(server.app, {
        method: "GET",
        url: "/runs/run-ignore-git/file-changes",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          filePath: "src/app.ts",
          changeType: "edit",
        }),
      ]);
    } finally {
      await server.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
