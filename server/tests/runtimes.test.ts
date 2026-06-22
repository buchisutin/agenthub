import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime } from "../src/runtime/base/agent-runtime.js";
import { RuntimeRegistry } from "../src/runtime/runtime-registry.js";
import { createTestHarness } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

function makeRuntime(input: {
  available: boolean;
  message?: string;
  displayName: string;
  capabilities?: string[];
}): AgentRuntime {
  return {
    displayName: input.displayName,
    capabilities: input.capabilities ?? [],
    async startRun() {
      return {
        pid: 42,
        completion: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
      };
    },
    async interruptRun() {
      return undefined;
    },
    checkAvailability() {
      return {
        adapterType: "mock",
        available: input.available,
        message: input.message,
        executablePath: input.available ? "/usr/bin/mock" : null,
        version: input.available ? "1.0.0" : null,
      };
    },
  };
}

describe("runtime visibility", () => {
  it("lists registered adapters and returns runtime checks", async () => {
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: makeRuntime({
          displayName: "Claude Code",
          available: true,
          capabilities: ["planning"],
        }),
        codex_cli: makeRuntime({
          displayName: "Codex CLI",
          available: true,
          capabilities: ["planning"],
        }),
        fake_adapter: makeRuntime({
          displayName: "Fake Adapter",
          available: false,
          message: "fake runtime unavailable",
          capabilities: ["test"],
        }),
      }),
    });
    harnesses.push(harness);

    const runtimes = await harness.client.get("/runtimes");
    expect(runtimes.statusCode).toBe(200);
    expect(runtimes.json()).toEqual([
      expect.objectContaining({
        adapterType: "claude_cli",
        displayName: "Claude Code",
        registered: true,
      }),
      expect.objectContaining({
        adapterType: "codex_cli",
        displayName: "Codex CLI",
        registered: true,
      }),
      expect.objectContaining({
        adapterType: "fake_adapter",
        displayName: "Fake Adapter",
        registered: true,
      }),
    ]);

    const claudeCheck = await harness.client.get("/runtimes/claude_cli/check");
    expect(claudeCheck.statusCode).toBe(200);
    expect(claudeCheck.json()).toMatchObject({
      adapterType: "claude_cli",
      available: true,
    });

    const allChecks = await harness.client.get("/runtimes/check");
    expect(allChecks.statusCode).toBe(200);
    expect(allChecks.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adapterType: "claude_cli", available: true }),
        expect.objectContaining({ adapterType: "fake_adapter", available: false }),
      ]),
    );
  });

  it("returns 404 for unknown runtime checks", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.get("/runtimes/missing_adapter/check");
    expect(response.statusCode).toBe(404);
  });

  it("rejects run creation when the runtime adapter is unavailable", async () => {
    const harness = await createTestHarness({
      runtimeRegistry: new RuntimeRegistry({
        claude_cli: makeRuntime({
          displayName: "Claude Code",
          available: true,
        }),
        codex_cli: makeRuntime({
          displayName: "Codex CLI",
          available: true,
        }),
        fake_adapter: makeRuntime({
          displayName: "Fake Adapter",
          available: false,
          message: "fake runtime unavailable",
        }),
      }),
    });
    harnesses.push(harness);

    const unavailableAgent = harness.createAgent("offline-agent", {
      adapterType: "fake_adapter",
    });
    const conversation = await harness.client.post("/conversations", {
      title: "Runtime unavailable",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "do work",
      agentId: unavailableAgent,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toContain("Runtime adapter unavailable");
  });

  it("keeps unavailable runtime agents out of orchestrator planning", async () => {
    const harness = await createTestHarness(
      {
        runtimeRegistry: new RuntimeRegistry({
          claude_cli: makeRuntime({
            displayName: "Claude Code",
            available: true,
          }),
          codex_cli: makeRuntime({
            displayName: "Codex CLI",
            available: true,
          }),
          fake_adapter: makeRuntime({
            displayName: "Fake Adapter",
            available: false,
            message: "fake runtime unavailable",
          }),
        }),
        orchestratorPlanner: async ({ agents }) => {
          expect(agents.some((agent) => agent.slug === "offline-agent")).toBe(false);
          return {
            summary: "只分配可运行 Agent",
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
      },
    );
    harnesses.push(harness);

    harness.createAgent("frontend-agent");
    harness.createAgent("offline-agent", { adapterType: "fake_adapter" });

    const conversation = await harness.client.post("/conversations", {
      title: "Orchestrator runtimes",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做前端",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plan.items[0].assignedAgentName).toBe("frontend-agent");
  });
});
