import { AgentRuntime } from "../base/agent-runtime.js";
import { ProcessRegistry } from "./process-registry.js";
import { AgentsService } from "../../modules/agents/agents.service.js";
import { AssignmentsService } from "../../modules/assignments/assignments.service.js";
import { AgentRuntimesService } from "../../modules/agent-runtimes/agent-runtimes.service.js";
import { AgentSessionsService } from "../../modules/agent-sessions/agent-sessions.service.js";
import { ConversationsService } from "../../modules/conversations/conversations.service.js";
import { RunsService } from "../../modules/runs/runs.service.js";
import { TasksService } from "../../modules/tasks/tasks.service.js";
import { WorkspacesService } from "../../modules/workspaces/workspaces.service.js";
import { WorkspaceIsolationService } from "../../modules/workspaces/workspace-isolation.service.js";
import {
  AgentRecord,
  ConversationRecord,
  RunDetail,
  RunStatus,
  TaskRecord,
  RuntimeBaseEvent,
  RuntimeEvent,
} from "../../shared/types.js";
import { RuntimeRegistry } from "../runtime-registry.js";

interface RunManagerDependencies {
  conversationsService: ConversationsService;
  agentsService: AgentsService;
  agentRuntimesService: AgentRuntimesService;
  agentSessionsService: AgentSessionsService;
  workspacesService: WorkspacesService;
  workspaceIsolationService?: WorkspaceIsolationService;
  runsService: RunsService;
  tasksService: TasksService;
  assignmentsService: AssignmentsService;
  runtimeRegistry: RuntimeRegistry;
  emitEvent: (event: RuntimeEvent) => void;
}

function buildAgentRunPrompt(input: {
  userPrompt: string;
  agent: AgentRecord;
  task: TaskRecord | null;
  conversation: ConversationRecord;
  workspacePath: string;
}): string {
  const capabilities =
    input.agent.capabilities && input.agent.capabilities.length > 0
      ? input.agent.capabilities.map((capability) => `- ${capability}`).join("\n")
      : "- No specific capabilities provided.";
  const instructions = input.agent.instructions?.trim() || "No additional instructions.";
  const taskContext = input.task
    ? [
        input.conversation.title ? `- conversation: ${input.conversation.title}` : null,
        `- title: ${input.task.title}`,
        `- description: ${input.task.description?.trim() || input.task.title}`,
        input.task.expected_output
          ? `- expected output: ${input.task.expected_output}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "- No linked task.";

  return [
    `You are running as AgentHub agent: ${input.agent.name} (@${input.agent.slug}).`,
    "",
    "Agent capabilities:",
    capabilities,
    "",
    "Agent instructions:",
    instructions,
    "",
    "Task context:",
    taskContext,
    "",
    "Execution rules:",
    `- Work only inside the provided workspace: ${input.workspacePath}`,
    "- Do not inspect or modify .agenthub internals unless the task explicitly requires it.",
    "- Prefer using Write/Edit tools to create or update files directly.",
    "- Avoid using python -c, python3 -c, or Bash heredocs to write file content unless the task explicitly requires that approach.",
    "- Make concrete code changes when the task requires implementation.",
    "- Prefer small, focused changes.",
    "- Do not claim completion unless files were actually modified or verified.",
    "- If blocked, explain the blocker clearly.",
    "- Keep final summary concise.",
    "",
    "User request:",
    input.userPrompt,
  ].join("\n");
}

export class RunManager {
  private readonly registry = new ProcessRegistry();
  private readonly textBuffers = new Map<string, string>();
  private readonly bootstrapTasks = new Map<string, Promise<void>>();

  constructor(private readonly deps: RunManagerDependencies) {}

  createRun(input: {
    conversationId: string;
    agentId?: string;
    prompt: string;
    sourceMessageId?: string;
    taskId?: string | null;
    assignmentId?: string | null;
  }): RunDetail {
    const conversation = this.deps.conversationsService.getById(input.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const workspace = this.deps.workspacesService.getByConversationId(
      input.conversationId,
    );
    if (!workspace) {
      throw new Error("Workspace not bound");
    }

    const agent = input.agentId
      ? this.deps.agentsService.getAgent(input.agentId)
      : this.deps.agentsService.getDefaultAgent();
    if (!agent) {
      throw new Error(input.agentId ? "Agent not found" : "Default agent not found");
    }
    if (!agent.enabled) {
      throw new Error("Agent is disabled");
    }
    if (!this.deps.runtimeRegistry.hasAdapter(agent.adapter_type)) {
      throw new Error(`Runtime adapter not registered: ${agent.adapter_type}`);
    }
    const runtimeCheck = this.deps.runtimeRegistry.checkAdapterSync(agent.adapter_type);
    if (!runtimeCheck.available) {
      throw new Error(
        `Runtime adapter unavailable: ${agent.adapter_type}${
          runtimeCheck.message ? ` (${runtimeCheck.message})` : ""
        }`,
      );
    }

    const runtimeRecord = this.deps.agentRuntimesService.ensureLocalRuntime(
      agent.id,
      agent.platform,
    );
    const runtime = this.deps.runtimeRegistry.getAdapter(agent.adapter_type);
    const existingSession =
      this.deps.agentSessionsService.getLatestByConversationAgent(
        input.conversationId,
        agent.id,
      );
    const session =
      existingSession &&
      existingSession.status !== "invalid" &&
      existingSession.status !== "closed"
        ? existingSession
        :
      this.deps.agentSessionsService.createPlaceholder({
        taskId: conversation.task_id,
        conversationId: input.conversationId,
        agentId: agent.id,
        runtimeId: runtimeRecord.id,
      });

    const run = this.deps.runsService.create({
      conversationId: input.conversationId,
      taskId: input.taskId ?? conversation.task_id,
      assignmentId: input.assignmentId ?? null,
      agentId: agent.id,
      runtimeId: runtimeRecord.id,
      agentSessionId: session.id,
      sourceMessageId: input.sourceMessageId,
      workspaceId: workspace.id,
      prompt: input.prompt,
    });
    this.textBuffers.set(run.id, "");

    const taskId = input.taskId ?? conversation.task_id;
    const task = taskId ? this.deps.tasksService.getById(taskId) : null;
    const bootstrapTask = this.createRunWorkspaceAndBootstrap(run.id, workspace.id, workspace.root_path, {
      conversationId: input.conversationId,
      prompt: input.prompt,
      resumeSessionId:
        session.status === "active" ? session.provider_session_id : null,
      sessionRecordId: session.id,
      agentId: agent.id,
      taskId,
      assignmentId: input.assignmentId ?? null,
      agentConfig: agent.config_json,
      runtime,
      agent,
      task,
      conversation,
    });
    this.bootstrapTasks.set(run.id, bootstrapTask);
    void bootstrapTask.finally(() => this.bootstrapTasks.delete(run.id));

    return this.deps.runsService.getDetail(run.id)!;
  }

  listRuns(conversationId: string) {
    return this.deps.runsService.listByConversationId(conversationId);
  }

  getRun(runId: string) {
    return this.deps.runsService.getDetail(runId);
  }

  getFileChanges(runId: string) {
    return this.deps.runsService.getFileChanges(runId);
  }

  getRunWorkspace(runId: string) {
    return this.deps.runsService.getRunWorkspace(runId);
  }

  private emitRunStatusChanged(input: {
    runId: string;
    conversationId: string;
    agentId: string;
    taskId: string | null;
    assignmentId: string | null;
    status: RunStatus;
  }) {
    this.deps.emitEvent({
      type: "run_status_changed",
      runId: input.runId,
      conversationId: input.conversationId,
      agentId: input.agentId,
      taskId: input.taskId,
      assignmentId: input.assignmentId,
      status: input.status,
    });
  }

  private syncTaskAndAssignmentStatus(
    taskId: string | null,
    assignmentId: string | null,
    runId: string,
    status: "running" | "completed" | "failed" | "interrupted",
  ) {
    if (assignmentId) {
      this.deps.assignmentsService.updateAssignmentStatus(
        assignmentId,
        status,
        runId,
      );
    }
    if (taskId) {
      this.deps.tasksService.updateTaskStatus(taskId, status);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.bootstrapTasks.values());
    await Promise.allSettled(
      this.registry.values().map((handle) => handle.completion),
    );
  }

  async stopConversationRuns(conversationId: string): Promise<void> {
    const activeRuns = this.deps.runsService
      .listByConversationId(conversationId)
      .filter((run) => run.status === "queued" || run.status === "running");

    await Promise.allSettled(activeRuns.map(async (run) => {
      const bootstrapTask = this.bootstrapTasks.get(run.id);
      if (bootstrapTask) await bootstrapTask;

      const current = this.deps.runsService.getById(run.id);
      if (current?.status === "queued" || current?.status === "running") {
        try {
          await this.interruptRun(run.id);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "Run is not active") throw error;
        }
      }

      const handle = this.registry.get(run.id);
      if (handle) await handle.completion;
    }));
  }

  async interruptRun(runId: string): Promise<RunDetail> {
    const run = this.deps.runsService.getById(runId);
    if (!run) {
      throw new Error("Run not found");
    }
    if (run.status !== "running" && run.status !== "queued") {
      throw new Error("Run is not interruptible");
    }
    const agent = this.deps.agentsService.getById(run.agent_id);
    if (!agent) {
      throw new Error("Agent not found");
    }
    const runtime = this.deps.runtimeRegistry.getAdapter(agent.adapter_type);
    await runtime.interruptRun(runId);
    return this.deps.runsService.getDetail(runId)!;
  }

  private async createRunWorkspaceAndBootstrap(
    runId: string,
    baseWorkspaceId: string,
    baseRootPath: string,
    bootstrapInput: {
      conversationId: string;
      prompt: string;
      resumeSessionId: string | null;
      sessionRecordId: string;
      agentId: string;
      taskId: string | null;
      assignmentId: string | null;
      agentConfig: Record<string, unknown> | null;
      runtime: AgentRuntime;
      agent: AgentRecord;
      task: TaskRecord | null;
      conversation: ConversationRecord;
    },
  ) {
    let workspacePath = baseRootPath;

    try {
      if (!this.deps.workspaceIsolationService) {
        await this.bootstrapRun(runId, { ...bootstrapInput, workspacePath });
        return;
      }
      const runWorkspace = await this.deps.workspaceIsolationService.createForRun({
        runId,
        conversationId: bootstrapInput.conversationId,
        baseWorkspaceId,
        baseRootPath,
        agentId: bootstrapInput.agentId,
        taskId: bootstrapInput.taskId,
      });

      if (runWorkspace.status === "failed") {
        this.textBuffers.delete(runId);
        this.deps.runsService.updateStatus(runId, {
          status: "failed",
          errorMessage: runWorkspace.error_message ?? "Failed to create run workspace",
          finishedAt: new Date().toISOString(),
        });
        this.emitRunStatusChanged({
          runId,
          conversationId: bootstrapInput.conversationId,
          agentId: bootstrapInput.agentId,
          taskId: bootstrapInput.taskId,
          assignmentId: bootstrapInput.assignmentId,
          status: "failed",
        });
        this.syncTaskAndAssignmentStatus(bootstrapInput.taskId, bootstrapInput.assignmentId, runId, "failed");
        return;
      }

      workspacePath = runWorkspace.root_path;
    } catch (err) {
      // If workspace isolation throws unexpectedly, fall back to base path
      // rather than failing the run, to maintain backward compatibility
      workspacePath = baseRootPath;
    }

    await this.bootstrapRun(runId, { ...bootstrapInput, workspacePath });
  }

  private async bootstrapRun(
    runId: string,
    input: {
      conversationId: string;
      prompt: string;
      workspacePath: string;
      resumeSessionId: string | null;
      allowResumeRecovery?: boolean;
      sessionRecordId: string;
      agentId: string;
      taskId: string | null;
      assignmentId: string | null;
      agentConfig: Record<string, unknown> | null;
      runtime: AgentRuntime;
      agent: AgentRecord;
      task: TaskRecord | null;
      conversation: ConversationRecord;
    },
  ) {
    try {
      const runtimePrompt = buildAgentRunPrompt({
        userPrompt: input.prompt,
        agent: input.agent,
        task: input.task,
        conversation: input.conversation,
        workspacePath: input.workspacePath,
      });
      const handle = await input.runtime.startRun(
        {
          runId,
          conversationId: input.conversationId,
          prompt: runtimePrompt,
          workspacePath: input.workspacePath,
          resumeSessionId: input.resumeSessionId,
          agentConfig: input.agentConfig,
        },
        {
          onEvent: async (event) => {
            if (event.type === "session_bound") {
              this.deps.agentSessionsService.bindProviderSession(
                input.sessionRecordId,
                event.sessionId,
              );
            }
            event = {
              ...event,
              agentId: input.agentId,
              taskId: input.taskId,
              assignmentId: input.assignmentId,
            };
            if (event.type === "text_delta") {
              const normalized = this.normalizeTextDelta(runId, event.delta);
              if (!normalized) {
                return;
              }
              event = { ...event, delta: normalized };
            }
            const seq = this.deps.runsService.nextEventSeq(runId);
            const persisted = this.deps.runsService.appendEvent(
              runId,
              input.conversationId,
              seq,
              event,
            );
            this.deps.emitEvent({
              ...event,
              eventId: persisted.event_id,
              occurredAt: persisted.occurred_at,
              seq: persisted.seq,
            } as RuntimeEvent);
          },
        },
      );

      this.registry.set(runId, handle);
      this.deps.runsService.updateStatus(runId, {
        status: "running",
        pid: handle.pid ?? null,
      });
      this.emitRunStatusChanged({
        runId,
        conversationId: input.conversationId,
        agentId: input.agentId,
        taskId: input.taskId,
        assignmentId: input.assignmentId,
        status: "running",
      });
      this.syncTaskAndAssignmentStatus(
        input.taskId,
        input.assignmentId,
        runId,
        "running",
      );
      this.deps.conversationsService.touch(input.conversationId);

      handle.completion
        .then((completion) => {
          this.registry.delete(runId);
          const finalText = this.textBuffers.get(runId) ?? "";

          if (
            completion.status === "failed" &&
            input.resumeSessionId &&
            input.allowResumeRecovery !== false &&
            this.isMissingResumeSessionError(completion.errorMessage)
          ) {
            this.deps.agentSessionsService.markStatus(
              input.sessionRecordId,
              "invalid",
              completion.errorMessage ?? "Claude session is invalid",
            );
            void this.bootstrapRun(runId, {
              ...input,
              resumeSessionId: null,
              allowResumeRecovery: false,
            });
            return;
          }

          this.textBuffers.delete(runId);

          if (completion.status === "completed") {
            const event: RuntimeEvent = {
              type: "run_completed",
              runId,
              conversationId: input.conversationId,
              agentId: input.agentId,
              taskId: input.taskId,
              assignmentId: input.assignmentId,
              finalText,
              exitCode: completion.exitCode ?? 0,
            };
            const seq = this.deps.runsService.nextEventSeq(runId);
            const persisted = this.deps.runsService.appendEvent(
              runId,
              input.conversationId,
              seq,
              event,
            );
            this.deps.runsService.updateStatus(runId, {
              status: "completed",
              exitCode: completion.exitCode ?? 0,
              finishedAt: new Date().toISOString(),
            });
            this.emitRunStatusChanged({
              runId,
              conversationId: input.conversationId,
              agentId: input.agentId,
              taskId: input.taskId,
              assignmentId: input.assignmentId,
              status: "completed",
            });
            this.syncTaskAndAssignmentStatus(
              input.taskId,
              input.assignmentId,
              runId,
              "completed",
            );
            this.deps.emitEvent(this.withEventMeta(event, persisted));
            return;
          }

          if (completion.status === "interrupted") {
            this.deps.agentSessionsService.markStatus(
              input.sessionRecordId,
              "interrupted",
            );
            const event: RuntimeEvent = {
              type: "run_interrupted",
              runId,
              conversationId: input.conversationId,
              agentId: input.agentId,
              taskId: input.taskId,
              assignmentId: input.assignmentId,
              reason: "Run interrupted by user",
            };
            const seq = this.deps.runsService.nextEventSeq(runId);
            const persisted = this.deps.runsService.appendEvent(
              runId,
              input.conversationId,
              seq,
              event,
            );
            this.deps.runsService.updateStatus(runId, {
              status: "interrupted",
              exitCode: completion.exitCode ?? null,
              finishedAt: new Date().toISOString(),
            });
            this.emitRunStatusChanged({
              runId,
              conversationId: input.conversationId,
              agentId: input.agentId,
              taskId: input.taskId,
              assignmentId: input.assignmentId,
              status: "interrupted",
            });
            this.syncTaskAndAssignmentStatus(
              input.taskId,
              input.assignmentId,
              runId,
              "interrupted",
            );
            this.deps.emitEvent(this.withEventMeta(event, persisted));
            return;
          }

          const event: RuntimeEvent = {
            type: "run_failed",
            runId,
            conversationId: input.conversationId,
            agentId: input.agentId,
            taskId: input.taskId,
            assignmentId: input.assignmentId,
            error: this.normalizeRuntimeFailure(completion.errorMessage),
          };
          if (this.isMissingResumeSessionError(completion.errorMessage)) {
            this.deps.agentSessionsService.markStatus(
              input.sessionRecordId,
              "invalid",
              completion.errorMessage ?? "Claude session is invalid",
            );
          }
          const seq = this.deps.runsService.nextEventSeq(runId);
          const persisted = this.deps.runsService.appendEvent(
            runId,
            input.conversationId,
            seq,
            event,
          );
          this.deps.runsService.updateStatus(runId, {
            status: "failed",
            exitCode: completion.exitCode ?? null,
            errorMessage: this.normalizeRuntimeFailure(completion.errorMessage),
            finishedAt: new Date().toISOString(),
          });
          this.emitRunStatusChanged({
            runId,
            conversationId: input.conversationId,
            agentId: input.agentId,
            taskId: input.taskId,
            assignmentId: input.assignmentId,
            status: "failed",
          });
          this.syncTaskAndAssignmentStatus(
            input.taskId,
            input.assignmentId,
            runId,
            "failed",
          );
          this.deps.emitEvent(this.withEventMeta(event, persisted));
        })
        .catch((error) => {
          this.registry.delete(runId);
          this.textBuffers.delete(runId);
          this.deps.runsService.updateStatus(runId, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown runtime error",
            finishedAt: new Date().toISOString(),
          });
        });
    } catch (error) {
      this.textBuffers.delete(runId);
      this.deps.runsService.updateStatus(runId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Failed to start run",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private normalizeTextDelta(runId: string, incoming: string): string | null {
    const current = this.textBuffers.get(runId) ?? "";
    if (!incoming) {
      return null;
    }

    const normalizedIncoming = incoming.replace(/\r\n/g, "\n");
    const normalizedCurrent = current.replace(/\r\n/g, "\n");
    const trimmedIncoming = normalizedIncoming.trim();
    const trimmedCurrent = normalizedCurrent.trim();

    if (normalizedIncoming === normalizedCurrent) {
      return null;
    }

    if (trimmedIncoming && trimmedIncoming === trimmedCurrent) {
      return null;
    }

    if (normalizedIncoming.startsWith(normalizedCurrent)) {
      const suffix = normalizedIncoming.slice(normalizedCurrent.length);
      if (!suffix) {
        return null;
      }
      this.textBuffers.set(runId, normalizedCurrent + suffix);
      return suffix;
    }

    if (
      trimmedIncoming &&
      trimmedCurrent &&
      (trimmedCurrent.endsWith(trimmedIncoming) || trimmedCurrent.includes(trimmedIncoming))
    ) {
      return null;
    }

    this.textBuffers.set(runId, normalizedCurrent + normalizedIncoming);
    return normalizedIncoming;
  }

  private isMissingResumeSessionError(errorMessage?: string): boolean {
    if (!errorMessage) {
      return false;
    }
    return /no conversation found with session id/i.test(errorMessage);
  }

  private normalizeRuntimeFailure(errorMessage?: string): string {
    if (!errorMessage) {
      return "Agent runtime failed";
    }

    if (/requires approval/i.test(errorMessage)) {
      return "命令被安全策略拦截。当前 headless CLI 模式不支持逐条人工审批，请调整允许规则后重试。";
    }

    if (/contains simple_expansion/i.test(errorMessage)) {
      return "命令被运行时策略拦截。当前 CLI 模式不允许带 shell 展开的 Bash 片段，请改为更直接的命令。";
    }

    return errorMessage;
  }

  private withEventMeta<T extends RuntimeBaseEvent>(
    event: T,
    persisted: { event_id: string; occurred_at: string; seq: number },
  ): T {
    return {
      ...event,
      eventId: persisted.event_id,
      occurredAt: persisted.occurred_at,
      seq: persisted.seq,
    };
  }
}
