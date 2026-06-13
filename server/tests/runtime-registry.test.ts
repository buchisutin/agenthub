import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getEnvConfig } from "../src/config/env.js";
import { DatabaseClient } from "../src/db/client.js";
import { AgentRuntimesService } from "../src/modules/agent-runtimes/agent-runtimes.service.js";
import { AgentSessionsService } from "../src/modules/agent-sessions/agent-sessions.service.js";
import { AgentsService } from "../src/modules/agents/agents.service.js";
import { AssignmentsService } from "../src/modules/assignments/assignments.service.js";
import { ConversationsService } from "../src/modules/conversations/conversations.service.js";
import { RunsService } from "../src/modules/runs/runs.service.js";
import { TasksService } from "../src/modules/tasks/tasks.service.js";
import { WorkspacesService } from "../src/modules/workspaces/workspaces.service.js";
import { AgentRuntime } from "../src/runtime/base/agent-runtime.js";
import { RunManager } from "../src/runtime/manager/run-manager.js";
import { RuntimeRegistry } from "../src/runtime/runtime-registry.js";
import { waitFor } from "./helpers.js";

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

function createServices() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-runtime-registry-"));
  tempRoots.push(tempRoot);
  const workspacePath = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });

  const database = new DatabaseClient(path.join(tempRoot, "test.sqlite"));
  databases.push(database);
  const env = getEnvConfig({
    dbPath: path.join(tempRoot, "test.sqlite"),
    claudeCommand: process.execPath,
    claudeBaseArgs: [],
    claudeAllowedTools: [],
  });
  const tasksService = new TasksService(database);
  const conversationsService = new ConversationsService(database, tasksService);
  const agentsService = new AgentsService(database, env);
  const agentRuntimesService = new AgentRuntimesService(database);
  const agentSessionsService = new AgentSessionsService(database);
  const assignmentsService = new AssignmentsService(database);
  const workspacesService = new WorkspacesService(database);
  const runsService = new RunsService(database);

  const conversation = conversationsService.create({
    title: "Registry",
    type: "single",
  });
  workspacesService.bindWorkspace(conversation.id, { rootPath: workspacePath });

  return {
    workspacePath,
    conversationsService,
    agentsService,
    agentRuntimesService,
    agentSessionsService,
    tasksService,
    assignmentsService,
    workspacesService,
    runsService,
    conversation,
  };
}

describe("RuntimeRegistry wiring", () => {
  it("selects the runtime adapter registered for the agent adapter_type", async () => {
    const services = createServices();
    const claudeRuntime: AgentRuntime = {
      startRun: vi.fn(async () => ({
        pid: 11,
        completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
      })),
      interruptRun: vi.fn(async () => undefined),
    };
    const fakeRuntime: AgentRuntime = {
      startRun: vi.fn(async (input, handler) => {
        await handler.onEvent({
          type: "text_delta",
          runId: input.runId,
          conversationId: input.conversationId,
          delta: "hello from fake runtime",
        });
        return {
          pid: 22,
          completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
        };
      }),
      interruptRun: vi.fn(async () => undefined),
    };
    const runManager = new RunManager({
      conversationsService: services.conversationsService,
      agentsService: services.agentsService,
      agentRuntimesService: services.agentRuntimesService,
      agentSessionsService: services.agentSessionsService,
      tasksService: services.tasksService,
      assignmentsService: services.assignmentsService,
      workspacesService: services.workspacesService,
      runsService: services.runsService,
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: claudeRuntime,
        fake_adapter: fakeRuntime,
      }),
      emitEvent: () => undefined,
    });

    const fakeAgent = services.agentsService.create({
      name: "fake-agent",
      platform: "fake-runtime",
      adapter_type: "fake_adapter",
      capabilities: ["text_generation"],
    });

    const run = runManager.createRun({
      conversationId: services.conversation.id,
      agentId: fakeAgent.id,
      prompt: "use the fake adapter",
    });

    await waitFor(async () => {
      const detail = services.runsService.getDetail(run.id);
      return detail?.status === "completed";
    });

    expect(fakeRuntime.startRun).toHaveBeenCalledTimes(1);
    expect(claudeRuntime.startRun).not.toHaveBeenCalled();
  });

  it("builds runtime prompts with agent identity, capabilities, instructions, and task context", async () => {
    const services = createServices();
    const fakeRuntime: AgentRuntime = {
      startRun: vi.fn(async () => ({
        pid: 22,
        completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
      })),
      interruptRun: vi.fn(async () => undefined),
    };
    const runManager = new RunManager({
      conversationsService: services.conversationsService,
      agentsService: services.agentsService,
      agentRuntimesService: services.agentRuntimesService,
      agentSessionsService: services.agentSessionsService,
      tasksService: services.tasksService,
      assignmentsService: services.assignmentsService,
      workspacesService: services.workspacesService,
      runsService: services.runsService,
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: fakeRuntime,
      }),
      emitEvent: () => undefined,
    });

    const agent = services.agentsService.createAgent({
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
      instructions: "Focus on React UI implementation only.",
      capabilities: ["frontend", "react", "ui"],
      enabled: true,
    });
    const task = services.tasksService.create({
      conversationId: services.conversation.id,
      title: "Build login screen",
      description: "Implement the login page UI.",
      taskType: "frontend",
      expectedOutput: "React login screen and related UI updates.",
      status: "assigned",
      priority: 1,
      createdByType: "orchestrator",
    });

    runManager.createRun({
      conversationId: services.conversation.id,
      agentId: agent.id,
      prompt: "Build the login screen",
      taskId: task.id,
    });

    await waitFor(async () => {
      const [firstCall] = vi.mocked(fakeRuntime.startRun).mock.calls;
      return Boolean(firstCall);
    });

    const runtimePrompt = vi.mocked(fakeRuntime.startRun).mock.calls[0]?.[0].prompt ?? "";
    expect(runtimePrompt).toContain("frontend-agent (@frontend-agent)");
    expect(runtimePrompt).toContain("Focus on React UI implementation only.");
    expect(runtimePrompt).toContain("- frontend");
    expect(runtimePrompt).toContain("- react");
    expect(runtimePrompt).toContain("Build login screen");
    expect(runtimePrompt).toContain("React login screen and related UI updates.");
    expect(runtimePrompt).toContain("User request:");
    expect(runtimePrompt).toContain("Build the login screen");
  });

  it("emits run_status_changed with full payload and keeps terminal run events", async () => {
    const services = createServices();
    const emitted: Array<Record<string, unknown>> = [];
    const fakeRuntime: AgentRuntime = {
      startRun: vi.fn(async (input, handler) => {
        await handler.onEvent({
          type: "text_delta",
          runId: input.runId,
          conversationId: input.conversationId,
          delta: "hello from fake runtime",
        });
        return {
          pid: 22,
          completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
        };
      }),
      interruptRun: vi.fn(async () => undefined),
    };
    const runManager = new RunManager({
      conversationsService: services.conversationsService,
      agentsService: services.agentsService,
      agentRuntimesService: services.agentRuntimesService,
      agentSessionsService: services.agentSessionsService,
      tasksService: services.tasksService,
      assignmentsService: services.assignmentsService,
      workspacesService: services.workspacesService,
      runsService: services.runsService,
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: fakeRuntime,
      }),
      emitEvent: (event) => emitted.push(event as unknown as Record<string, unknown>),
    });
    const defaultAgent = services.agentsService.ensureDefaultClaudeAgent();

    const run = runManager.createRun({
      conversationId: services.conversation.id,
      prompt: "emit status events",
    });

    await waitFor(async () => {
      const detail = services.runsService.getDetail(run.id);
      return detail?.status === "completed";
    });

    const statusChanged = emitted.find(
      (event) =>
        event.type === "run_status_changed" &&
        event.runId === run.id &&
        event.status === "completed",
    );
    expect(statusChanged).toMatchObject({
      type: "run_status_changed",
      runId: run.id,
      conversationId: services.conversation.id,
      agentId: defaultAgent.id,
      taskId: services.conversation.task_id,
      status: "completed",
    });
    expect(
      emitted.some(
        (event) => event.type === "run_completed" && event.runId === run.id,
      ),
    ).toBe(true);
  });

  it("fails clearly when no runtime adapter is registered for the agent", () => {
    const services = createServices();
    const runManager = new RunManager({
      conversationsService: services.conversationsService,
      agentsService: services.agentsService,
      agentRuntimesService: services.agentRuntimesService,
      agentSessionsService: services.agentSessionsService,
      tasksService: services.tasksService,
      assignmentsService: services.assignmentsService,
      workspacesService: services.workspacesService,
      runsService: services.runsService,
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: {
          startRun: vi.fn(async () => ({
            pid: 11,
            completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
          })),
          interruptRun: vi.fn(async () => undefined),
        },
      }),
      emitEvent: () => undefined,
    });

    const missingAdapterAgent = services.agentsService.create({
      name: "missing-runtime-agent",
      platform: "missing-runtime",
      adapter_type: "missing_adapter",
      capabilities: ["text_generation"],
    });

    expect(() =>
      runManager.createRun({
        conversationId: services.conversation.id,
        agentId: missingAdapterAgent.id,
        prompt: "this should fail",
      }),
    ).toThrow("Runtime adapter not registered: missing_adapter");
  });

  it("returns unavailable instead of throwing when adapter checks fail", async () => {
    const registry = new RuntimeRegistry({
      claude_cli: {
        startRun: vi.fn(async () => ({
          pid: 1,
          completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
        })),
        interruptRun: vi.fn(async () => undefined),
        checkAvailability() {
          throw new Error("lookup failed");
        },
      },
    });

    await expect(registry.checkAdapter("claude_cli")).resolves.toMatchObject({
      adapterType: "claude_cli",
      available: false,
      message: "lookup failed",
    });
  });
});
