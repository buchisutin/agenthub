import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, waitFor } from "./helpers.js";
import { AgentRuntime } from "../src/runtime/base/agent-runtime.js";
import { RunManager } from "../src/runtime/manager/run-manager.js";
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

describe("task / assignment minimal collaboration model", () => {
  it("creates tasks, assignments and linked runs during orchestration", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "拆成两个子任务",
        tasks: [
          {
            title: "前端页面",
            description: "实现前端页面",
            task_type: "frontend",
            expected_output: "Frontend UI changes.",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
          {
            title: "后端接口",
            description: "实现后端接口",
            task_type: "backend",
            expected_output: "Backend API changes.",
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
      title: "Task Chain",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const userMessage = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个博客系统",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个博客系统",
        sourceMessageId: userMessage.json().id,
      },
    );
    expect(orchestrated.statusCode).toBe(200);
    expect(orchestrated.json().plan.items).toHaveLength(2);
    expect(
      orchestrated.json().plan.items.every(
        (item: { taskId: string; assignmentId: string; runId: string }) =>
          Boolean(item.taskId) && Boolean(item.assignmentId) && Boolean(item.runId),
      ),
    ).toBe(true);

    const tasks = await harness.client.get(`/conversations/${conversationId}/tasks`);
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()).toHaveLength(2);
    expect(tasks.json()[0].task_type).toBe("frontend");
    expect(tasks.json()[0].expected_output).toBe("Frontend UI changes.");

    const firstTaskId = tasks.json()[0].id;
    const taskDetail = await harness.client.get(`/tasks/${firstTaskId}/detail`);
    expect(taskDetail.statusCode).toBe(200);
    expect(taskDetail.json().assignments).toHaveLength(1);
    expect(taskDetail.json().latestRun.assignment_id).toBe(
      taskDetail.json().assignments[0].id,
    );
    expect(taskDetail.json().task.task_type).toBe("frontend");
    expect(taskDetail.json().task.expected_output).toBe("Frontend UI changes.");

    const assignments = await harness.client.get(`/tasks/${firstTaskId}/assignments`);
    expect(assignments.statusCode).toBe(200);
    expect(assignments.json()).toHaveLength(1);
  });

  it("restores plan timeline items from task and assignment records", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "单任务计划",
        tasks: [
          {
            id: "t1",
            title: "实现登录页",
            description: "实现登录页",
            task_type: "frontend",
            expected_output: "A login page implementation.",
            suggested_agent: "frontend-agent",
            priority: 1,
            depends_on: [],
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("frontend-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Timeline Plan",
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

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个登录页",
        sourceMessageId: userMessage.json().id,
      },
    );
    const planItem = orchestrated.json().plan.items[0];

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const plan = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(plan).toBeTruthy();
    expect(plan.tasks).toHaveLength(1);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.plan.items[0].taskId).toBe(planItem.taskId);
    expect(plan.plan.items[0].assignmentId).toBe(planItem.assignmentId);
    expect(plan.plan.items[0].runId).toBe(planItem.runId);
    expect(plan.plan.items[0].taskType).toBe("frontend");
    expect(plan.plan.items[0].expectedOutput).toBe("A login page implementation.");
    expect(plan.plan.items[0].dependsOn).toEqual([]);
  });

  it("persists task dependencies from orchestration metadata", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "依赖计划",
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
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("backend-agent");
    harness.createAgent("frontend-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Dependency Detail",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个带依赖的任务链",
      },
    );

    const secondTaskId = orchestrated.json().plan.items[1].taskId as string;
    const taskDetail = await harness.client.get(`/tasks/${secondTaskId}/detail`);
    expect(taskDetail.statusCode).toBe(200);
    expect(taskDetail.json().task.depends_on).toEqual(["t1"]);
  });

  it("returns auto merge mode for runs that belong to an orchestrated plan", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "单任务计划",
        tasks: [
          {
            id: "t1",
            title: "实现健康检查",
            description: "实现健康检查",
            task_type: "backend",
            expected_output: "Health endpoint.",
            suggested_agent: "backend-agent",
            priority: 1,
            depends_on: [],
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("backend-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Auto Merge Summary",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      { prompt: "做一个健康检查接口" },
    );
    const runId = orchestrated.json().plan.items[0].runId as string;

    const summary = await harness.client.get(`/runs/${runId}/card-summary`);
    expect(summary.statusCode).toBe(200);
    expect(summary.json().mergeMode).toBe("auto");
    expect(summary.json().mergeStatus).toBeTruthy();
  });

  it("returns manual merge mode for standalone runs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Manual Merge Summary",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const run = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "普通独立任务",
    });

    await waitFor(async () => {
      const current = await harness.client.get(`/runs/${run.json().id}`);
      return current.json().status === "completed";
    });

    const summary = await harness.client.get(`/runs/${run.json().id}/card-summary`);
    expect(summary.statusCode).toBe(200);
    expect(summary.json().mergeMode).toBe("manual");
    expect(summary.json().mergeStatus).toBeNull();
  });

  it("updates task and assignment statuses from run completion states", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const services = harness.server.app.locals;
    const defaultAgent = services.agentsService.ensureDefaultClaudeAgent();
    const conversation = services.conversationsService.create({
      title: "Run Status Sync",
      type: "single",
    });
    services.workspacesService.bindWorkspace(conversation.id, {
      rootPath: harness.workspacePath,
    });

    const task = services.tasksService.create({
      conversationId: conversation.id,
      title: "状态同步任务",
      status: "assigned",
      priority: 1,
      createdByType: "orchestrator",
    });
    const assignment = services.assignmentsService.createAssignment({
      taskId: task.id,
      conversationId: conversation.id,
      agentId: defaultAgent.id,
      status: "pending",
      assignedByType: "orchestrator",
    });

    const makeRunManager = (status: "completed" | "failed" | "interrupted") => {
      const runtime: AgentRuntime = {
        startRun: vi.fn(async () => ({
          pid: 11,
          completion: Promise.resolve(
            status === "completed"
              ? { status, exitCode: 0 }
              : status === "failed"
                ? { status, exitCode: 1, errorMessage: "boom" }
                : { status, exitCode: null, errorMessage: "stopped" },
          ),
        })),
        interruptRun: vi.fn(async () => undefined),
      };

      return new RunManager({
        conversationsService: services.conversationsService,
        agentsService: services.agentsService,
        agentRuntimesService: services.agentRuntimesService,
        agentSessionsService: services.agentSessionsService,
        workspacesService: services.workspacesService,
        runsService: services.runsService,
        tasksService: services.tasksService,
        assignmentsService: services.assignmentsService,
        runtimeRegistry: new RuntimeRegistry({ claude_cli: runtime }),
        emitEvent: () => undefined,
      });
    };

    for (const finalStatus of ["completed", "failed", "interrupted"] as const) {
      services.tasksService.updateTaskStatus(task.id, "assigned");
      services.assignmentsService.updateAssignmentStatus(assignment.id, "pending");

      const runManager = makeRunManager(finalStatus);
      const run = runManager.createRun({
        conversationId: conversation.id,
        prompt: `status-${finalStatus}`,
        taskId: task.id,
        assignmentId: assignment.id,
      });

      await waitFor(async () => {
        const detail = services.runsService.getDetail(run.id);
        return detail?.status === finalStatus;
      });

      expect(services.tasksService.getById(task.id)?.status).toBe(finalStatus);
      expect(services.assignmentsService.getAssignment(assignment.id)?.status).toBe(finalStatus);
    }
  });

  it("returns task detail and allows cancelling eligible tasks", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const services = harness.server.app.locals;
    const conversation = services.conversationsService.create({
      title: "Task Detail",
      type: "single",
    });

    const task = services.tasksService.create({
      conversationId: conversation.id,
      title: "待取消任务",
      status: "failed",
      priority: 1,
      createdByType: "orchestrator",
    });
    const assignment = services.assignmentsService.createAssignment({
      taskId: task.id,
      conversationId: conversation.id,
      agentId: services.agentsService.ensureDefaultClaudeAgent().id,
      status: "failed",
      assignedByType: "orchestrator",
    });

    const detail = await harness.client.get(`/tasks/${task.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().id).toBe(task.id);
    expect(detail.json().assignments[0].id).toBe(assignment.id);
    expect(detail.json().latestRun).toBeNull();

    const cancelled = await harness.client.patch(`/tasks/${task.id}/status`, {
      status: "cancelled",
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().status).toBe("cancelled");
    expect(services.tasksService.getById(task.id)?.status).toBe("cancelled");
  });

  it("rejects cancelling completed and running tasks", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const services = harness.server.app.locals;
    const conversation = services.conversationsService.create({
      title: "Cancel Guards",
      type: "single",
    });

    const completedTask = services.tasksService.create({
      conversationId: conversation.id,
      title: "完成任务",
      status: "completed",
      priority: 1,
      createdByType: "orchestrator",
    });
    const runningTask = services.tasksService.create({
      conversationId: conversation.id,
      title: "运行任务",
      status: "running",
      priority: 1,
      createdByType: "orchestrator",
    });

    const completedResponse = await harness.client.patch(
      `/tasks/${completedTask.id}/status`,
      { status: "cancelled" },
    );
    expect(completedResponse.statusCode).toBe(400);

    const runningResponse = await harness.client.patch(
      `/tasks/${runningTask.id}/status`,
      { status: "cancelled" },
    );
    expect(runningResponse.statusCode).toBe(400);
  });

  it("reruns a task by creating a new linked run and updating latest_run_id", async () => {
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
      title: "Rerun Task",
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
    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个登录页",
        sourceMessageId: userMessage.json().id,
      },
    );
    const firstPlanItem = orchestrated.json().plan.items[0];

    await waitFor(async () => {
      const run = harness.server.app.locals.runsService.getDetail(firstPlanItem.runId);
      return run?.status === "completed";
    });

    const rerun = await harness.client.post(`/tasks/${firstPlanItem.taskId}/rerun`);
    expect(rerun.statusCode).toBe(200);
    expect(rerun.json().run.id).not.toBe(firstPlanItem.runId);
    expect(rerun.json().run.task_id).toBe(firstPlanItem.taskId);
    expect(rerun.json().run.assignment_id).toBe(firstPlanItem.assignmentId);
    expect(rerun.json().run.source_message_id).toBe(rerun.json().task.plan_message_id);
    expect(rerun.json().assignment.latest_run_id).toBe(rerun.json().run.id);

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const runItems = timeline
      .json()
      .filter((item: { type: string }) => item.type === "run");
    expect(runItems.some((item: { run: { id: string } }) => item.run.id === firstPlanItem.runId)).toBe(true);
    expect(runItems.some((item: { run: { id: string } }) => item.run.id === rerun.json().run.id)).toBe(true);
    const restoredPlan = timeline
      .json()
      .find((item: { type: string }) => item.type === "plan");
    expect(restoredPlan.plan.items[0].runId).toBe(rerun.json().run.id);
    expect(restoredPlan.plan.items[0].assignmentId).toBe(firstPlanItem.assignmentId);

    await waitFor(async () => {
      const run = harness.server.app.locals.runsService.getDetail(rerun.json().run.id);
      return run?.status === "completed";
    });
    expect(harness.server.app.locals.tasksService.getById(firstPlanItem.taskId)?.status).toBe(
      "completed",
    );
    expect(
      harness.server.app.locals.assignmentsService.getAssignment(firstPlanItem.assignmentId)
        ?.status,
    ).toBe("completed");
  });

  it("includes expected output in rerun runtime prompts", async () => {
    const runtime: AgentRuntime = {
      startRun: vi.fn(async () => ({
        pid: 11,
        completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
      })),
      interruptRun: vi.fn(async () => undefined),
    };
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: runtime,
        codex_cli: runtime,
      }),
      orchestratorPlanner: async () => ({
        summary: "单任务计划",
        tasks: [
          {
            title: "实现登录页",
            description: "实现登录页",
            task_type: "frontend",
            expected_output: "A tested login page implementation.",
            suggested_agent: null,
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Rerun Prompt",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个登录页",
      },
    );
    expect(orchestrated.statusCode).toBe(200);
    const firstPlanItem = orchestrated.json().plan.items[0];

    vi.mocked(runtime.startRun).mockClear();
    const rerun = await harness.client.post(`/tasks/${firstPlanItem.taskId}/rerun`);
    expect(rerun.statusCode).toBe(200);

    const runtimePrompt = vi.mocked(runtime.startRun).mock.calls[0]?.[0].prompt ?? "";
    expect(runtimePrompt).toContain("expected output: A tested login page implementation.");
    expect(runtimePrompt).toContain("实现登录页");
  });

  it("keeps cancelled task state consistent in task detail and timeline restore", async () => {
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
      title: "Cancelled Task",
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

    harness.server.app.locals.runsService.updateStatus(firstPlanItem.runId, {
      status: "failed",
      exitCode: 1,
      errorMessage: "boom",
      finishedAt: new Date().toISOString(),
    });
    harness.server.app.locals.tasksService.updateTaskStatus(firstPlanItem.taskId, "failed");
    harness.server.app.locals.assignmentsService.updateAssignmentStatus(
      firstPlanItem.assignmentId,
      "failed",
    );

    const cancelled = await harness.client.patch(`/tasks/${firstPlanItem.taskId}/status`, {
      status: "cancelled",
    });
    expect(cancelled.statusCode).toBe(200);

    const detail = await harness.client.get(`/tasks/${firstPlanItem.taskId}/detail`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().task.status).toBe("cancelled");
    expect(detail.json().assignments[0].status).toBe("cancelled");

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const plan = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(plan.plan.items[0].status).toBe("cancelled");
  });
});
