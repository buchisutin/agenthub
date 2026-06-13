import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { ChildProcess } from "node:child_process";
import inject from "light-my-request";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewService } from "../src/modules/preview/preview.service.js";
import { createAgentHubServer } from "../src/app.js";
import { createTestHarness, waitFor } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stdout = { resume() {} };
  stderr = { resume() {} };

  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0);
    return true;
  }
}

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

async function createCompletedRunHarness() {
  const harness = await createTestHarness();
  harnesses.push(harness);
  const client = harness.client;
  const conversation = await client.post("/conversations", {
    title: "Preview",
    type: "single",
  });
  const conversationId = conversation.json().id;
  await client.post(`/conversations/${conversationId}/workspace`, {
    rootPath: harness.workspacePath,
  });
  const runResponse = await client.post(`/conversations/${conversationId}/runs`, {
    prompt: "hello",
  });
  const runId = runResponse.json().id;
  await waitFor(async () => {
    const run = await client.get(`/runs/${runId}`);
    return run.json().status === "completed";
  });

  return {
    harness,
    client,
    runId,
    conversationId,
  };
}

async function createCompletedOrchestratedRunsHarness() {
  const harness = await createTestHarness({
    orchestratorPlanner: async () => ({
      summary: "前后端拆分",
      tasks: [
        {
          title: "前端页面",
          description: "实现前端页面",
          suggested_agent: "frontend-agent",
          priority: 1,
        },
        {
          title: "后端接口",
          description: "实现后端接口",
          suggested_agent: "backend-agent",
          priority: 2,
        },
      ],
    }),
  });
  harnesses.push(harness);
  harness.createAgent("frontend-agent");
  harness.createAgent("backend-agent");

  const conversation = await harness.client.post("/conversations", {
    title: "Orchestrated Preview",
    type: "single",
  });
  const conversationId = conversation.json().id;
  await harness.client.post(`/conversations/${conversationId}/workspace`, {
    rootPath: harness.workspacePath,
  });

  const orchestrated = await harness.client.post(
    `/conversations/${conversationId}/orchestrate`,
    { prompt: "做一个带登录的博客系统" },
  );
  const runs = orchestrated.json().runs as Array<{ id: string }>;

  await waitFor(async () => {
    const current = await Promise.all(runs.map((run) => harness.client.get(`/runs/${run.id}`)));
    return current.every((run) => run.json().status === "completed");
  });

  return {
    harness,
    runIds: runs.map((run) => run.id),
  };
}

describe("PreviewService", () => {
  let spawnProcess: (command: string, args: string[], options: { cwd: string; stdio: ["ignore", "pipe", "pipe"] }) => ChildProcess;
  let waitForUrl: (url: string, timeoutMs: number, process: ChildProcess) => Promise<void>;
  let isPortAvailable: (port: number) => Promise<boolean>;
  let spawnProcessMock: any;
  let waitForUrlMock: any;
  let isPortAvailableMock: any;

  beforeEach(() => {
    spawnProcessMock = vi.fn(() => new MockChildProcess() as unknown as ChildProcess);
    waitForUrlMock = vi.fn(async () => undefined);
    isPortAvailableMock = vi.fn(async (port: number) => port >= 3100 && port <= 3199);
    spawnProcess = (command, args, options) =>
      spawnProcessMock(command, args, options) as ChildProcess;
    waitForUrl = (url, timeoutMs, process) =>
      waitForUrlMock(url, timeoutMs, process) as Promise<void>;
    isPortAvailable = (port) =>
      isPortAvailableMock(port) as Promise<boolean>;
  });

  it("starts preview for a completed run using package.json scripts.dev", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const preview = await previewService.startPreviewForRun(runId);

    expect(preview).toEqual({ url: "http://127.0.0.1:3100", port: 3100 });
    expect(spawnProcessMock).toHaveBeenCalledWith(
      "npm",
      ["run", "dev", "--", "--host", "127.0.0.1", "--port", "3100"],
      expect.objectContaining({ cwd: harness.workspacePath }),
    );
  });

  it("falls back to static serve when only index.html exists", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(path.join(harness.workspacePath, "index.html"), "<html></html>");

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const preview = await previewService.startPreviewForRun(runId);

    expect(preview.port).toBe(3100);
    expect(spawnProcessMock).toHaveBeenCalledWith(
      "npx",
      ["serve", "-l", "3100", harness.workspacePath],
      expect.objectContaining({ cwd: harness.workspacePath }),
    );
  });

  it("rejects preview start for non-completed runs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;
    const conversation = await client.post("/conversations", {
      title: "Running Preview",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const runResponse = await client.post(`/conversations/${conversationId}/runs`, {
      prompt: "slow hello",
    });

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    await expect(previewService.startPreviewForRun(runResponse.json().id)).rejects.toThrow(
      "Preview is only available for completed runs",
    );
  });

  it("returns 404 from route when run does not exist", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.post("/runs/missing-run/preview/start");
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when run has no workspace", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    const database = harness.server.app.locals.runsService["database"];
    database.db.exec("PRAGMA foreign_keys = OFF");
    database.db
      .prepare("UPDATE agent_runs SET workspace_id = ? WHERE id = ?")
      .run("missing-workspace", runId);
    database.db.exec("PRAGMA foreign_keys = ON");

    const response = await harness.client.post(`/runs/${runId}/preview/start`);
    expect(response.statusCode).toBe(400);
  });

  it("reuses the same preview for repeated starts", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const first = await previewService.startPreviewForRun(runId);
    const second = await previewService.startPreviewForRun(runId);

    expect(first).toEqual(second);
    expect(spawnProcessMock).toHaveBeenCalledTimes(1);
  });

  it("cleans registry on stop", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    await previewService.startPreviewForRun(runId);
    expect(previewService.getPreview(runId)).not.toBeNull();

    await previewService.stopPreviewForRun(runId);

    expect(previewService.getPreview(runId)).toBeNull();
  });

  it("returns ok when stopping a missing preview", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    await expect(previewService.stopPreviewForRun("missing-run")).resolves.toEqual({
      ok: true,
    });
  });

  it("returns 400 when workspace cannot be previewed", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    await expect(previewService.startPreviewForRun(runId)).rejects.toThrow(
      "Current workspace cannot be previewed",
    );
  });

  it("uses only ports inside 3100-3199", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    isPortAvailableMock = vi
      .fn()
      .mockImplementation(async (port: number) => port === 3102);
    isPortAvailable = (port) =>
      isPortAvailableMock(port) as Promise<boolean>;

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const preview = await previewService.startPreviewForRun(runId);
    expect(preview.port).toBe(3102);
    expect(isPortAvailableMock).toHaveBeenCalledWith(3100);
    expect(isPortAvailableMock).toHaveBeenCalledWith(3101);
    expect(isPortAvailableMock).toHaveBeenCalledWith(3102);
  });

  it("starts previews for orchestrated completed runs and isolates them by runId", async () => {
    const { harness, runIds } = await createCompletedOrchestratedRunsHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    let nextPid = 100;
    spawnProcessMock = vi.fn(
      () => {
        const process = new MockChildProcess() as unknown as ChildProcess & {
          pid?: number;
        };
        process.pid = nextPid++;
        return process as ChildProcess;
      },
    );
    spawnProcess = (command, args, options) =>
      spawnProcessMock(command, args, options) as ChildProcess;

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const first = await previewService.startPreviewForRun(runIds[0]!);
    const second = await previewService.startPreviewForRun(runIds[1]!);

    expect(first.url).toBe("http://127.0.0.1:3100");
    expect(second.url).toMatch(/^http:\/\/127\.0\.0\.1:31\d{2}$/);
    expect(spawnProcessMock).toHaveBeenCalledTimes(2);
    expect(previewService.getPreview(runIds[0]!)).not.toBeNull();
    expect(previewService.getPreview(runIds[1]!)).not.toBeNull();

    await previewService.stopPreviewForRun(runIds[0]!);

    expect(previewService.getPreview(runIds[0]!)).toBeNull();
    expect(previewService.getPreview(runIds[1]!)).not.toBeNull();
  });

  it("starts preview for the rerun latest run without affecting the old run", async () => {
    const harness = await createTestHarness({
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
      title: "Rerun Preview",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

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

    const rerun = await harness.client.post(`/tasks/${firstPlanItem.taskId}/rerun`);
    const rerunRunId = rerun.json().run.id;
    await waitFor(async () => {
      const run = harness.server.app.locals.runsService.getDetail(rerunRunId);
      return run?.status === "completed";
    });

    const previewService = new PreviewService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess, waitForUrl, isPortAvailable },
    );

    const oldPreview = await previewService.startPreviewForRun(firstPlanItem.runId);
    const newPreview = await previewService.startPreviewForRun(rerunRunId);
    expect(oldPreview.url).toBe("http://127.0.0.1:3100");
    expect(newPreview.url).toMatch(/^http:\/\/127\.0\.0\.1:31\d{2}$/);

    await previewService.stopPreviewForRun(rerunRunId);
    expect(previewService.getPreview(firstPlanItem.runId)).not.toBeNull();
    expect(previewService.getPreview(rerunRunId)).toBeNull();
  });
});

describe("preview routes", () => {
  it("starts and stops preview through run-scoped routes", async () => {
    const harness = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    await harness.harness.server.close();
    harnesses.pop();

    const server = createAgentHubServer(
      {
        dbPath: harness.harness.dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [path.resolve("tests/fixtures/mock-claude-cli.mjs")],
        claudeAllowedTools: [],
      },
      {
        previewServiceDeps: {
          spawnProcess: vi.fn(() => new MockChildProcess() as unknown as ChildProcess),
          waitForUrl: vi.fn(async () => undefined),
          isPortAvailable: vi.fn(async () => true),
        },
      },
    );
    const startResponse = await inject(server.app, {
      method: "POST",
      url: `/runs/${harness.runId}/preview/start`,
    });
    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json().url).toBe("http://127.0.0.1:3100");

    const stopResponse = await inject(server.app, {
      method: "POST",
      url: `/runs/${harness.runId}/preview/stop`,
    });
    expect(stopResponse.statusCode).toBe(200);
    expect(stopResponse.json()).toEqual({ ok: true });

    await server.close();
  });
});
