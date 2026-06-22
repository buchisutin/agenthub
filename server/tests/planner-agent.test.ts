import { describe, it, expect, vi } from "vitest";
import { PlannerAgentService } from "../src/modules/orchestrator/planner-agent.service.js";

// Minimal MessagesService mock
function makeMessagesService() {
  return {
    createMessage: vi.fn().mockReturnValue({ id: "msg-1" }),
  } as any;
}

// Minimal env with planner vars set
const testEnv = {
  plannerApiUrl: "https://test.example.com/v1",
  plannerApiKey: "test-key",
  plannerModel: "test-model",
} as any;

const baseInput = {
  conversationId: "conv-1",
  prompt: "Build a todo app",
  agents: [
    {
      id: "agent-1",
      name: "Claude",
      slug: "claude",
      adapter_type: "claude_cli",
      capabilities: ["frontend", "backend"],
      instructions: null,
    } as any,
  ],
  workspacePath: "/tmp/test",
  workspaceStatus: {
    state: "clean" as const,
    gitRoot: null,
    dirtyFilesCount: 0,
    dirtyFilesSample: [],
    lastCommit: null,
    suggestion: "",
  },
  lastPlanSummary: null,
  recentUserMessages: [],
};

const validPlan = {
  summary: "Build a todo app",
  tasks: [
    {
      id: "t1",
      title: "Create UI",
      description: "Build the frontend",
      task_type: "frontend",
      expected_output: "A working UI",
      affected_files: ["src/App.tsx"],
      suggested_agent: null,
      priority: 1,
      depends_on: [],
    },
  ],
};

describe("PlannerAgentService", () => {
  it("hasSuspendedSession returns false initially", () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    expect(svc.hasSuspendedSession("conv-1")).toBe(false);
  });

  it("clearSuspendedSessions removes all sessions", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    // Manually inject a session to clear
    (svc as any).suspendedSessions.set("conv-1", { conversationId: "conv-1" });
    svc.clearSuspendedSessions();
    expect(svc.hasSuspendedSession("conv-1")).toBe(false);
  });

  it("startSession returns done when LLM calls output_plan immediately", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    // Stub the OpenAI client to return output_plan on first call
    (svc as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "output_plan",
                        arguments: JSON.stringify(validPlan),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        },
      },
    };

    const result = await svc.startSession(baseInput);
    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.plan.summary).toBe("Build a todo app");
      expect(result.plan.tasks).toHaveLength(1);
    }
  });

  it("startSession suspends and returns pending when LLM calls ask_user", async () => {
    const messagesService = makeMessagesService();
    const svc = new PlannerAgentService(testEnv, messagesService);
    let callCount = 0;
    (svc as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [
                      {
                        id: `call-${callCount}`,
                        type: "function",
                        function: {
                          name: "ask_user",
                          arguments: JSON.stringify({ question: "What framework?" }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            });
          }),
        },
      },
    };

    const result = await svc.startSession(baseInput);
    expect(result.status).toBe("pending");
    expect(svc.hasSuspendedSession("conv-1")).toBe(true);
    expect(messagesService.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "What framework?",
        messageType: "system",
      }),
    );
  });

  it("resumeSession calls LLM with user reply and returns done", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    // Manually inject a suspended session
    const suspendedSession = {
      conversationId: "conv-1",
      originalPrompt: "Build a todo app",
      messages: [
        { role: "user", content: "Build a todo app" },
        {
          role: "assistant",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "ask_user", arguments: '{"question":"What framework?"}' } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "问题已发送，等待用户回复。" },
      ] as any[],
      clarificationCount: 1,
      agents: baseInput.agents,
      workspacePath: baseInput.workspacePath,
      workspaceStatus: baseInput.workspaceStatus,
      lastPlanSummary: null,
      recentUserMessages: [],
    };
    (svc as any).suspendedSessions.set("conv-1", suspendedSession);

    (svc as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call-2",
                      type: "function",
                      function: {
                        name: "output_plan",
                        arguments: JSON.stringify(validPlan),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        },
      },
    };

    const result = await svc.resumeSession("conv-1", "Use React");
    expect(result.status).toBe("done");
    expect(svc.hasSuspendedSession("conv-1")).toBe(false);
  });

  it("two-layer guard: ask_user at clarificationCount >= 2 injects override instead of suspending", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    // Session already has clarificationCount = 2
    const suspendedSession = {
      conversationId: "conv-1",
      originalPrompt: "Build a todo app",
      messages: [{ role: "user", content: "Use React" }] as any[],
      clarificationCount: 2,
      agents: baseInput.agents,
      workspacePath: baseInput.workspacePath,
      workspaceStatus: baseInput.workspaceStatus,
      lastPlanSummary: null,
      recentUserMessages: [],
    };
    (svc as any).suspendedSessions.set("conv-1", suspendedSession);

    let secondCallArgs: any;
    let callCount = 0;
    (svc as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((args: any) => {
            callCount++;
            if (callCount === 1) {
              // First call: LLM tries to ask again
              return Promise.resolve({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      tool_calls: [{ id: "call-x", type: "function", function: { name: "ask_user", arguments: '{"question":"One more question?"}' } }],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              });
            }
            // Second call: after override injection, LLM calls output_plan
            secondCallArgs = args;
            return Promise.resolve({
              choices: [
                {
                  message: {
                    role: "assistant",
                    tool_calls: [{ id: "call-y", type: "function", function: { name: "output_plan", arguments: JSON.stringify(validPlan) } }],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            });
          }),
        },
      },
    };

    const result = await svc.resumeSession("conv-1", "Use React please");
    // Must NOT suspend again
    expect(result.status).not.toBe("pending");
    expect(result.status).toBe("done");
    // Must have injected the override tool response into messages
    const messages = secondCallArgs?.messages ?? [];
    const overrideMsg = messages.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "call-x",
    );
    expect(overrideMsg?.content).toContain("澄清上限");
  });

  it("returns fallback plan after MAX_ITERATIONS with no output_plan", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    (svc as any).client = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  role: "assistant",
                  // No tool calls — triggers the "请使用 output_plan" injection path
                  content: "Let me think...",
                },
                finish_reason: "stop",
              },
            ],
          }),
        },
      },
    };

    const result = await svc.startSession(baseInput);
    expect(result.status).toBe("fallback");
    if (result.status === "fallback") {
      expect(result.plan.tasks).toHaveLength(1);
      expect(result.plan.tasks[0].description).toBe(baseInput.prompt);
    }
  });

  it("resumeSession throws if no suspended session exists", async () => {
    const svc = new PlannerAgentService(testEnv, makeMessagesService());
    await expect(svc.resumeSession("no-such-conv", "hello")).rejects.toThrow(
      "No suspended planner session",
    );
  });
});
