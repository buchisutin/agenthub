import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentHubServer } from "../src/app.js";
import { createTestHarness, waitFor } from "./helpers.js";
import { AgentRuntime, RuntimeCompletion, RuntimeEventHandler } from "../src/runtime/base/agent-runtime.js";
import { RuntimeRegistry } from "../src/runtime/runtime-registry.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

describe("Minimal orchestrator", () => {
  it("starts only root tasks first and unlocks dependents after completion", async () => {
    const pending = new Map<
      string,
      { resolve: (value: RuntimeCompletion) => void; status: "pending" | "resolved" }
    >();
    const runtime: AgentRuntime = {
      startRun: async (input, handler: RuntimeEventHandler) => {
        await handler.onEvent({
          type: "text_delta",
          runId: input.runId,
          conversationId: input.conversationId,
          delta: `started:${input.runId}`,
        });
        let resolve!: (value: RuntimeCompletion) => void;
        const completion = new Promise<RuntimeCompletion>((nextResolve) => {
          resolve = nextResolve;
        });
        pending.set(input.runId, { resolve, status: "pending" });
        return {
          pid: 123,
          completion,
        };
      },
      interruptRun: async () => undefined,
      checkAvailabilitySync: () => ({
        adapterType: "claude_cli",
        available: true,
        executablePath: "mock-runtime",
        version: "test",
      }),
    };
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: runtime,
        codex_cli: runtime,
      }),
      orchestratorPlanner: async () => ({
        summary: "有依赖的计划",
        tasks: [
          {
            id: "t1",
            title: "后端接口",
            description: "实现后端接口",
            task_type: "backend",
            expected_output: "API",
            suggested_agent: "backend-agent",
            priority: 1,
            depends_on: [],
          },
          {
            id: "t2",
            title: "前端页面",
            description: "实现前端页面",
            task_type: "frontend",
            expected_output: "UI",
            suggested_agent: "frontend-agent",
            priority: 1,
            depends_on: ["t1"],
          },
          {
            id: "t3",
            title: "单元测试",
            description: "补测试",
            task_type: "test",
            expected_output: "Tests",
            suggested_agent: "tester-agent",
            priority: 1,
            depends_on: ["t1"],
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("backend-agent");
    harness.createAgent("frontend-agent");
    harness.createAgent("tester-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "DAG",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个有依赖的任务链",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().runs).toHaveLength(1);
    expect(response.json().plan.items[0].runId).toBeTruthy();
    expect(response.json().plan.items[1].runId).toBeNull();
    expect(response.json().plan.items[2].runId).toBeNull();

    const rootRunId = response.json().plan.items[0].runId as string;
    pending.get(rootRunId)?.resolve({ status: "completed", exitCode: 0 });

    await waitFor(async () => {
      const runs = await harness.client.get(`/conversations/${conversationId}/runs`);
      return runs.json().length === 3;
    });

    for (const entry of pending.values()) {
      if (entry.status === "pending") {
        entry.status = "resolved";
        entry.resolve({ status: "completed", exitCode: 0 });
      }
    }

    await waitFor(async () => {
      const runs = await harness.client.get(`/conversations/${conversationId}/runs`);
      return runs.json().length === 3 &&
        runs.json().every((run: { status: string }) => run.status === "completed");
    });

    await waitFor(async () => {
      const messages = await harness.client.get(`/conversations/${conversationId}/messages`);
      return messages.json().some((message: { message_type: string; content: string }) =>
        message.message_type === "system" && message.content.includes("已全部完成"),
      );
    });

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const plan = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(plan.plan.items[1].runId).toBeTruthy();
    expect(plan.plan.items[2].runId).toBeTruthy();

    const messages = await harness.client.get(`/conversations/${conversationId}/messages`);
    expect(messages.json().some((message: { message_type: string; content: string }) =>
      message.message_type === "system" &&
      message.content.includes("协作计划已全部完成"),
    )).toBe(true);

  });

  it("marks downstream tasks blocked after upstream failure", async () => {
    const pending = new Map<string, (value: RuntimeCompletion) => void>();
    const runtime: AgentRuntime = {
      startRun: async (input) => {
        let resolve!: (value: RuntimeCompletion) => void;
        const completion = new Promise<RuntimeCompletion>((nextResolve) => {
          resolve = nextResolve;
        });
        pending.set(input.runId, resolve);
        return {
          pid: 321,
          completion,
        };
      },
      interruptRun: async () => undefined,
      checkAvailabilitySync: () => ({
        adapterType: "claude_cli",
        available: true,
        executablePath: "mock-runtime",
        version: "test",
      }),
    };
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: runtime,
        codex_cli: runtime,
      }),
      orchestratorPlanner: async () => ({
        summary: "失败传播",
        tasks: [
          {
            id: "t1",
            title: "后端接口",
            description: "实现后端接口",
            task_type: "backend",
            expected_output: "API",
            suggested_agent: "backend-agent",
            priority: 1,
            depends_on: [],
          },
          {
            id: "t2",
            title: "单元测试",
            description: "补测试",
            task_type: "test",
            expected_output: "Tests",
            suggested_agent: "tester-agent",
            priority: 1,
            depends_on: ["t1"],
          },
          {
            id: "t3",
            title: "集成测试",
            description: "补集成测试",
            task_type: "test",
            expected_output: "Integration tests",
            suggested_agent: "tester-agent",
            priority: 1,
            depends_on: ["t2"],
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("backend-agent");
    harness.createAgent("tester-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Blocked DAG",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "失败传播场景",
    });
    const rootRunId = response.json().plan.items[0].runId as string;
    pending.get(rootRunId)?.({ status: "failed", exitCode: 1, errorMessage: "boom" });

    await waitFor(async () => {
      const tasks = await harness.client.get(`/conversations/${conversationId}/tasks`);
      return tasks.json().some((task: { status: string }) => task.status === "blocked");
    });

    const tasks = await harness.client.get(`/conversations/${conversationId}/tasks`);
    expect(tasks.json().map((task: { status: string }) => task.status)).toEqual([
      "failed",
      "blocked",
      "blocked",
    ]);
  });

  it("returns plan and runs, and creates one normal run per planner task", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "拆成三个子任务",
        tasks: [
          {
            title: "前端页面",
            description: "实现前端页面",
            task_type: "frontend",
            expected_output: "A working frontend UI implementation.",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
          {
            title: "后端接口",
            description: "实现后端接口",
            task_type: "backend",
            expected_output: "API and service changes for the backend.",
            suggested_agent: "backend-agent",
            priority: 2,
          },
          {
            title: "测试用例",
            description: "补测试用例",
            task_type: "test",
            expected_output: "Automated tests covering the new behavior.",
            suggested_agent: "tester-agent",
            priority: 3,
          },
        ],
      }),
    });
    harnesses.push(harness);
    const client = harness.client;
    const frontendAgentId = harness.createAgent("frontend-agent");
    const backendAgentId = harness.createAgent("backend-agent");
    const testerAgentId = harness.createAgent("tester-agent");

    const conversation = await client.post("/conversations", {
      title: "Orchestrate",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const userMessage = await client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个博客系统",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });

    const response = await client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个博客系统",
      sourceMessageId: userMessage.json().id,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.plan.summary).toBe("拆成三个子任务");
    expect(body.plan.items).toHaveLength(3);
    expect(body.runs).toHaveLength(3);
    expect(body.plan.items[0].taskType).toBe("frontend");
    expect(body.plan.items[0].expectedOutput).toBe("A working frontend UI implementation.");
    expect(body.plan.items.map((item: { assignedAgentId: string }) => item.assignedAgentId)).toEqual([
      frontendAgentId,
      backendAgentId,
      testerAgentId,
    ]);

    const listedRuns = await client.get(`/conversations/${conversationId}/runs`);
    expect(listedRuns.statusCode).toBe(200);
    expect(listedRuns.json()).toHaveLength(3);

    const messages = await client.get(`/conversations/${conversationId}/messages`);
    const planMessage = messages.json().find((message: { message_type: string }) => message.message_type === "plan");
    expect(planMessage).toBeTruthy();
    expect(planMessage.metadata_json.planId).toBe(body.plan.id);
    expect(planMessage.metadata_json.runIds).toHaveLength(3);

    const tasks = await client.get(`/conversations/${conversationId}/tasks`);
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()[0].task_type).toBe("frontend");
    expect(tasks.json()[0].expected_output).toBe("A working frontend UI implementation.");
  });

  it("matches suggested agent by name", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "按名称匹配",
        tasks: [
          {
            title: "前端",
            description: "前端工作",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);
    const frontendAgentId = harness.createAgent("frontend-agent");
    const conversation = await harness.client.post("/conversations", { title: "Name", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做前端",
    });
    expect(response.json().plan.items[0].assignedAgentId).toBe(frontendAgentId);
  });

  it("blocks orchestration when the bound workspace has uncommitted changes", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "不应执行",
        tasks: [],
      }),
    });
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Dirty Orchestrator",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    fs.writeFileSync(path.join(harness.workspacePath, "hellotest.txt"), "local change\n", "utf8");

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个博客系统",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "dirty_workspace_blocked",
      workspaceStatus: {
        state: "dirty",
        dirtyFilesCount: 1,
        dirtyFilesSample: ["hellotest.txt"],
      },
    });
    expect(response.json().detail).toContain("hellotest.txt");
  });

  it("matches suggested agent by slug", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "按 slug 匹配",
        tasks: [
          {
            title: "前端",
            description: "前端工作",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);
    const frontendAgentId = harness.createAgent("Frontend Agent");
    const conversation = await harness.client.post("/conversations", { title: "Slug", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做前端",
    });
    expect(response.json().plan.items[0].assignedAgentId).toBe(frontendAgentId);
  });

  it("falls back to the default agent when suggested agent cannot be matched", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "默认 agent",
        tasks: [
          {
            title: "未知任务",
            description: "unknown",
            suggested_agent: "missing-agent",
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Default", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个任务",
    });
    expect(response.json().plan.items[0].assignedAgentName).toBe("claude-code");
  });

  it("prefers a task-type-matching agent before falling back to the default agent", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "按任务类型兜底",
        tasks: [
          {
            title: "前端界面",
            description: "实现一个设置页 UI",
            task_type: "frontend",
            expected_output: "A working React settings page.",
            suggested_agent: "missing-agent",
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);
    const frontendAgentId = harness.createAgent("frontend-agent", { isDefault: false });
    const conversation = await harness.client.post("/conversations", { title: "Task Type", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个设置页",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.items[0].assignedAgentId).toBe(frontendAgentId);
  });

  it("uses only enabled agents for planning and assignment", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async ({ agents }) => {
        expect(agents.some((agent) => agent.name === "disabled-agent")).toBe(false);
        return {
          summary: "只看启用 Agent",
          tasks: [
            {
              title: "前端任务",
              description: "做前端",
              suggested_agent: "frontend-agent",
              priority: 1,
            },
          ],
        };
      },
    });
    harnesses.push(harness);
    const frontendAgentId = harness.createAgent("frontend-agent");
    const disabled = await harness.client.post("/agents", {
      name: "disabled-agent",
      slug: "disabled-agent",
      adapterType: "claude_cli",
      enabled: false,
    });
    expect(disabled.statusCode).toBe(201);

    const conversation = await harness.client.post("/conversations", { title: "Enabled Only", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做前端",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.items[0].assignedAgentId).toBe(frontendAgentId);
  });

  it("passes agent capabilities and instruction summaries into the planner prompt", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async ({ prompt, agents, workspaceStatus }) => {
        expect(prompt).toContain("frontend|backend|test|docs|review|deploy|general");
        expect(prompt).toContain("Build a new dashboard");
        expect(prompt).toContain("Build polished React interfaces.");
        expect(prompt).toContain('"capabilities":["frontend","react","ui"]');
        expect(prompt).toContain('"state":"clean"');
        expect(prompt).toContain('"dirty_files_count":0');
        expect(prompt).toContain("map each one directly to a task without re-splitting or merging them");
        expect(prompt).toContain("task title must be a short verb phrase under 20 characters");
        expect(prompt).toContain("Treat workspace status as hard context for planning");
        expect(prompt).toContain("If workspace state is clean, prefer incremental tasks");
        expect(prompt).toContain("prefer setup tasks that create the initial project structure");
        expect(prompt).toContain("do not mention commit hashes in task titles");
        expect(prompt).toContain("not a summary of project architecture");
        expect(prompt).toContain("Prefer parallel root tasks when deliverables touch independent files or can be safely merged later");
        expect(prompt).toContain("For UI feature work such as a feedback form, split independent component logic, styles, assets, or copy into parallel root tasks when each task can produce a valid standalone change");
        expect(prompt).toContain("If a task must import or directly use a file created by another task, keep the dependency");
        expect(prompt).toContain("For build verification tasks, depends_on should include every implementation or integration task it validates");
        expect(agents.some((agent) => agent.slug === "frontend-agent")).toBe(true);
        expect(workspaceStatus).toMatchObject({
          state: "clean",
          dirtyFilesCount: 0,
          dirtyFilesSample: [],
        });
        return {
          summary: "单任务计划",
          tasks: [
            {
              title: "前端任务",
              description: "实现仪表盘",
              task_type: "frontend",
              expected_output: "React dashboard implementation.",
              suggested_agent: "frontend-agent",
              priority: 1,
            },
          ],
        };
      },
    });
    harnesses.push(harness);
    const services = harness.server.app.locals;
    services.agentsService.createAgent({
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
      instructions: "Build polished React interfaces.",
      capabilities: ["frontend", "react", "ui"],
      enabled: true,
    });
    const conversation = await harness.client.post("/conversations", { title: "Prompt Quality", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "Build a new dashboard",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.items[0].taskType).toBe("frontend");
  });

  it("preserves planner affected_files in plan items", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "包含文件范围",
        tasks: [
          {
            title: "前端任务",
            description: "更新首页",
            task_type: "frontend",
            expected_output: "Homepage changes.",
            affected_files: ["frontend/src/App.tsx", "frontend/src/components/*"],
            suggested_agent: "frontend-agent",
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("frontend-agent");

    const conversation = await harness.client.post("/conversations", { title: "Affected Files", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "更新首页",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.items[0].affectedFiles).toEqual([
      "frontend/src/App.tsx",
      "frontend/src/components/*",
    ]);

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const planItem = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(planItem.plan.items[0].affectedFiles).toEqual([
      "frontend/src/App.tsx",
      "frontend/src/components/*",
    ]);
  });

  it("falls back to a single task when planner output is invalid JSON", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => "not-json",
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Fallback", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, { rootPath: harness.workspacePath });
    const userMessage = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个登录系统",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个登录系统",
      sourceMessageId: userMessage.json().id,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.summary).toBe("已按单任务执行。");
    expect(response.json().plan.items).toHaveLength(1);
    expect(response.json().plan.items[0].taskType).toBe("general");
    expect(response.json().plan.items[0].expectedOutput).toBe(
      "Complete the requested change and summarize the result.",
    );
    expect(response.json().runs).toHaveLength(1);

    const listedRuns = await harness.client.get(`/conversations/${conversationId}/runs`);
    expect(listedRuns.statusCode).toBe(200);
    expect(listedRuns.json()).toHaveLength(1);
  });

  it("keeps diff lookup scoped to the matching orchestrated run", async () => {
    const harness = await createTestHarness({
      enableWorkspaceIsolation: true,
      orchestratorPlanner: async () => ({
        summary: "两个并行任务",
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
      title: "Orchestrated Diff",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      { prompt: "做一个登录功能" },
    );
    expect(response.statusCode).toBe(200);
    const [runA, runB] = response.json().runs as Array<{ id: string; agent_id: string }>;

    await waitFor(async () => {
      const runs = await harness.client.get(`/conversations/${conversationId}/runs`);
      return runs
        .json()
        .every((run: { status: string }) => run.status === "completed");
    });

    const runsService = harness.server.app.locals.runsService;
    const runADetail = runsService.getDetail(runA.id)!;
    const runAWorkspace = runsService.getRunWorkspace(runA.id);
    expect(runAWorkspace?.root_path).toBeTruthy();
    const targetPath = path.join(runAWorkspace!.root_path, "src", "login.tsx");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, "export const Login = () => null;\n");

    runsService.appendEvent(runA.id, conversationId, runsService.nextEventSeq(runA.id), {
      type: "tool_completed",
      runId: runA.id,
      conversationId,
      agentId: runADetail.agent_id,
      taskId: runADetail.task_id,
      toolUseId: "tool-write-login",
      toolName: "Write",
      input: {
        file_path: "src/login.tsx",
        content: "export const Login = () => null;\n",
      },
    });

    const fileChangesA = await harness.client.get(`/runs/${runA.id}/file-changes`);
    expect(fileChangesA.statusCode).toBe(200);
    expect(fileChangesA.json()).toHaveLength(1);
    expect(fileChangesA.json()[0].filePath).toBe("src/login.tsx");

    const fileChangesB = await harness.client.get(`/runs/${runB.id}/file-changes`);
    expect(fileChangesB.statusCode).toBe(200);
    expect(fileChangesB.json()).toEqual([]);
  });

  it("times out stalled watcher plans and cancels pending approvals", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const services = harness.server.app.locals;
    const conversation = services.conversationsService.create({
      title: "Watcher Timeout",
      type: "single",
    });
    services.workspacesService.bindWorkspace(conversation.id, {
      rootPath: harness.workspacePath,
    });
    const workspace = services.workspacesService.getByConversationId(conversation.id)!;
    const agent = services.agentsService.getDefaultAgent()!;
    const task = services.tasksService.create({
      conversationId: conversation.id,
      title: "Stalled task",
      status: "assigned",
    });
    const assignment = services.assignmentsService.createAssignment({
      taskId: task.id,
      conversationId: conversation.id,
      agentId: agent.id,
      status: "pending",
    });
    const run = services.runsService.create({
      conversationId: conversation.id,
      taskId: task.id,
      assignmentId: assignment.id,
      agentId: agent.id,
      runtimeId: null,
      agentSessionId: null,
      workspaceId: workspace.id,
      prompt: "wait forever",
    });
    services.assignmentsService.updateAssignmentStatus(assignment.id, "pending", run.id);

    const planMessage = services.messagesService.createMessage({
      conversationId: conversation.id,
      senderType: "orchestrator",
      content: "watch this plan",
      messageType: "plan",
      metadata: {
        planId: "timeout-plan",
        summary: "watch this plan",
        items: [],
        runIds: [run.id],
        watchStatus: "watching",
        watchStartedAt: new Date(Date.now() - 5_000).toISOString(),
        maxWatchMs: 100,
      },
    });
    const approval = services.approvalService.create({
      conversationId: conversation.id,
      runId: run.id,
      taskId: task.id,
      assignmentId: assignment.id,
      actionType: "apply_and_commit",
      title: "Apply later",
    });

    await services.orchestratorService.resumeWatchingPlans();

    const refreshedPlan = services.messagesService.getById(planMessage.id);
    expect(refreshedPlan?.metadata_json?.watchStatus).toBe("timed_out");
    expect(refreshedPlan?.metadata_json?.cancelledApprovalIds).toEqual([approval.id]);
    expect(services.approvalService.getById(approval.id)?.status).toBe("cancelled");

    const systemMessages = services.messagesService
      .listMessagesByConversation(conversation.id)
      .filter((message: { message_type: string }) => message.message_type === "system");
    expect(systemMessages.some((message: { content: string }) => message.content.includes("计划监听超时"))).toBe(true);
  });

  it("recovers watching plans on server startup and runs an immediate compensation check", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-recover-"));
    const workspacePath = path.join(tempRoot, "workspace");
    const dbPath = path.join(tempRoot, "test.sqlite");
    fs.mkdirSync(workspacePath, { recursive: true });
    const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");

    const serverA = createAgentHubServer(
      {
        port: 8000,
        dbPath,
        claudeCommand: process.execPath,
        claudeBaseArgs: [mockCliPath],
        claudeAllowedTools: [],
      },
      {
        enableWorkspaceIsolation: false,
      },
    );

    try {
      const servicesA = serverA.app.locals;
      const conversation = servicesA.conversationsService.create({
        title: "Recover Plan",
        type: "single",
      });
      servicesA.workspacesService.bindWorkspace(conversation.id, {
        rootPath: workspacePath,
      });
      const workspace = servicesA.workspacesService.getByConversationId(conversation.id)!;
      const agent = servicesA.agentsService.getDefaultAgent()!;
      const task = servicesA.tasksService.create({
        conversationId: conversation.id,
        title: "Recover stalled plan",
        status: "failed",
      });
      const assignment = servicesA.assignmentsService.createAssignment({
        taskId: task.id,
        conversationId: conversation.id,
        agentId: agent.id,
        status: "failed",
      });
      const run = servicesA.runsService.create({
        conversationId: conversation.id,
        taskId: task.id,
        assignmentId: assignment.id,
        agentId: agent.id,
        runtimeId: null,
        agentSessionId: null,
        workspaceId: workspace.id,
        prompt: "fail",
      });
      servicesA.runsService.updateStatus(run.id, {
        status: "failed",
        errorMessage: "boom",
        finishedAt: new Date().toISOString(),
      });
      servicesA.assignmentsService.updateAssignmentStatus(assignment.id, "failed", run.id);
      const planMessage = servicesA.messagesService.createMessage({
        conversationId: conversation.id,
        senderType: "orchestrator",
        content: "recover me",
        messageType: "plan",
        metadata: {
          planId: "recover-plan",
          summary: "recover me",
          items: [],
          runIds: [run.id],
          watchStatus: "watching",
          watchStartedAt: new Date().toISOString(),
          maxWatchMs: 60_000,
        },
      });

      await serverA.close();

      const serverB = createAgentHubServer(
        {
          port: 8000,
          dbPath,
          claudeCommand: process.execPath,
          claudeBaseArgs: [mockCliPath],
          claudeAllowedTools: [],
        },
        {
          enableWorkspaceIsolation: false,
        },
      );

      try {
        const servicesB = serverB.app.locals;
        await waitFor(async () => {
          const current = servicesB.messagesService.getById(planMessage.id);
          return current?.metadata_json?.watchStatus === "blocked";
        }, 2000);

        const recoveredPlan = servicesB.messagesService.getById(planMessage.id);
        expect(recoveredPlan?.metadata_json?.watchStatus).toBe("blocked");
      } finally {
        await serverB.close();
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns 400 for empty prompt", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Empty", type: "single" });

    const response = await harness.client.post(`/conversations/${conversation.json().id}/orchestrate`, {
      prompt: "   ",
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when conversation does not exist", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.post("/conversations/missing/orchestrate", {
      prompt: "hello",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when no available agent can be resolved", async () => {
    const harness = await createTestHarness({
        orchestratorService: {
          async orchestrateConversation() {
            throw new Error("No available agent");
          },
        } as never,
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "No Agent", type: "single" });

    const response = await harness.client.post(`/conversations/${conversation.json().id}/orchestrate`, {
      prompt: "hello",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects planner output with cyclic dependencies", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "循环依赖",
        tasks: [
          {
            id: "t1",
            title: "任务一",
            description: "先做一",
            priority: 1,
            depends_on: ["t2"],
          },
          {
            id: "t2",
            title: "任务二",
            description: "再做二",
            priority: 1,
            depends_on: ["t1"],
          },
        ],
      }),
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Cycle", type: "single" });
    await harness.client.post(`/conversations/${conversation.json().id}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversation.json().id}/orchestrate`, {
      prompt: "循环任务",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toContain("cyclic dependency detected: t1 -> t2 -> t1");
  });

  it("writes upstream task outputs and injects them into downstream prompts", async () => {
    const runtimePrompts: string[] = [];
    const runtime: AgentRuntime = {
      startRun: async (input, handler: RuntimeEventHandler) => {
        runtimePrompts.push(input.prompt);
        await handler.onEvent({
          type: "text_delta",
          runId: input.runId,
          conversationId: input.conversationId,
          delta: runtimePrompts.length === 1
            ? "Created the API contract in docs/api.md"
            : "Consumed upstream API contract",
        });
        return {
          pid: 999,
          completion: Promise.resolve({ status: "completed", exitCode: 0 }),
        };
      },
      interruptRun: async () => undefined,
      checkAvailabilitySync: () => ({
        adapterType: "claude_cli",
        available: true,
        executablePath: "mock-runtime",
        version: "test",
      }),
    };
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({ claude_cli: runtime, codex_cli: runtime }),
      orchestratorPlanner: async () => ({
        summary: "产物传递",
        tasks: [
          {
            id: "t1",
            title: "接口契约",
            description: "输出接口契约",
            task_type: "backend",
            expected_output: "API contract",
            priority: 1,
            depends_on: [],
          },
          {
            id: "t2",
            title: "前端接入",
            description: "基于接口契约接入前端",
            task_type: "frontend",
            expected_output: "Frontend integration",
            priority: 1,
            depends_on: ["t1"],
          },
        ],
      }),
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Outputs", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "先做接口再做前端",
    });

    expect(response.statusCode).toBe(200);
    await waitFor(async () => runtimePrompts.length === 2);

    expect(runtimePrompts[1]).toContain("Upstream task outputs");
    expect(runtimePrompts[1]).toContain("t1 接口契约");
    expect(runtimePrompts[1]).toContain("Created the API contract in docs/api.md");

    const messages = await harness.client.get(`/conversations/${conversationId}/messages`);
    const planMessage = messages.json().find((message: { message_type: string }) => message.message_type === "plan");
    const artifactPath = path.join(
      harness.workspacePath,
      ".agenthub",
      "runs",
      planMessage.metadata_json.planId,
      "outputs",
      "t1.md",
    );
    expect(fs.readFileSync(artifactPath, "utf8")).toContain("Created the API contract in docs/api.md");
  });

  it("resumes a plan from one DAG task and reruns that task plus downstream tasks", async () => {
    const runtimePrompts: string[] = [];
    const runtime: AgentRuntime = {
      startRun: async (input) => {
        runtimePrompts.push(input.prompt);
        return {
          pid: 111,
          completion: Promise.resolve({ status: "completed", exitCode: 0 }),
        };
      },
      interruptRun: async () => undefined,
      checkAvailabilitySync: () => ({
        adapterType: "claude_cli",
        available: true,
        executablePath: "mock-runtime",
        version: "test",
      }),
    };
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({ claude_cli: runtime, codex_cli: runtime }),
      orchestratorPlanner: async () => ({
        summary: "可恢复计划",
        tasks: [
          { id: "t1", title: "基础", description: "基础任务", priority: 1, depends_on: [] },
          { id: "t2", title: "实现", description: "实现任务", priority: 1, depends_on: ["t1"] },
          { id: "t3", title: "测试", description: "测试任务", priority: 1, depends_on: ["t2"] },
        ],
      }),
    });
    harnesses.push(harness);
    const conversation = await harness.client.post("/conversations", { title: "Resume", type: "single" });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "跑完整链路",
    });
    await waitFor(async () => runtimePrompts.length === 3);

    const messages = await harness.client.get(`/conversations/${conversationId}/messages`);
    const planMessage = messages.json().find((message: { message_type: string }) => message.message_type === "plan");
    const resume = await harness.client.post(`/plans/${planMessage.id}/resume`, {
      from: "t2",
    });

    expect(resume.statusCode).toBe(200);
    expect(resume.json().rerunPlannerTaskIds).toEqual(["t2", "t3"]);
    await waitFor(async () => runtimePrompts.length === 5);
    expect(runtimePrompts.slice(3).join("\n")).toContain("实现任务");
    expect(runtimePrompts.slice(3).join("\n")).toContain("测试任务");
  });
});
