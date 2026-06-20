import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AgentRuntime } from "../../runtime/base/agent-runtime.js";
import { RunManager } from "../../runtime/manager/run-manager.js";
import { RuntimeRegistry } from "../../runtime/runtime-registry.js";
import {
  AgentRecord,
  MergeConflictFile,
  MessageRecord,
  OrchestratorEvent,
  OrchestrateResponse,
  RunStatus,
  RunSummary,
  TaskPlan,
  TaskPlanItem,
  TaskType,
  WorkspaceExecutionStatus,
} from "../../shared/types.js";
import { AgentsService } from "../agents/agents.service.js";
import { AssignmentsService } from "../assignments/assignments.service.js";
import { ConversationsService } from "../conversations/conversations.service.js";
import { MessagesService } from "../messages/messages.service.js";
import { TasksService } from "../tasks/tasks.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import {
  buildDagPreview,
  DagScheduler,
  PlannedTask as SchedulerPlannedTask,
} from "./dag-scheduler.js";

interface PlannerTask extends SchedulerPlannedTask {}

interface PlannerResult {
  summary: string;
  tasks: PlannerTask[];
}

interface PlannerTaskCandidate {
  id?: string;
  title?: string;
  description?: string;
  task_type?: TaskType;
  expected_output?: string;
  affected_files?: unknown;
  suggested_agent?: string | null;
  priority?: number;
  depends_on?: unknown;
}

interface PlannerResultCandidate {
  summary: string;
  tasks: PlannerTaskCandidate[];
}

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const MIN_WATCH_TIMEOUT_MS = 30_000;
const SLOW_WATCHER_TICK_MS = 200;
const SLOW_PLAN_POLL_MS = 100;

export interface HiddenPlannerDeps {
  plan?: (input: {
    prompt: string;
    agents: AgentRecord[];
    workspacePath: string;
    workspaceStatus: WorkspaceExecutionStatus;
  }) => Promise<PlannerResultCandidate | PlannerResult | string>;
  approvalService?: {
    create: (input: {
      conversationId: string;
      runId?: string | null;
      taskId?: string | null;
      assignmentId?: string | null;
      actionType: "apply_changes" | "apply_and_commit" | "resolve_conflicts";
      title: string;
      description?: string | null;
      payload?: Record<string, unknown> | null;
    }) => { id: string };
    listByConversation: (conversationId: string) => Array<{
      id: string;
      runId: string | null;
      actionType: string;
      status: string;
    }>;
    cancel?: (id: string, reason?: string) => { id: string };
  };
  mergeService?: {
    getByRunId: (runId: string) => {
      status: string;
      approvalId: string | null;
      conflicts: MergeConflictFile[];
      blockedReason: string | null;
      appliedFiles: string[];
    } | null;
    mergeRunToMain: (runId: string) => {
      status: "merged" | "needs_approval";
      merge: {
        status: string;
        approvalId: string | null;
        conflicts: MergeConflictFile[];
        blockedReason: string | null;
        appliedFiles: string[];
      };
    };
    attachApproval: (runId: string, approvalId: string) => unknown;
  };
  pollIntervalMs?: number;
}

export interface OrchestratorServiceDeps extends HiddenPlannerDeps {
  emitEvent?: (event: OrchestratorEvent) => void;
}

interface OrchestratedTaskContext {
  plannerTask: PlannerTask;
  agent: AgentRecord;
  taskRecordId: string;
  assignmentId: string;
}

interface ActivePlanScheduler {
  scheduler: DagScheduler;
  planId: string;
  summary: string;
  sourceMessageId?: string;
  workspacePath: string;
  planMessageId: string;
  conversationId: string;
  itemsByPlannerTaskId: Map<string, TaskPlanItem>;
  taskContextByPlannerTaskId: Map<string, OrchestratedTaskContext>;
  plannerTaskIdByTaskRecordId: Map<string, string>;
  seenTerminalTaskIds: Set<string>;
  blockedTaskIds: Set<string>;
  runIds: Set<string>;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampPriority(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.round(value));
  }
  return 1;
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 40) || "任务执行";
}

function normalizeAffectedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 12);
}

function normalizeTaskId(value: unknown, index: number): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return `t${index + 1}`;
}

function normalizeDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function fallbackPlan(prompt: string): PlannerResult {
  console.log("[planner fallback triggered] prompt:", prompt.slice(0, 50));
  return {
    summary: "已按单任务执行。",
    tasks: [
      {
        id: "t1",
        title: summarizePrompt(prompt),
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

function parsePlannerJson(raw: string): PlannerResult | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) {
    console.log("[planner parse result]", null);
    return null;
  }

  let depth = 0;
  let end = -1;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1 || end <= start) {
    console.log("[planner parse result]", null);
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.tasks)) {
      return null;
    }

    const rawTasks = parsed.tasks
      .map((task) => (task && typeof task === "object" ? (task as Record<string, unknown>) : null))
      .filter((task): task is Record<string, unknown> => task !== null)
      .map((task, index) => ({
        id: normalizeTaskId(task.id, index),
        title: typeof task.title === "string" ? task.title.trim() : "",
        description:
          typeof task.description === "string" ? task.description.trim() : "",
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
        priority: clampPriority(task.priority),
        depends_on: normalizeDependsOn(task.depends_on),
      }))
      .filter((task) => task.title || task.description)
      .slice(0, 4);

    if (rawTasks.length === 0) {
      return null;
    }

    const knownIds = new Set(rawTasks.map((task) => task.id));
    const tasks = rawTasks.map((task) => ({
      ...task,
      depends_on: task.depends_on.filter((dependencyId) => dependencyId !== task.id && knownIds.has(dependencyId)),
    }));

    const result = {
      summary: parsed.summary.trim() || "任务计划",
      tasks,
    };
    console.log("[planner parse result]", result);
    return result;
  } catch {
    console.log("[planner parse result]", null);
    return null;
  }
}

function normalizePlannerTask(task: PlannerTaskCandidate): PlannerTask | null {
  const index = 0;
  const title = typeof task.title === "string" ? task.title.trim() : "";
  const description =
    typeof task.description === "string" ? task.description.trim() : "";
  if (!title && !description) {
    return null;
  }

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
    priority: clampPriority(task.priority),
    depends_on: normalizeDependsOn(task.depends_on),
  };
}

function normalizePlannerResult(
  input: PlannerResultCandidate | PlannerResult | null,
): PlannerResult | null {
  if (!input || typeof input.summary !== "string" || !Array.isArray(input.tasks)) {
    return null;
  }

  const rawTasks = input.tasks
    .map((task, index) => normalizePlannerTask({ ...task, id: normalizeTaskId(task.id, index) }))
    .filter((task): task is PlannerTask => Boolean(task))
    .slice(0, 5);
  if (rawTasks.length === 0) {
    return null;
  }

  const knownIds = new Set(rawTasks.map((task) => task.id));
  const tasks = rawTasks.map((task) => ({
    ...task,
    depends_on: task.depends_on.filter((dependencyId) => dependencyId !== task.id && knownIds.has(dependencyId)),
  }));

  return {
    summary: input.summary.trim() || "任务计划",
    tasks,
  };
}

function buildPlannerPrompt(
  prompt: string,
  agents: AgentRecord[],
  workspaceStatus: WorkspaceExecutionStatus,
  context?: { lastPlanSummary?: string | null; recentUserMessages?: string[] },
): string {
  return [
    "You are a planning orchestrator for a multi-agent coding workspace.",
    "Return strict JSON only. Do not use markdown fences, prose, or explanations.",
    "Produce 1 to 5 tasks. Use 1 task when the request is simple. Most requests should become 2 to 4 tasks.",
    "Prefer assigning tasks based on agent capabilities and instructions.",
    "Each task must have a concrete deliverable and should avoid vague wording such as 'improve the project'.",
    "If the user's input already lists explicit subtasks (numbered, bulleted, or line-separated), map each one directly to a task without re-splitting or merging them.",
    "task title must be a short verb phrase under 20 characters. Never copy the user's raw input as the title.",
    "frontend tasks should produce UI or frontend code changes.",
    "backend tasks should produce API, service, or data-layer changes.",
    "test tasks should produce tests.",
    "docs tasks should produce documentation.",
    "Each task must include a stable short id such as t1, t2, t3.",
    "Each task must include depends_on as an array of task ids it waits for. Use [] when the task has no dependencies.",
    "Use dependencies when a task cannot start until another task's deliverable exists, such as tests after implementation or frontend integration after backend API readiness.",
    "Prefer parallel root tasks when deliverables touch independent files or can be safely merged later.",
    "For UI feature work such as a feedback form, split independent component logic, styles, assets, or copy into parallel root tasks when each task can produce a valid standalone change.",
    "If a task must import or directly use a file created by another task, keep the dependency unless the upstream task is only optional styling, assets, or copy.",
    "For build verification tasks, depends_on should include every implementation or integration task it validates.",
    "Never create circular dependencies.",
    "Workspace status:",
    JSON.stringify({
      state: workspaceStatus.state,
      dirty_files_count: workspaceStatus.dirtyFilesCount,
      dirty_files_sample: workspaceStatus.dirtyFilesSample,
      last_commit: workspaceStatus.lastCommit,
      suggestion: workspaceStatus.suggestion,
    }),
    "Treat workspace status as hard context for planning.",
    "If workspace state is clean, prefer incremental tasks when the user asks to modify or extend an existing project.",
    "If workspace state is clean and the user describes a brand-new project or empty workspace, prefer setup tasks that create the initial project structure.",
    "If last_commit is present, use it only as weak context that this workspace already has a baseline; do not mention commit hashes in task titles.",
    "dirty_files_count and dirty_files_sample describe uncommitted local changes. They are for workspace safety context, not a summary of project architecture.",
    "Include affected_files as a list of repo-relative file paths or globs the task is expected to touch.",
    "Output schema fields per task: id, title, description, task_type, expected_output, affected_files, suggested_agent, priority, depends_on.",
    ...(context?.lastPlanSummary
      ? ["Project context (last completed plan):", context.lastPlanSummary]
      : []),
    ...(context?.recentUserMessages && context.recentUserMessages.length > 0
      ? [
          "Recent user messages (most recent last):",
          ...context.recentUserMessages.map((m) => `- ${m}`),
        ]
      : []),
    "User request:",
    prompt,
    "Available agents:",
    JSON.stringify(
      agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        adapter_type: agent.adapter_type,
        capabilities: agent.capabilities ?? [],
        instructions: agent.instructions ? agent.instructions.slice(0, 200) : null,
      })),
    ),
    'Output JSON schema: {"summary":"string","tasks":[{"id":"t1","title":"string","description":"string","task_type":"frontend|backend|test|docs|review|deploy|general","expected_output":"string","affected_files":["string"],"suggested_agent":"string | null","priority":1,"depends_on":["t1"]}]}',
  ].join("\n");
}

function normalizePathHint(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function hintsOverlap(left: string, right: string): boolean {
  const a = normalizePathHint(left).replace(/\*+$/g, "");
  const b = normalizePathHint(right).replace(/\*+$/g, "");
  if (!a || !b) {
    return false;
  }
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a.startsWith(b) || b.startsWith(a);
}

function buildPredictedConflictGroups(tasks: PlannerTask[]): Array<{
  taskIndexes: [number, number];
  files: string[];
}> {
  const groups: Array<{ taskIndexes: [number, number]; files: string[] }> = [];
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const overlap = tasks[leftIndex].affected_files.filter((left) =>
        tasks[rightIndex].affected_files.some((right) => hintsOverlap(left, right)),
      );
      if (overlap.length > 0) {
        groups.push({
          taskIndexes: [leftIndex + 1, rightIndex + 1],
          files: Array.from(new Set(overlap)),
        });
      }
    }
  }
  return groups;
}

function extractRunOutputSummary(run: { events?: Array<{ event_type: string; payload_json: Record<string, unknown> }> } | null): string {
  const completed = run?.events
    ?.filter((event) => event.event_type === "run_completed")
    .at(-1);
  const finalText = completed?.payload_json.finalText;
  if (typeof finalText === "string" && finalText.trim()) {
    return finalText.trim().slice(0, 2000);
  }

  const text = run?.events
    ?.filter((event) => event.event_type === "text_delta")
    .map((event) => event.payload_json.delta)
    .filter((delta): delta is string => typeof delta === "string")
    .join("")
    .trim();
  return text ? text.slice(0, 2000) : "Task completed without a textual summary.";
}

function buildTaskRunPrompt(task: PlannerTask, state: ActivePlanScheduler): string {
  const upstreamOutputs = task.depends_on
    .map((dependencyId) => state.itemsByPlannerTaskId.get(dependencyId))
    .filter((item): item is TaskPlanItem => Boolean(item))
    .filter((item) => typeof item.outputSummary === "string" && item.outputSummary.trim().length > 0)
    .map((item) => `- ${item.plannerTaskId ?? item.index} ${item.title}: ${item.outputSummary}`);

  if (upstreamOutputs.length === 0) {
    return task.description || task.title;
  }

  return [
    task.description || task.title,
    "",
    "Upstream task outputs:",
    ...upstreamOutputs,
  ].join("\n");
}

function writeTaskOutputArtifact(input: {
  workspacePath: string;
  planId: string;
  plannerTaskId: string;
  title: string;
  outputSummary: string;
}): string {
  const outputDir = path.join(input.workspacePath, ".agenthub", "runs", input.planId, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${input.plannerTaskId}.md`);
  fs.writeFileSync(
    outputPath,
    [`# ${input.plannerTaskId} ${input.title}`, "", input.outputSummary, ""].join("\n"),
    "utf8",
  );
  return outputPath;
}

function normalizeTaskType(value: unknown): TaskType {
  if (
    value === "frontend" ||
    value === "backend" ||
    value === "test" ||
    value === "docs" ||
    value === "review" ||
    value === "deploy" ||
    value === "general"
  ) {
    return value;
  }
  return "general";
}

function buildCapabilityHints(task: {
  task_type: TaskType;
  title: string;
  description: string;
  expected_output: string;
}): string[] {
  const hints = new Set<string>();
  const addTokens = (value: string) => {
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/)) {
      if (token.length >= 3) hints.add(token);
    }
  };

  addTokens(task.title);
  addTokens(task.description);
  addTokens(task.expected_output);

  if (task.task_type !== "general") {
    hints.add(task.task_type);
  }
  if (task.task_type === "frontend") {
    hints.add("ui");
    hints.add("react");
  }
  if (task.task_type === "backend") {
    hints.add("api");
    hints.add("service");
  }
  if (task.task_type === "test") {
    hints.add("testing");
    hints.add("qa");
  }
  if (task.task_type === "docs") {
    hints.add("documentation");
  }

  return Array.from(hints);
}

export class OrchestratorService {
  private watcherTimer: ReturnType<typeof setTimeout> | null = null;
  private watcherTickInFlight = false;
  private closed = false;
  private readonly activePlanSchedulers = new Map<string, ActivePlanScheduler>();

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly agentsService: AgentsService,
    private readonly workspacesService: WorkspacesService,
    private readonly messagesService: MessagesService,
    private readonly tasksService: TasksService,
    private readonly assignmentsService: AssignmentsService,
    private readonly runtimeRegistry: RuntimeRegistry,
    private readonly runManager: RunManager,
    private readonly deps: OrchestratorServiceDeps = {},
  ) {}

  async orchestrateConversation(
    conversationId: string,
    prompt: string,
    sourceMessageId?: string,
  ): Promise<OrchestrateResponse> {
    const conversation = this.conversationsService.getById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    if (sourceMessageId) {
      const sourceMessage = this.messagesService.getById(sourceMessageId);
      if (!sourceMessage || sourceMessage.conversation_id !== conversationId) {
        throw new Error("sourceMessageId is invalid");
      }
    }

    // Check for an active plan in this conversation — queue if one is already watching
    const activePlan = this.messagesService
      .listWatchingPlanMessages()
      .find((msg) => msg.conversation_id === conversationId);

    if (activePlan) {
      const activeSummary =
        typeof activePlan.metadata_json?.summary === "string"
          ? activePlan.metadata_json.summary
          : "当前任务";
      this.messagesService.createMessage({
        conversationId,
        senderType: "orchestrator",
        content: `收到，当前正在执行：${activeSummary}，完成后将处理您的请求。`,
        messageType: "system",
        metadata: { sourceMessageId: sourceMessageId ?? null },
      });
      this.messagesService.createMessage({
        conversationId,
        senderType: "user",
        content: prompt,
        messageType: "queued_prompt",
        metadata: { consumed: false, sourceMessageId: sourceMessageId ?? null },
      });
      return { plan: null, runs: [], queued: true };
    }

    const enabledAgents = this.agentsService.listAgents();
    const checks = await Promise.all(
      enabledAgents.map(async (agent) => ({
        agent,
        registered: this.runtimeRegistry.hasAdapter(agent.adapter_type),
        check: this.runtimeRegistry.hasAdapter(agent.adapter_type)
          ? await this.runtimeRegistry.checkAdapter(agent.adapter_type)
          : null,
      })),
    );
    const agents = checks
      .filter((item) => item.registered && item.check?.available)
      .map((item) => item.agent);
    if (agents.length === 0) {
      throw new Error("No available agent");
    }

    const workspacePath =
      this.workspacesService.getByConversationId(conversationId)?.root_path ??
      path.resolve(process.cwd());
    const workspaceStatus = this.workspacesService.getExecutionStatus(workspacePath);

    this.deps.emitEvent?.({
      type: "orchestrator_planning_started",
      conversationId,
      prompt,
    });

    const lastPlanSummary = this.messagesService.getLastCompletedPlanSummary(conversationId);
    const recentUserMessages = this.messagesService.getRecentUserMessages(conversationId, 5);
    const plannerResult = await this.plan(
      conversationId,
      prompt,
      agents,
      workspacePath,
      workspaceStatus,
      { lastPlanSummary, recentUserMessages },
    );
    const dagPreview = buildDagPreview(plannerResult.tasks);
    const taskIds: string[] = [];
    const assignmentIds: string[] = [];
    const assignments = plannerResult.tasks.map((task, index) => {
      const agent = this.matchAgent(task, agents);
      if (!agent) {
        throw new Error("No default agent available");
      }

      return {
        index,
        task,
        agent,
      };
    });
    const planId = crypto.randomUUID();
    const planMessage = this.messagesService.createMessage({
      conversationId,
      senderType: "orchestrator",
      senderId: null,
      content: plannerResult.summary,
      messageType: "plan",
      metadata: {
        planId,
        sourceMessageId: sourceMessageId ?? null,
        summary: plannerResult.summary,
        items: [],
        dagPreview: {
          levels: dagPreview.levels.map((level) => level.map((task) => task.id)),
          text: dagPreview.text,
        },
        runIds: [],
        predictedConflictGroups: buildPredictedConflictGroups(plannerResult.tasks),
      },
    });
    const items: TaskPlanItem[] = [];
    const taskContexts: OrchestratedTaskContext[] = [];

    for (const assignment of assignments) {
      const { index, task, agent } = assignment;
      const taskRecord = this.tasksService.create({
        conversationId,
        sourceMessageId: sourceMessageId ?? null,
        planMessageId: planMessage.id,
        title: task.title || summarizePrompt(prompt),
        description: task.description || task.title || prompt,
        dependsOn: task.depends_on,
        taskType: task.task_type,
        expectedOutput: task.expected_output,
        status: "pending",
        priority: clampPriority(task.priority),
        createdByType: "orchestrator",
      });
      const assignmentRecord = this.assignmentsService.createAssignment({
        taskId: taskRecord.id,
        conversationId,
        agentId: agent.id,
        status: "pending",
        assignedByType: "orchestrator",
      });
      taskIds.push(taskRecord.id);
      assignmentIds.push(assignmentRecord.id);
      items.push({
        index: index + 1,
        plannerTaskId: task.id,
        title: task.title || summarizePrompt(prompt),
        description: task.description || task.title || prompt,
        taskType: task.task_type,
        expectedOutput: task.expected_output,
        affectedFiles: task.affected_files,
        dependsOn: task.depends_on,
        suggestedAgent: task.suggested_agent,
        assignedAgentId: agent.id,
        assignedAgentName: agent.name,
        priority: clampPriority(task.priority),
        taskId: taskRecord.id,
        assignmentId: assignmentRecord.id,
        runId: null,
        status: "pending",
        outputSummary: null,
      });
      taskContexts.push({
        plannerTask: task,
        agent,
        taskRecordId: taskRecord.id,
        assignmentId: assignmentRecord.id,
      });
    }

    const maxWatchMs = this.computePlanMaxWatchMs(assignments.map((assignment) => assignment.agent));
    const schedulerState: ActivePlanScheduler = {
      scheduler: null as unknown as DagScheduler,
      planId,
      summary: plannerResult.summary,
      sourceMessageId,
      workspacePath,
      planMessageId: planMessage.id,
      conversationId,
      itemsByPlannerTaskId: new Map(taskContexts.map((context, index) => [context.plannerTask.id, items[index]!])),
      taskContextByPlannerTaskId: new Map(taskContexts.map((context) => [context.plannerTask.id, context])),
      plannerTaskIdByTaskRecordId: new Map(taskContexts.map((context) => [context.taskRecordId, context.plannerTask.id])),
      seenTerminalTaskIds: new Set(),
      blockedTaskIds: new Set(),
      runIds: new Set(),
    };
    this.messagesService.updateMessageMetadata(planMessage.id, {
      planId,
      sourceMessageId: sourceMessageId ?? null,
      summary: plannerResult.summary,
      taskIds,
      assignmentIds,
      items,
      dagPreview: {
        levels: dagPreview.levels.map((level) => level.map((task) => task.id)),
        text: dagPreview.text,
      },
      runIds: [],
      predictedConflictGroups: buildPredictedConflictGroups(plannerResult.tasks),
      watchStatus: "watching",
      watchStartedAt: new Date().toISOString(),
      maxWatchMs,
    });
    let scheduler!: DagScheduler;
    scheduler = new DagScheduler(
      plannerResult.tasks,
      async (task) => {
        const context = taskContexts.find((entry) => entry.plannerTask.id === task.id);
        if (!context) {
          return;
        }
        try {
          this.tasksService.updateTaskStatus(context.taskRecordId, "assigned");
          const run = this.runManager.createRun({
            conversationId,
            agentId: context.agent.id,
            prompt: buildTaskRunPrompt(task, schedulerState),
            taskId: context.taskRecordId,
            assignmentId: context.assignmentId,
            sourceMessageId: planMessage.id,
          });
          this.assignmentsService.updateAssignmentStatus(
            context.assignmentId,
            "pending",
            run.id,
          );
          const item = schedulerState.itemsByPlannerTaskId.get(task.id);
          if (item) {
            item.runId = run.id;
            item.status = run.status;
          }
          schedulerState.runIds.add(run.id);
          this.persistPlanState(schedulerState, planId, plannerResult.summary, sourceMessageId);
        } catch (error) {
          this.tasksService.updateTaskStatus(context.taskRecordId, "failed");
          const item = schedulerState.itemsByPlannerTaskId.get(task.id);
          if (item) {
            item.status = "failed";
          }
          this.persistPlanState(schedulerState, planId, plannerResult.summary, sourceMessageId);
          await scheduler.notifyFailed(task.id);
          throw error;
        }
      },
      () => {
        const current = this.messagesService.getById(planMessage.id);
        const currentMetadata = current?.metadata_json ?? {};
        const runDetails = Array.from(schedulerState.runIds)
          .map((runId) => this.runManager.getRun(runId))
          .filter((run): run is NonNullable<typeof run> => Boolean(run));
        const mergeRecords = Array.from(schedulerState.runIds)
          .map((runId) => this.deps.mergeService?.getByRunId(runId) ?? null)
          .filter((merge): merge is NonNullable<typeof merge> => Boolean(merge));
        const totalAppliedFiles = mergeRecords.reduce((sum, merge) => sum + merge.appliedFiles.length, 0);
        const startedAt = runDetails.reduce<number | null>((earliest, run) => {
          const value = new Date(run.started_at).getTime();
          return earliest === null || value < earliest ? value : earliest;
        }, null);
        const finishedAt = runDetails.reduce<number | null>((latest, run) => {
          const value = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
          return latest === null || value > latest ? value : latest;
        }, null);
        const totalDurationSeconds =
          startedAt !== null && finishedAt !== null
            ? Math.max(1, Math.round((finishedAt - startedAt) / 1000))
            : null;
        this.messagesService.updateMessageMetadata(planMessage.id, {
          ...currentMetadata,
          watchStatus: "completed",
        });
        this.messagesService.createMessage({
          conversationId,
          senderType: "orchestrator",
          content:
            `📋 协作计划已全部完成：${plannerResult.tasks.length} 个任务，${totalAppliedFiles} 个文件变更` +
            (totalDurationSeconds ? `，总耗时 ${totalDurationSeconds}s` : ""),
          messageType: "system",
          metadata: {
            planMessageId: planMessage.id,
            runIds: Array.from(schedulerState.runIds),
            totalAppliedFiles,
            totalDurationSeconds,
          },
        });
        // Drain the queue: trigger next pending prompt after this plan completes
        const [nextQueued] = this.messagesService.listQueuedPrompts(conversationId);
        if (nextQueued) {
          this.messagesService.markQueuedPromptConsumed(nextQueued.id);
          void this.orchestrateConversation(conversationId, nextQueued.content, undefined).catch(
            (err) => {
              console.error("[queue drain error]", err);
            },
          );
        }
        this.activePlanSchedulers.delete(planMessage.id);
      },
      (task, reason) => {
        const context = taskContexts.find((entry) => entry.plannerTask.id === task.id);
        if (!context || schedulerState.blockedTaskIds.has(task.id)) {
          return;
        }
        schedulerState.blockedTaskIds.add(task.id);
        this.tasksService.updateTaskStatus(context.taskRecordId, "blocked");
        const item = schedulerState.itemsByPlannerTaskId.get(task.id);
        if (item) {
          item.status = "blocked";
        }
        this.persistPlanState(schedulerState, planId, plannerResult.summary, sourceMessageId);
        this.messagesService.createMessage({
          conversationId,
          senderType: "orchestrator",
          content: `任务 ${task.title} 已阻塞：${reason}`,
          messageType: "system",
          metadata: {
            planMessageId: planMessage.id,
            taskId: context.taskRecordId,
            plannerTaskId: task.id,
            reason,
          },
        });
      },
    );
    schedulerState.scheduler = scheduler;
    this.activePlanSchedulers.set(planMessage.id, schedulerState);
    await scheduler.start();

    const runs = this.runManager
      .listRuns(conversationId)
      .filter((run) => schedulerState.runIds.has(run.id))
      .sort((a, b) => {
        const aIndex = items.findIndex((item) => item.runId === a.id);
        const bIndex = items.findIndex((item) => item.runId === b.id);
        return aIndex - bIndex;
      });

    const plan: TaskPlan = {
      id: planId,
      summary: plannerResult.summary,
      items: Array.from(schedulerState.itemsByPlannerTaskId.values()).sort((a, b) => a.index - b.index),
      dagPreview: {
        levels: dagPreview.levels.map((level) => level.map((task) => task.id)),
        text: dagPreview.text,
      },
    };

    this.deps.emitEvent?.({
      type: "orchestrator_planning_done",
      conversationId,
      planId,
      summary: plannerResult.summary,
    });

    this.ensureWatcherScheduler();

    return { plan, runs };
  }

  async resumePlanFromTask(
    planMessageId: string,
    fromPlannerTaskId: string,
  ): Promise<{ plan: TaskPlan; runs: RunSummary[]; rerunPlannerTaskIds: string[] }> {
    const planMessage = this.messagesService.getById(planMessageId);
    if (!planMessage || planMessage.message_type !== "plan") {
      throw new Error("Plan not found");
    }
    const metadata = planMessage.metadata_json ?? {};
    const rawItems = Array.isArray(metadata.items) ? metadata.items : [];
    const items = rawItems
      .map((item, index) => item && typeof item === "object" ? item as TaskPlanItem : null)
      .filter((item): item is TaskPlanItem => Boolean(item))
      .map((item, index) => ({
        ...item,
        plannerTaskId: item.plannerTaskId ?? `t${index + 1}`,
        dependsOn: item.dependsOn ?? [],
      }));
    const target = items.find((item) => item.plannerTaskId === fromPlannerTaskId);
    if (!target) {
      throw new Error("Plan task not found");
    }

    const dependentsById = new Map<string, string[]>();
    for (const item of items) {
      dependentsById.set(item.plannerTaskId!, []);
    }
    for (const item of items) {
      for (const dependencyId of item.dependsOn ?? []) {
        dependentsById.get(dependencyId)?.push(item.plannerTaskId!);
      }
    }

    const rerunIds: string[] = [];
    const visit = (plannerTaskId: string) => {
      if (rerunIds.includes(plannerTaskId)) {
        return;
      }
      rerunIds.push(plannerTaskId);
      for (const dependentId of dependentsById.get(plannerTaskId) ?? []) {
        visit(dependentId);
      }
    };
    visit(fromPlannerTaskId);
    const rerunIdSet = new Set(rerunIds);

    const workspacePath =
      this.workspacesService.getByConversationId(planMessage.conversation_id)?.root_path ??
      path.resolve(process.cwd());
    const contexts: OrchestratedTaskContext[] = [];
    const plannerTasks: PlannerTask[] = [];

    for (const item of items.filter((entry) => rerunIdSet.has(entry.plannerTaskId!))) {
      const taskRecord = this.tasksService.getById(item.taskId);
      if (!taskRecord) {
        throw new Error(`Task not found: ${item.taskId}`);
      }
      const assignment = this.assignmentsService.listAssignmentsByTask(item.taskId)[0];
      if (!assignment) {
        throw new Error(`Task assignment not found: ${item.taskId}`);
      }
      const latestRun =
        assignment.latest_run_id ? this.runManager.getRun(assignment.latest_run_id) : null;
      if (latestRun?.status === "queued" || latestRun?.status === "running") {
        throw new Error("Cannot resume while a selected task is running");
      }
      const agent = this.agentsService.getById(assignment.agent_id);
      if (!agent) {
        throw new Error(`Agent not found: ${assignment.agent_id}`);
      }
      const plannerTask: PlannerTask = {
        id: item.plannerTaskId!,
        title: item.title,
        description: item.description,
        task_type: item.taskType ?? "general",
        expected_output: item.expectedOutput ?? "Complete the requested change and summarize the result.",
        affected_files: item.affectedFiles ?? [],
        suggested_agent: item.suggestedAgent ?? null,
        priority: item.priority,
        depends_on: (item.dependsOn ?? []).filter((dependencyId) => rerunIdSet.has(dependencyId)),
      };
      plannerTasks.push(plannerTask);
      contexts.push({
        plannerTask,
        agent,
        taskRecordId: item.taskId,
        assignmentId: item.assignmentId,
      });
    }

    const planId = typeof metadata.planId === "string" ? metadata.planId : crypto.randomUUID();
    const summary = typeof metadata.summary === "string" ? metadata.summary : planMessage.content;
    const state: ActivePlanScheduler = {
      scheduler: null as unknown as DagScheduler,
      planId,
      summary,
      sourceMessageId:
        typeof metadata.sourceMessageId === "string" ? metadata.sourceMessageId : undefined,
      workspacePath,
      planMessageId,
      conversationId: planMessage.conversation_id,
      itemsByPlannerTaskId: new Map(items.map((item) => [item.plannerTaskId!, item])),
      taskContextByPlannerTaskId: new Map(contexts.map((context) => [context.plannerTask.id, context])),
      plannerTaskIdByTaskRecordId: new Map(contexts.map((context) => [context.taskRecordId, context.plannerTask.id])),
      seenTerminalTaskIds: new Set(),
      blockedTaskIds: new Set(),
      runIds: new Set(
        Array.isArray(metadata.runIds)
          ? metadata.runIds.filter((runId): runId is string => typeof runId === "string")
          : [],
      ),
    };

    for (const plannerTaskId of rerunIds) {
      const item = state.itemsByPlannerTaskId.get(plannerTaskId);
      if (!item) {
        continue;
      }
      item.runId = null;
      item.status = "pending";
      item.outputSummary = null;
      this.tasksService.updateTaskStatus(item.taskId, "pending");
    }

    let scheduler!: DagScheduler;
    scheduler = new DagScheduler(
      plannerTasks,
      async (task) => {
        const context = state.taskContextByPlannerTaskId.get(task.id);
        if (!context) {
          return;
        }
        this.tasksService.updateTaskStatus(context.taskRecordId, "assigned");
        const run = this.runManager.createRun({
          conversationId: planMessage.conversation_id,
          agentId: context.agent.id,
          prompt: buildTaskRunPrompt(task, state),
          taskId: context.taskRecordId,
          assignmentId: context.assignmentId,
          sourceMessageId: planMessage.id,
        });
        this.assignmentsService.prepareAssignmentRerun(context.assignmentId, {
          agentId: context.agent.id,
          latestRunId: run.id,
          status: "pending",
        });
        const item = state.itemsByPlannerTaskId.get(task.id);
        if (item) {
          item.runId = run.id;
          item.status = run.status;
        }
        state.runIds.add(run.id);
        this.persistPlanState(state, planId, summary, state.sourceMessageId);
      },
      () => {
        const current = this.messagesService.getById(planMessageId);
        this.messagesService.updateMessageMetadata(planMessageId, {
          ...(current?.metadata_json ?? {}),
          watchStatus: "completed",
        });
        const [nextQueuedResume] = this.messagesService.listQueuedPrompts(planMessage.conversation_id);
        if (nextQueuedResume) {
          this.messagesService.markQueuedPromptConsumed(nextQueuedResume.id);
          void this.orchestrateConversation(planMessage.conversation_id, nextQueuedResume.content, undefined).catch(
            (err) => {
              console.error("[queue drain error]", err);
            },
          );
        }
        this.activePlanSchedulers.delete(planMessageId);
      },
      (task, reason) => {
        const context = state.taskContextByPlannerTaskId.get(task.id);
        if (!context) {
          return;
        }
        this.tasksService.updateTaskStatus(context.taskRecordId, "blocked");
        const item = state.itemsByPlannerTaskId.get(task.id);
        if (item) {
          item.status = "blocked";
        }
        this.persistPlanState(state, planId, summary, state.sourceMessageId);
        this.messagesService.createMessage({
          conversationId: planMessage.conversation_id,
          senderType: "orchestrator",
          content: `任务 ${task.title} 已阻塞：${reason}`,
          messageType: "system",
          metadata: {
            planMessageId,
            taskId: context.taskRecordId,
            plannerTaskId: task.id,
            reason,
          },
        });
      },
    );
    state.scheduler = scheduler;
    this.activePlanSchedulers.set(planMessageId, state);
    this.persistPlanState(state, planId, summary, state.sourceMessageId);
    await scheduler.start();
    this.ensureWatcherScheduler();

    return {
      plan: {
        id: planId,
        summary,
        items: Array.from(state.itemsByPlannerTaskId.values()).sort((a, b) => a.index - b.index),
        dagPreview:
          metadata.dagPreview && typeof metadata.dagPreview === "object"
            ? metadata.dagPreview as TaskPlan["dagPreview"]
            : undefined,
      },
      runs: this.runManager
        .listRuns(planMessage.conversation_id)
        .filter((run) => state.runIds.has(run.id)),
      rerunPlannerTaskIds: rerunIds,
    };
  }

  private async plan(
    conversationId: string,
    prompt: string,
    agents: AgentRecord[],
    workspacePath: string,
    workspaceStatus: WorkspaceExecutionStatus,
    context?: { lastPlanSummary?: string | null; recentUserMessages?: string[] },
  ): Promise<PlannerResult> {
    if (this.deps.plan) {
      try {
        const planned = await this.deps.plan({
          prompt: buildPlannerPrompt(prompt, agents, workspaceStatus, context),
          agents,
          workspacePath,
          workspaceStatus,
        });
        if (typeof planned === "string") {
          return parsePlannerJson(planned) ?? fallbackPlan(prompt);
        }
        return normalizePlannerResult(planned) ?? fallbackPlan(prompt);
      } catch {
        return fallbackPlan(prompt);
      }
    }

    try {
      return await this.runHiddenPlanner(
        conversationId,
        prompt,
        agents,
        workspacePath,
        workspaceStatus,
        context,
      );
    } catch {
      return fallbackPlan(prompt);
    }
  }

  private async runHiddenPlanner(
    conversationId: string,
    prompt: string,
    agents: AgentRecord[],
    workspacePath: string,
    workspaceStatus: WorkspaceExecutionStatus,
    context?: { lastPlanSummary?: string | null; recentUserMessages?: string[] },
  ): Promise<PlannerResult> {
    const plannerAgent =
      agents.find((agent) => agent.adapter_type === "claude_cli") ??
      this.agentsService.getDefaultAgent();
    if (!plannerAgent) {
      throw new Error("No default agent available");
    }
    const plannerCheck = await this.runtimeRegistry.checkAdapter(plannerAgent.adapter_type);
    if (!plannerCheck.available) {
      throw new Error(
        `Planner runtime unavailable: ${plannerAgent.adapter_type}${
          plannerCheck.message ? ` (${plannerCheck.message})` : ""
        }`,
      );
    }

    const runtime: AgentRuntime = this.runtimeRegistry.getAdapter(plannerAgent.adapter_type);
    const hiddenRunId = `planner-${crypto.randomUUID()}`;
    let text = "";

    const handle = await runtime.startRun(
      {
        runId: hiddenRunId,
        conversationId: `planner:${hiddenRunId}`,
        prompt: buildPlannerPrompt(prompt, agents, workspaceStatus, context),
        workspacePath,
        agentConfig: plannerAgent.config_json,
      },
      {
        onEvent: async (event) => {
          if (event.type === "text_delta") {
            text += event.delta;
            this.deps.emitEvent?.({
              type: "orchestrator_text_delta",
              conversationId,
              delta: event.delta,
            });
          }
        },
      },
    );

    const timeout = setTimeout(() => {
      void runtime.interruptRun(hiddenRunId).catch(() => undefined);
    }, 60_000);

    const completion = await handle.completion.finally(() => clearTimeout(timeout));
    if (completion.status !== "completed") {
      throw new Error(completion.errorMessage ?? "Planner failed");
    }

    console.log("[planner raw output]", JSON.stringify(text));
    return parsePlannerJson(text) ?? fallbackPlan(prompt);
  }

  private matchAgent(task: PlannerTask, agents: AgentRecord[]): AgentRecord | null {
    let best: { agent: AgentRecord; score: number } | null = null;

    for (const agent of agents) {
      let score = 0;
      const suggestedRaw = task.suggested_agent?.trim().toLowerCase();

      if (suggestedRaw) {
        const suggestedSlug = slugify(suggestedRaw);
        const agentSlug = agent.slug.toLowerCase();
        const agentName = agent.name.toLowerCase();

        if (agentSlug === suggestedRaw || agentSlug === suggestedSlug) {
          score += 10;
        } else if (agentName === suggestedRaw) {
          score += 8;
        } else if (agentSlug.includes(suggestedSlug) || agentName.includes(suggestedRaw)) {
          score += 5;
        }
      }

      const capabilityHints = buildCapabilityHints(task);
      const agentValues = [agent.name, agent.slug, ...(agent.capabilities ?? [])]
        .join(" ")
        .toLowerCase();

      if (task.task_type !== "general" && agentValues.includes(task.task_type)) {
        score += 3;
      }

      // Cap keyword hits at 3 so a keyword-rich generalist cannot outrank an exact name match (+8)
      const keywordHits = capabilityHints.filter((hint) => agentValues.includes(hint)).length;
      score += Math.min(keywordHits, 3) * 2;

      if (best === null || score > best.score) {
        best = { agent, score };
      }
    }

    if (best && best.score > 0) {
      return best.agent;
    }
    return this.agentsService.getDefaultAgent();
  }

  async resumeWatchingPlans(): Promise<void> {
    if (this.closed) {
      return;
    }
    const watchingPlans = this.messagesService.listWatchingPlanMessages();
    if (watchingPlans.length === 0) {
      return;
    }

    const toPoll: typeof watchingPlans = [];
    for (const planMessage of watchingPlans) {
      if (!this.activePlanSchedulers.has(planMessage.id)) {
        // Scheduler was lost on server restart — fail fast rather than leaving the plan stuck
        this.handleRestartInterruption(planMessage);
      } else {
        toPoll.push(planMessage);
      }
    }

    await Promise.allSettled(
      toPoll.map((planMessage) => this.pollOrchestratedRuns(planMessage.id)),
    );
    if (this.messagesService.listWatchingPlanMessages().length > 0) {
      this.ensureWatcherScheduler();
    }
  }

  private ensureWatcherScheduler(): void {
    if (this.closed) {
      return;
    }
    if (this.watcherTimer || this.watcherTickInFlight) {
      return;
    }
    if (this.messagesService.listWatchingPlanMessages().length === 0) {
      return;
    }

    this.watcherTimer = setTimeout(() => {
      this.watcherTimer = null;
      void this.runWatcherTick();
    }, this.deps.pollIntervalMs ?? 250);
  }

  private persistPlanState(
    state: ActivePlanScheduler,
    planId: string,
    summary: string,
    sourceMessageId?: string,
  ): void {
    const current = this.messagesService.getById(state.planMessageId);
    const currentMetadata = current?.metadata_json ?? {};
    this.messagesService.updateMessageMetadata(state.planMessageId, {
      ...currentMetadata,
      planId: typeof currentMetadata.planId === "string" ? currentMetadata.planId : planId,
      sourceMessageId: sourceMessageId ?? currentMetadata.sourceMessageId ?? null,
      summary,
      items: Array.from(state.itemsByPlannerTaskId.values()).sort((a, b) => a.index - b.index),
      runIds: Array.from(state.runIds.values()),
      watchStatus: "watching",
    });
  }

  private async syncSchedulerState(planMessageId: string): Promise<void> {
    const state = this.activePlanSchedulers.get(planMessageId);
    if (!state) {
      return;
    }

    for (const [taskRecordId, plannerTaskId] of state.plannerTaskIdByTaskRecordId.entries()) {
      if (state.seenTerminalTaskIds.has(taskRecordId)) {
        continue;
      }
      const task = this.tasksService.getById(taskRecordId);
      if (!task) {
        continue;
      }
      if (task.status === "failed" || task.status === "interrupted") {
        state.seenTerminalTaskIds.add(taskRecordId);
        await state.scheduler.notifyFailed(plannerTaskId);
        continue;
      }
      if (task.status === "blocked") {
        state.seenTerminalTaskIds.add(taskRecordId);
      }
    }
  }

  private async runWatcherTick(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.watcherTickInFlight) {
      return;
    }

    this.watcherTickInFlight = true;
    const tickStartedAt = Date.now();
    try {
      const watchingPlans = this.messagesService.listWatchingPlanMessages();
      await Promise.allSettled(
        watchingPlans.map((planMessage) => this.pollOrchestratedRuns(planMessage.id)),
      );
    } finally {
      const durationMs = Date.now() - tickStartedAt;
      if (durationMs >= SLOW_WATCHER_TICK_MS) {
        console.log(
          `[watcher slow tick] watched=${this.messagesService.listWatchingPlanMessages().length} duration=${durationMs}ms`,
        );
      }
      this.watcherTickInFlight = false;
      if (!this.closed && this.messagesService.listWatchingPlanMessages().length > 0) {
        this.ensureWatcherScheduler();
      }
    }
  }

  close(): void {
    this.closed = true;
    this.activePlanSchedulers.clear();
    if (this.watcherTimer) {
      clearTimeout(this.watcherTimer);
      this.watcherTimer = null;
    }
  }

  private async pollOrchestratedRuns(planMessageId: string): Promise<boolean> {
    const pollStartedAt = Date.now();
    await this.syncSchedulerState(planMessageId);
    const state = this.activePlanSchedulers.get(planMessageId);
    const planMessage = this.messagesService.getById(planMessageId);
    if (!planMessage) {
      return true;
    }

    const metadata = planMessage.metadata_json ?? {};
    if (
      metadata.watchStatus === "completed" ||
      metadata.watchStatus === "blocked" ||
      metadata.watchStatus === "timed_out"
    ) {
      return true;
    }

    if (!state) {
      const runIds = Array.isArray(metadata.runIds)
        ? metadata.runIds.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const runs = runIds
        .map((runId) => this.runManager.getRun(runId))
        .filter((run): run is NonNullable<ReturnType<RunManager["getRun"]>> => Boolean(run));
      const terminalStatuses = new Set<RunStatus>(["completed", "failed", "interrupted"]);
      if (runs.length !== runIds.length || !runs.every((run) => terminalStatuses.has(run.status))) {
        return this.handleWatchTimeout(planMessage, metadata, runIds);
      }
      const failedRuns = runs.filter((run) => run.status !== "completed");
      if (failedRuns.length > 0) {
        this.messagesService.updateMessageMetadata(planMessageId, {
          ...metadata,
          watchStatus: "blocked",
          failedRunIds: failedRuns.map((run) => run.id),
        });
        return true;
      }
      return true;
    }

    const runIds = Array.from(state.runIds);
    if (runIds.length === 0) {
      return this.handleWatchTimeout(planMessage, metadata, runIds);
    }

    const runs = runIds
      .map((runId) => this.runManager.getRun(runId))
      .filter((run): run is NonNullable<ReturnType<RunManager["getRun"]>> => Boolean(run));
    if (runs.length !== runIds.length) {
      return this.handleWatchTimeout(planMessage, metadata, runIds);
    }

    let hasRunningRun = false;
    let hasMergeReview = false;

    for (const run of runs) {
      if (!run.task_id || state.seenTerminalTaskIds.has(run.task_id)) {
        continue;
      }

      const plannerTaskId = state.plannerTaskIdByTaskRecordId.get(run.task_id);
      const item = plannerTaskId ? state.itemsByPlannerTaskId.get(plannerTaskId) : null;
      if (item) {
        item.status = run.status;
      }

      if (run.status === "queued" || run.status === "running") {
        hasRunningRun = true;
        continue;
      }

      if (run.status === "failed" || run.status === "interrupted") {
        if (plannerTaskId) {
          state.seenTerminalTaskIds.add(run.task_id!);
          await state.scheduler.notifyFailed(plannerTaskId);
          const failedContext = state.taskContextByPlannerTaskId.get(plannerTaskId);
          if (failedContext) {
            this.messagesService.createMessage({
              conversationId: state.conversationId,
              senderType: "orchestrator",
              content: `${failedContext.plannerTask.title} failed`,
              messageType: "system",
              metadata: {
                planMessageId: state.planMessageId,
                taskId: run.task_id,
                plannerTaskId,
                progressType: "task_failed",
              },
            });
          }
        }
        continue;
      }

      if (run.status !== "completed") {
        continue;
      }

      if (!plannerTaskId || !this.deps.mergeService) {
        continue;
      }

      const context = state.taskContextByPlannerTaskId.get(plannerTaskId);
      if (!context) {
        continue;
      }

      let mergeRecord = this.deps.mergeService.getByRunId(run.id);
      if (!mergeRecord) {
        const result = this.deps.mergeService.mergeRunToMain(run.id);
        mergeRecord = result.merge;
      }

      if (mergeRecord.status === "auto_merged" || mergeRecord.status === "conflict_resolved") {
        const outputSummary = extractRunOutputSummary(this.runManager.getRun(run.id));
        if (item) {
          item.outputSummary = outputSummary;
        }
        writeTaskOutputArtifact({
          workspacePath: state.workspacePath,
          planId: state.planId,
          plannerTaskId,
          title: context.plannerTask.title,
          outputSummary,
        });
        this.tasksService.updateTaskStatus(context.taskRecordId, "completed");
        if (item) {
          item.status = "completed";
        }
        state.seenTerminalTaskIds.add(context.taskRecordId);
        this.persistPlanState(state, metadata.planId as string, String(metadata.summary ?? ""), metadata.sourceMessageId as string | undefined);
        // Progress message — only on terminal states (not on start) to avoid double-counting
        this.messagesService.createMessage({
          conversationId: state.conversationId,
          senderType: "orchestrator",
          content: `${context.plannerTask.title} completed`,
          messageType: "system",
          metadata: {
            planMessageId: state.planMessageId,
            taskId: context.taskRecordId,
            plannerTaskId,
            progressType: "task_completed",
          },
        });
        await state.scheduler.notifyCompleted(plannerTaskId);
        continue;
      }

      if (mergeRecord.status === "needs_approval") {
        hasMergeReview = true;
        this.tasksService.updateTaskStatus(context.taskRecordId, "in_review");
        if (item) {
          item.status = "in_review";
        }
        if (!mergeRecord.approvalId && this.deps.approvalService) {
          const reviewMessageId = this.createConflictReviewMessage(
            planMessage.id,
            planMessage.conversation_id,
            run.id,
            mergeRecord.conflicts,
          );
          const approval = this.deps.approvalService.create({
            conversationId: planMessage.conversation_id,
            runId: run.id,
            taskId: run.task_id,
            assignmentId: run.assignment_id,
            actionType: "resolve_conflicts",
            title: "Resolve Merge Conflicts",
            description: `${mergeRecord.conflicts.length} conflict file(s) need review before merge.`,
            payload: {
              runId: run.id,
              reviewMessageId,
              mergeStatus: mergeRecord.status,
              conflicts: mergeRecord.conflicts.map((conflict) => ({
                filePath: conflict.filePath,
                llmAvailable: conflict.llmAvailable,
              })),
            },
          });
          this.deps.mergeService.attachApproval(run.id, approval.id);
        }
        this.persistPlanState(state, metadata.planId as string, String(metadata.summary ?? ""), metadata.sourceMessageId as string | undefined);
        continue;
      }

      if (mergeRecord.status === "failed") {
        this.tasksService.updateTaskStatus(context.taskRecordId, "blocked");
        if (item) {
          item.status = "blocked";
        }
      }
    }

    const durationMs = Date.now() - pollStartedAt;
    if (durationMs >= SLOW_PLAN_POLL_MS) {
      console.log(
        `[watcher slow plan] plan=${planMessageId} runs=${runIds.length} duration=${durationMs}ms`,
      );
    }
    if (hasRunningRun) {
      return this.handleWatchTimeout(planMessage, metadata, runIds);
    }
    return hasMergeReview;
  }

  private createConflictReviewMessage(
    planMessageId: string,
    conversationId: string,
    runId: string,
    conflictFiles: MergeConflictFile[],
  ): string {
    const branchName = this.runManager.getRunWorkspace(runId)?.branch_name ?? null;

    const message = this.messagesService.createMessage({
      conversationId,
      senderType: "orchestrator",
      content: `Run ${runId.slice(0, 8)} 检测到 ${conflictFiles.length} 个合并冲突文件，等待审查后继续合并。`,
      messageType: "conflict_review",
      metadata: {
        planMessageId,
        runId,
        branchName,
        conflictFiles,
      },
    });
    return message.id;
  }

  private computePlanMaxWatchMs(agents: AgentRecord[]): number {
    const longestRunTimeoutMs = agents.reduce((maxTimeout, agent) => {
      return Math.max(maxTimeout, this.getAgentRunTimeoutMs(agent));
    }, DEFAULT_RUN_TIMEOUT_MS);

    return Math.max(
      MIN_WATCH_TIMEOUT_MS,
      Math.ceil(longestRunTimeoutMs * 1.5),
    );
  }

  private getAgentRunTimeoutMs(agent: AgentRecord): number {
    const config = agent.config_json ?? {};
    const candidates = [
      config.timeoutMs,
      config.timeout_ms,
      config.maxExecutionMs,
      config.max_execution_ms,
      config.executionTimeoutMs,
      config.execution_timeout_ms,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }

    return DEFAULT_RUN_TIMEOUT_MS;
  }

  private async handleWatchTimeout(
    planMessage: NonNullable<ReturnType<MessagesService["getById"]>>,
    metadata: Record<string, unknown>,
    runIds: string[],
  ): Promise<boolean> {
    const watchStartedAt =
      typeof metadata.watchStartedAt === "string"
        ? Date.parse(metadata.watchStartedAt)
        : Number.NaN;
    const maxWatchMs =
      typeof metadata.maxWatchMs === "number" && Number.isFinite(metadata.maxWatchMs)
        ? metadata.maxWatchMs
        : null;
    if (!Number.isFinite(watchStartedAt) || !maxWatchMs) {
      return false;
    }
    if (Date.now() - watchStartedAt < maxWatchMs) {
      return false;
    }

    const cancelledApprovalIds = this.cancelWatchingApprovals(
      planMessage.conversation_id,
      runIds,
      `Watcher timed out for plan ${planMessage.id}.`,
    );
    this.messagesService.createMessage({
      conversationId: planMessage.conversation_id,
      senderType: "orchestrator",
      content: `计划监听超时，自动汇聚已停止。请检查仍在运行的子任务后再继续。`,
      messageType: "system",
      metadata: {
        planMessageId: planMessage.id,
        runIds,
        cancelledApprovalIds,
        watchStatus: "timed_out",
      },
    });
    this.messagesService.updateMessageMetadata(planMessage.id, {
      ...metadata,
      watchStatus: "timed_out",
      timedOutAt: new Date().toISOString(),
      cancelledApprovalIds,
    });
    this.activePlanSchedulers.delete(planMessage.id);
    return true;
  }

  private handleRestartInterruption(planMessage: MessageRecord): void {
    const metadata = planMessage.metadata_json ?? {};
    const runIds = Array.isArray(metadata.runIds)
      ? metadata.runIds.filter((id): id is string => typeof id === "string")
      : [];
    const cancelledApprovalIds = this.cancelWatchingApprovals(planMessage.conversation_id, runIds, "Service restarted.");
    this.messagesService.updateMessageMetadata(planMessage.id, {
      ...metadata,
      watchStatus: "timed_out",
      timedOutAt: new Date().toISOString(),
      restartInterrupted: true,
      cancelledApprovalIds,
    });
    this.messagesService.createMessage({
      conversationId: planMessage.conversation_id,
      senderType: "orchestrator",
      content: "服务重启，计划监听中断，请重新触发任务。",
      messageType: "system",
      metadata: { planMessageId: planMessage.id },
    });
  }

  private cancelWatchingApprovals(
    conversationId: string,
    runIds: string[],
    reason: string,
  ): string[] {
    if (!this.deps.approvalService?.cancel) {
      return [];
    }

    return this.deps.approvalService
      .listByConversation(conversationId)
      .filter((approval) => approval.runId && runIds.includes(approval.runId))
      .filter((approval) => approval.status === "pending" || approval.status === "approved")
      .map((approval) => {
        this.deps.approvalService?.cancel?.(approval.id, reason);
        return approval.id;
      });
  }
}
