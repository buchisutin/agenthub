import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { EnvConfig } from "../../config/env.js";
import type { AgentRecord, WorkspaceExecutionStatus } from "../../shared/types.js";
import type { MessagesService } from "../messages/messages.service.js";
import type { PlannedTask } from "./dag-scheduler.js";

export interface PlannerResult {
  summary: string;
  tasks: PlannedTask[];
}

interface PlannerTaskCandidate {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  task_type?: unknown;
  expected_output?: unknown;
  affected_files?: unknown;
  suggested_agent?: unknown;
  priority?: unknown;
  depends_on?: unknown;
}

interface PlannerSession {
  conversationId: string;
  originalPrompt: string;
  originalSourceMessageId?: string;
  messages: ChatCompletionMessageParam[];
  clarificationCount: number;
  agents: AgentRecord[];
  workspacePath: string;
  workspaceStatus: WorkspaceExecutionStatus;
  lastPlanSummary: string | null;
  recentUserMessages: string[];
}

export type PlannerAgentResult =
  | { status: "done"; plan: PlannerResult }
  | { status: "pending" }
  | { status: "fallback"; plan: PlannerResult };

export interface StartSessionInput {
  conversationId: string;
  prompt: string;
  sourceMessageId?: string;
  agents: AgentRecord[];
  workspacePath: string;
  workspaceStatus: WorkspaceExecutionStatus;
  lastPlanSummary: string | null;
  recentUserMessages: string[];
}

const MAX_ITERATIONS = 5;
const MAX_CLARIFICATIONS = 2;

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user a clarification question. Batch ALL unclear points into a single call. Never call this twice.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question(s) to ask the user.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "output_plan",
      description:
        "Output the final task breakdown plan. Call this when you have enough information.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "A brief human-readable summary of the plan.",
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                task_type: {
                  type: "string",
                  enum: ["frontend", "backend", "test", "docs", "review", "deploy", "general"],
                },
                expected_output: { type: "string" },
                affected_files: { type: "array", items: { type: "string" } },
                suggested_agent: { type: ["string", "null"] },
                priority: { type: "number" },
                depends_on: { type: "array", items: { type: "string" } },
              },
              required: ["id", "title", "description", "task_type", "expected_output", "affected_files", "priority", "depends_on"],
            },
          },
        },
        required: ["summary", "tasks"],
      },
    },
  },
];

function normalizePriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  return 1;
}

function normalizeTaskType(
  value: unknown,
): "frontend" | "backend" | "test" | "docs" | "review" | "deploy" | "general" {
  if (
    value === "frontend" || value === "backend" || value === "test" ||
    value === "docs" || value === "review" || value === "deploy" || value === "general"
  ) {
    return value;
  }
  return "general";
}

function normalizeAffectedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => (typeof e === "string" ? e.trim() : ""))
    .filter((e) => e.length > 0)
    .slice(0, 12);
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((e) => (typeof e === "string" ? e.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function normalizeTaskId(value: unknown, index: number): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return `t${index + 1}`;
}

function normalizePlannerResult(
  input: unknown,
): PlannerResult | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.summary !== "string" || !Array.isArray(raw.tasks)) return null;

  const tasks = (raw.tasks as PlannerTaskCandidate[])
    .map((task, index): PlannedTask | null => {
      const title = typeof task.title === "string" ? task.title.trim() : "";
      const description = typeof task.description === "string" ? task.description.trim() : "";
      if (!title && !description) return null;
      return {
        id: normalizeTaskId(task.id, index),
        title,
        description,
        task_type: normalizeTaskType(task.task_type),
        expected_output:
          typeof task.expected_output === "string" && task.expected_output.trim()
            ? task.expected_output.trim()
            : "Complete the requested change and summarize the result.",
        affected_files: normalizeAffectedFiles(task.affected_files),
        suggested_agent:
          typeof task.suggested_agent === "string" && task.suggested_agent.trim()
            ? task.suggested_agent.trim()
            : null,
        priority: normalizePriority(task.priority),
        depends_on: normalizeDependsOn(task.depends_on),
      };
    })
    .filter((t): t is PlannedTask => t !== null)
    .slice(0, 5);

  if (tasks.length === 0) return null;

  const knownIds = new Set(tasks.map((t) => t.id));
  return {
    summary: raw.summary.trim() || "任务计划",
    tasks: tasks.map((t) => ({
      ...t,
      depends_on: t.depends_on.filter((dep) => dep !== t.id && knownIds.has(dep)),
    })),
  };
}

function fallbackPlan(prompt: string): PlannerResult {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const title = normalized.slice(0, 40) || "任务执行";
  return {
    summary: "已按单任务执行。",
    tasks: [
      {
        id: "t1",
        title,
        description: prompt,
        task_type: "general",
        expected_output: "Complete the requested change and summarize the result.",
        affected_files: [],
        suggested_agent: null,
        priority: 1,
        depends_on: [],
      },
    ],
  };
}

function buildSystemPrompt(
  agents: AgentRecord[],
  workspaceStatus: WorkspaceExecutionStatus,
  lastPlanSummary: string | null,
  recentUserMessages: string[],
): string {
  const lines = [
    "You are a planning orchestrator for a multi-agent coding workspace.",
    "Your job: understand the user's request and call output_plan with a concrete task breakdown.",
    "",
    "Rules:",
    "1. If the request is clear (tech stack, scope, goal are evident), call output_plan immediately. Do not ask questions.",
    "2. If clarification is genuinely needed, batch ALL unclear points into a single ask_user call. Never call ask_user more than once.",
    "3. For any detail the user did not specify (database, deployment, framework), make a reasonable default assumption and note it in the plan summary field. Do not block on it.",
    "4. After receiving the user's clarification reply, call output_plan directly. Do not ask again.",
    "",
    "Task decomposition rules:",
    "- Produce 1 to 5 tasks. Use 1 task for simple requests. Most requests become 2 to 4 tasks.",
    "- Each task must have a concrete deliverable. Avoid vague wording.",
    "- task title must be a short verb phrase under 20 characters.",
    "- frontend tasks produce UI/frontend code. backend tasks produce API/service changes. test tasks produce tests. docs tasks produce documentation.",
    "- Each task must include a stable short id such as t1, t2, t3.",
    "- Each task must include depends_on as an array of task ids it waits for. Use [] for no dependencies.",
    "- Use dependencies when a task cannot start until another task's deliverable exists.",
    "- Prefer parallel root tasks when deliverables touch independent files.",
    "- Never create circular dependencies.",
    "- Include affected_files as a list of repo-relative file paths or globs.",
    "",
    "Workspace status:",
    JSON.stringify({
      state: workspaceStatus.state,
      dirty_files_count: workspaceStatus.dirtyFilesCount,
      dirty_files_sample: workspaceStatus.dirtyFilesSample,
      last_commit: workspaceStatus.lastCommit,
      suggestion: workspaceStatus.suggestion,
    }),
  ];

  if (lastPlanSummary) {
    lines.push("", "Project context (last completed plan):", lastPlanSummary);
  }
  if (recentUserMessages.length > 0) {
    lines.push("", "Recent user messages (most recent last):");
    for (const msg of recentUserMessages) {
      lines.push(`- ${msg}`);
    }
  }

  lines.push(
    "",
    "Available agents:",
    JSON.stringify(
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        adapter_type: a.adapter_type,
        capabilities: a.capabilities ?? [],
        instructions: a.instructions ? a.instructions.slice(0, 200) : null,
      })),
    ),
  );

  return lines.join("\n");
}

export class PlannerAgentService {
  private readonly suspendedSessions = new Map<string, PlannerSession>();
  readonly client: OpenAI;

  constructor(
    private readonly env: Pick<EnvConfig, "plannerApiUrl" | "plannerApiKey" | "plannerModel">,
    private readonly messagesService: Pick<MessagesService, "createMessage">,
  ) {
    this.client = new OpenAI({
      baseURL: env.plannerApiUrl ?? "https://ollama.com/v1",
      apiKey: env.plannerApiKey ?? "no-key",
    });
  }

  hasSuspendedSession(conversationId: string): boolean {
    return this.suspendedSessions.has(conversationId);
  }

  clearSuspendedSessions(): void {
    this.suspendedSessions.clear();
  }

  async startSession(input: StartSessionInput): Promise<PlannerAgentResult> {
    if (!this.env.plannerApiUrl || !this.env.plannerApiKey || !this.env.plannerModel) {
      console.warn("[planner-agent] env vars not set — using fallback plan");
      return { status: "fallback", plan: fallbackPlan(input.prompt) };
    }

    const systemPrompt = buildSystemPrompt(
      input.agents,
      input.workspaceStatus,
      input.lastPlanSummary,
      input.recentUserMessages,
    );

    const session: PlannerSession = {
      conversationId: input.conversationId,
      originalPrompt: input.prompt,
      originalSourceMessageId: input.sourceMessageId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.prompt },
      ],
      clarificationCount: 0,
      agents: input.agents,
      workspacePath: input.workspacePath,
      workspaceStatus: input.workspaceStatus,
      lastPlanSummary: input.lastPlanSummary,
      recentUserMessages: input.recentUserMessages,
    };

    return this.runLoop(session);
  }

  async resumeSession(
    conversationId: string,
    userReply: string,
  ): Promise<PlannerAgentResult> {
    const session = this.suspendedSessions.get(conversationId);
    if (!session) {
      throw new Error(`No suspended planner session for conversation ${conversationId}`);
    }
    this.suspendedSessions.delete(conversationId);

    session.messages.push({ role: "user", content: userReply });
    return this.runLoop(session);
  }

  private async runLoop(session: PlannerSession): Promise<PlannerAgentResult> {
    const model = this.env.plannerModel!;
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await this.client.chat.completions.create({
          model,
          messages: session.messages,
          tools: TOOLS,
          tool_choice: "required",
        });
      } catch (error) {
        console.error("[planner-agent] API error:", error);
        return { status: "fallback", plan: fallbackPlan(session.originalPrompt) };
      }

      const choice = response.choices[0];
      if (!choice) {
        return { status: "fallback", plan: fallbackPlan(session.originalPrompt) };
      }

      const assistantMessage = choice.message;
      session.messages.push(assistantMessage as ChatCompletionMessageParam);

      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        // LLM returned plain text instead of a tool call — guide it back
        session.messages.push({
          role: "user",
          content: "请使用 output_plan 工具输出你的计划。",
        });
        continue;
      }

      const toolCall = toolCalls.find((call) => call.type === "function");
      if (!toolCall) {
        session.messages.push({
          role: "user",
          content: "请使用 output_plan 工具输出你的计划。",
        });
        continue;
      }
      const toolName = toolCall.function.name;

      if (toolName === "output_plan") {
        let args: unknown;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          return { status: "fallback", plan: fallbackPlan(session.originalPrompt) };
        }
        const plan = normalizePlannerResult(args);
        if (!plan) {
          return { status: "fallback", plan: fallbackPlan(session.originalPrompt) };
        }
        return { status: "done", plan };
      }

      if (toolName === "ask_user") {
        // Layer 2 hard intercept — block if clarification ceiling reached
        if (session.clarificationCount >= MAX_CLARIFICATIONS) {
          session.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "已达到澄清上限，请基于现有信息直接调用 output_plan 输出计划。",
          });
          continue;
        }

        // Allowed clarification — send question to user and suspend
        let args: { question?: string } = {};
        try {
          args = JSON.parse(toolCall.function.arguments) as { question?: string };
        } catch {
          args = { question: "请提供更多信息以便规划。" };
        }
        const question = args.question ?? "请提供更多信息以便规划。";

        this.messagesService.createMessage({
          conversationId: session.conversationId,
          senderType: "orchestrator",
          content: question,
          messageType: "system",
          metadata: { sourceMessageId: session.originalSourceMessageId ?? null },
        });

        session.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: "问题已发送，等待用户回复。",
        });

        session.clarificationCount++;
        this.suspendedSessions.set(session.conversationId, session);
        return { status: "pending" };
      }

      // Unknown tool — skip and guide back
      session.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: "未知工具，请使用 output_plan 输出计划。",
      });
    }

    // MAX_ITERATIONS exceeded
    console.warn(`[planner-agent] MAX_ITERATIONS (${MAX_ITERATIONS}) exceeded for conv ${session.conversationId} — using fallback`);
    return { status: "fallback", plan: fallbackPlan(session.originalPrompt) };
  }
}
