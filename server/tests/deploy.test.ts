import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeployService } from "../src/modules/deploy/deploy.service.js";
import { createTestHarness, waitFor } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

class MockChildProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

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
  const conversation = await harness.client.post("/conversations", {
    title: "Deploy",
    type: "single",
  });
  const conversationId = conversation.json().id;
  await harness.client.post(`/conversations/${conversationId}/workspace`, {
    rootPath: harness.workspacePath,
  });
  const runResponse = await harness.client.post(`/conversations/${conversationId}/runs`, {
    prompt: "hello",
  });
  const runId = runResponse.json().id;
  await waitFor(async () => {
    const run = await harness.client.get(`/runs/${runId}`);
    return run.json().status === "completed";
  });

  return { harness, runId };
}

describe("DeployService", () => {
  it("lists deployable package scripts for a completed run", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", build: "vite build", start: "vite" } }),
    );
    const deployService = new DeployService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
    );

    const scripts = deployService.getScriptsForRun(runId);

    expect(scripts).toEqual({
      runId,
      scripts: ["dev", "build", "start"],
      defaultScript: "build",
    });
  });

  it("runs npm build and records streamed logs", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    );
    const child = new MockChildProcess();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
    const deployService = new DeployService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess },
    );

    const started = deployService.startDeploy(runId);
    child.stdout.emit("data", Buffer.from("vite build\n"));
    child.stderr.emit("data", Buffer.from("warning\n"));
    child.exitCode = 0;
    child.emit("exit", 0);

    await waitFor(async () => deployService.getDeploy(runId)?.status === "succeeded");
    const deploy = deployService.getDeploy(runId);

    expect(started.status).toBe("running");
    expect(spawnProcess).toHaveBeenCalledWith(
      "npm",
      ["run", "build"],
      expect.objectContaining({ cwd: harness.workspacePath }),
    );
    expect(deploy).toMatchObject({
      runId,
      status: "succeeded",
      command: "npm run build",
      exitCode: 0,
    });
    expect(deploy?.logs.map((entry) => entry.chunk).join("")).toContain("vite build");
    expect(deploy?.logs.map((entry) => entry.chunk).join("")).toContain("warning");
  });

  it("uses base workspace when run workspace has no node_modules", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    );
    fs.mkdirSync(path.join(harness.workspacePath, "node_modules"));
    const runWorkspacePath = path.join(path.dirname(harness.workspacePath), "run-workspace");
    fs.mkdirSync(runWorkspacePath);
    fs.writeFileSync(
      path.join(runWorkspacePath, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    );
    const run = harness.server.app.locals.runsService.getById(runId);
    harness.server.app.locals.runsService["database"].db.prepare(`
      INSERT INTO run_workspaces (
        id, run_id, conversation_id, base_workspace_id, mode, root_path,
        branch_name, base_ref, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "rw-deploy",
      runId,
      run.conversation_id,
      run.workspace_id,
      "copy",
      runWorkspacePath,
      null,
      null,
      "ready",
      null,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const child = new MockChildProcess();
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess);
    const deployService = new DeployService(
      harness.server.app.locals.runsService,
      harness.server.app.locals.workspacesService,
      { spawnProcess },
    );

    deployService.startDeploy(runId);

    expect(spawnProcess).toHaveBeenCalledWith(
      "npm",
      ["run", "build"],
      expect.objectContaining({ cwd: harness.workspacePath }),
    );
  });

  it("exposes deploy routes for scripts, start, and status", async () => {
    const { harness, runId } = await createCompletedRunHarness();
    fs.writeFileSync(
      path.join(harness.workspacePath, "package.json"),
      JSON.stringify({ scripts: { build: "vite build" } }),
    );

    const scripts = await harness.client.get(`/runs/${runId}/deploy/scripts`);
    expect(scripts.statusCode).toBe(200);
    expect(scripts.json().scripts).toEqual(["build"]);

    const start = await harness.client.post(`/runs/${runId}/deploy/start`, {
      script: "build",
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe("running");

    const status = await harness.client.get(`/runs/${runId}/deploy`);
    expect(status.statusCode).toBe(200);
    expect(status.json().command).toBe("npm run build");
  });
});
