import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import {
  ApprovalRequest,
  ConversationTimelineItem,
  MessageRecord,
  MessageSenderType,
  MessageType,
  Mention,
  RunDetail,
  TaskAssignmentRecord,
  TaskPlan,
  TaskRecord,
  TaskType,
} from "../../shared/types.js";
import { ApprovalService } from "../approvals/approvals.service.js";
import { AssignmentsService } from "../assignments/assignments.service.js";
import { ConversationsService } from "../conversations/conversations.service.js";
import { RunsService } from "../runs/runs.service.js";
import { TasksService } from "../tasks/tasks.service.js";

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseMentions(value: unknown): Mention[] | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed
      .map((mention) => (mention && typeof mention === "object" ? mention : null))
      .filter((mention): mention is Record<string, unknown> => Boolean(mention))
      .map((mention) => ({
        type: (
          mention.type === "agent" ||
          mention.type === "orchestrator" ||
          mention.type === "unknown"
            ? mention.type
            : "unknown"
        ) as Mention["type"],
        targetId:
          typeof mention.targetId === "string"
            ? mention.targetId
            : typeof mention.target_id === "string"
              ? mention.target_id
              : null,
        raw: typeof mention.raw === "string" ? mention.raw : "",
        start: typeof mention.start === "number" ? mention.start : undefined,
        end: typeof mention.end === "number" ? mention.end : undefined,
      }))
      .filter((mention) => mention.raw);
  } catch {
    return null;
  }
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
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

export class MessagesService {
  private readonly approvalService?: ApprovalService;

  constructor(
    private readonly database: DatabaseClient,
    private readonly conversationsService: ConversationsService,
    private readonly runsService: RunsService,
    private readonly tasksService: TasksService,
    private readonly assignmentsService: AssignmentsService,
    approvalService?: ApprovalService,
  ) {
    this.approvalService = approvalService;
  }

  createMessage(input: {
    conversationId: string;
    senderType: MessageSenderType;
    senderId?: string | null;
    content: string;
    messageType: MessageType;
    mentions?: Mention[] | null;
    metadata?: Record<string, unknown> | null;
  }): MessageRecord {
    const record: MessageRecord = {
      id: crypto.randomUUID(),
      conversation_id: input.conversationId,
      sender_type: input.senderType,
      sender_id: input.senderId ?? null,
      content: input.content,
      message_type: input.messageType,
      mentions: input.mentions ?? null,
      metadata_json: input.metadata ?? null,
      created_at: nowIso(),
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_type, sender_id, content, message_type,
        mentions_json, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.conversation_id,
      record.sender_type,
      record.sender_id,
      record.content,
      record.message_type,
      record.mentions ? JSON.stringify(record.mentions) : null,
      record.metadata_json ? JSON.stringify(record.metadata_json) : null,
      record.created_at,
    );
    this.conversationsService.touch(record.conversation_id);
    return record;
  }

  updateMessageMetadata(
    messageId: string,
    metadata: Record<string, unknown>,
    content?: string,
  ): MessageRecord | null {
    const current = this.getById(messageId);
    if (!current) {
      return null;
    }

    const stmt = this.database.db.prepare(`
      UPDATE messages
      SET metadata_json = ?,
          content = ?
      WHERE id = ?
    `);
    stmt.run(
      JSON.stringify(metadata),
      content ?? current.content,
      messageId,
    );
    this.conversationsService.touch(current.conversation_id);
    return this.getById(messageId);
  }

  getById(messageId: string): MessageRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM messages
      WHERE id = ?
    `);
    const row = stmt.get(messageId) as Record<string, unknown> | undefined;
    return row ? this.parseMessage(row) : null;
  }

  listMessagesByConversation(conversationId: string): MessageRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    return stmt
      .all(conversationId)
      .map((row) => this.parseMessage(row as Record<string, unknown>));
  }

  listWatchingPlanMessages(): MessageRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM messages
      WHERE message_type = 'plan'
      ORDER BY created_at ASC
    `);
    return stmt
      .all()
      .map((row) => this.parseMessage(row as Record<string, unknown>))
      .filter((message) => message.metadata_json?.watchStatus === "watching");
  }

  getConversationTimeline(conversationId: string): ConversationTimelineItem[] {
    const messages = this.listMessagesByConversation(conversationId);
    const runs = this.runsService.listByConversationId(conversationId);

    const items: Array<ConversationTimelineItem & { at: string }> = [];

    for (const message of messages) {
      if (message.message_type === "plan") {
        const restored = this.parsePlan(message);
        const plan = restored?.plan ?? null;
        if (plan) {
          items.push({
            type: "plan",
            message,
            plan,
            tasks: restored?.tasks ?? [],
            assignments: restored?.assignments ?? [],
            at: message.created_at,
          });
          continue;
        }
      }

      items.push({
        type: "message",
        message,
        at: message.created_at,
      });
    }

    for (const run of runs) {
      items.push({
        type: "run",
        run,
        at: run.started_at,
      });
    }

    if (this.approvalService) {
      const confirmations = this.approvalService.listByConversation(conversationId);
      for (const approval of confirmations) {
        items.push({
          type: "confirmation" as const,
          approval,
          at: approval.createdAt,
        });
      }
    }

    return items
      .sort((a, b) => {
        const timeDiff = new Date(a.at).getTime() - new Date(b.at).getTime();
        if (timeDiff !== 0) {
          return timeDiff;
        }
        const rank = (item: ConversationTimelineItem) => {
          if (item.type === "message") {
            return item.message.message_type === "plan" ? 1 : 0;
          }
          if (item.type === "plan") {
            return 1;
          }
          if (item.type === "run") {
            return 2;
          }
          return 3; // confirmation
        };
        const rankDiff = rank(a) - rank(b);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        if (a.type === "message" && b.type === "message") {
          return a.message.id.localeCompare(b.message.id);
        }
        if (a.type === "plan" && b.type === "plan") {
          return a.message.id.localeCompare(b.message.id);
        }
        if (a.type === "run" && b.type === "run") {
          return a.run.id.localeCompare(b.run.id);
        }
        if (a.type === "plan" && b.type === "message") {
          return a.message.id.localeCompare(b.message.id);
        }
        if (a.type === "message" && b.type === "plan") {
          return a.message.id.localeCompare(b.message.id);
        }
        return 0;
      })
      .map(({ at: _at, ...item }) => item);
  }

  private parsePlan(
  message: MessageRecord,
  ): { plan: TaskPlan; tasks: TaskRecord[]; assignments: TaskAssignmentRecord[] } | null {
    const metadataPlan = this.parsePlanFromMetadata(message);
    try {
      const tasks = this.tasksService.listForPlan(message.id);
      if (tasks.length === 0) {
        return metadataPlan;
      }

      const assignments = tasks.flatMap((task) => {
        try {
          return this.assignmentsService.listAssignmentsByTask(task.id);
        } catch {
          return [];
        }
      });
      const byTaskId = new Map(assignments.map((assignment) => [assignment.task_id, assignment]));
      const metadataItems = metadataPlan?.plan.items ?? [];
      const metadataByTaskId = new Map(
        metadataItems
          .filter((item) => item.taskId)
          .map((item) => [item.taskId, item]),
      );

      const items = tasks.map((task, index) => {
        const assignment = byTaskId.get(task.id);
        const fallbackItem = metadataByTaskId.get(task.id) ?? metadataItems[index] ?? null;
        const latestRun =
          assignment?.latest_run_id ? this.runsService.getById(assignment.latest_run_id) : null;
        const fallbackRunId =
          fallbackItem && typeof fallbackItem.runId === "string" ? fallbackItem.runId : "";
        const fallbackAssignmentId =
          fallbackItem && typeof fallbackItem.assignmentId === "string"
            ? fallbackItem.assignmentId
            : "";
        const fallbackAgentId =
          fallbackItem && typeof fallbackItem.assignedAgentId === "string"
            ? fallbackItem.assignedAgentId
            : "";
        const fallbackAgentName =
          fallbackItem && typeof fallbackItem.assignedAgentName === "string"
            ? fallbackItem.assignedAgentName
            : "";
        const legacyAffectedFiles = (() => {
          const raw = fallbackItem as unknown as Record<string, unknown> | null;
          return Array.isArray(raw?.affected_files)
            ? raw.affected_files.filter((entry): entry is string => typeof entry === "string")
            : [];
        })();
        const fallbackRaw = fallbackItem as unknown as Record<string, unknown> | null;
        const dependsOn =
          Array.isArray(fallbackItem?.dependsOn)
            ? fallbackItem.dependsOn.filter((entry): entry is string => typeof entry === "string")
            : Array.isArray(fallbackRaw?.depends_on)
              ? (fallbackRaw.depends_on as unknown[]).filter(
                  (entry): entry is string => typeof entry === "string",
                )
              : task.depends_on;
        const latestStatus =
          assignment?.status === "cancelled" || task.status === "cancelled"
            ? "cancelled"
            : latestRun?.status ??
              assignment?.status ??
              (task.status === "pending" ||
              task.status === "assigned" ||
              task.status === "running" ||
              task.status === "completed" ||
              task.status === "failed" ||
              task.status === "interrupted"
                ? task.status
                : fallbackItem?.status ?? "pending");

        return {
          index:
            fallbackItem && typeof fallbackItem.index === "number"
              ? fallbackItem.index
              : index + 1,
          plannerTaskId:
            typeof fallbackItem?.plannerTaskId === "string"
              ? fallbackItem.plannerTaskId
              : `t${index + 1}`,
          title: task.title || fallbackItem?.title || "Untitled task",
          description: task.description ?? fallbackItem?.description ?? "",
          taskType:
            task.task_type ??
            (typeof fallbackItem?.taskType === "string"
              ? fallbackItem.taskType
              : "general"),
          expectedOutput:
            task.expected_output ??
            (typeof fallbackItem?.expectedOutput === "string"
              ? fallbackItem.expectedOutput
              : ""),
          dependsOn,
          affectedFiles:
            Array.isArray(fallbackItem?.affectedFiles)
              ? fallbackItem.affectedFiles.filter((entry): entry is string => typeof entry === "string")
              : legacyAffectedFiles,
          suggestedAgent: fallbackItem?.suggestedAgent ?? null,
          assignedAgentId: assignment?.agent_id ?? fallbackAgentId,
          assignedAgentName: assignment
            ? this.getAgentName(assignment.agent_id)
            : fallbackAgentName,
          priority: task.priority ?? fallbackItem?.priority ?? 1,
          taskId: task.id,
          assignmentId: assignment?.id ?? fallbackAssignmentId,
          runId: assignment?.latest_run_id ?? fallbackRunId ?? null,
          status: latestStatus,
          outputSummary:
            typeof fallbackItem?.outputSummary === "string"
              ? fallbackItem.outputSummary
              : null,
        };
      });

      return {
        plan: {
          id:
            typeof message.metadata_json?.planId === "string"
              ? message.metadata_json.planId
              : metadataPlan?.plan.id ?? message.id,
          summary:
            (typeof message.metadata_json?.summary === "string" && message.metadata_json.summary) ||
            metadataPlan?.plan.summary ||
            message.content,
          items:
            items.filter((item) => item.assignmentId || item.runId || item.taskId).length > 0
              ? items.filter((item) => item.assignmentId || item.runId || item.taskId)
              : (metadataPlan?.plan.items ?? []),
          dagPreview:
            message.metadata_json?.dagPreview && typeof message.metadata_json.dagPreview === "object"
              ? message.metadata_json.dagPreview as TaskPlan["dagPreview"]
              : metadataPlan?.plan.dagPreview,
        },
        tasks,
        assignments,
      };
    } catch {
      return metadataPlan;
    }
  }

  private parsePlanFromMetadata(
    message: MessageRecord,
  ): { plan: TaskPlan; tasks: TaskRecord[]; assignments: TaskAssignmentRecord[] } | null {
    const metadata = message.metadata_json;
    if (!metadata) {
      return null;
    }
    const planId = typeof metadata.planId === "string" ? metadata.planId : null;
    const summary = typeof metadata.summary === "string" ? metadata.summary : null;
    const items = Array.isArray(metadata.items) ? metadata.items : null;
    if (!planId || !summary || !items) {
      return null;
    }

    return {
      plan: {
        id: planId,
        summary,
        dagPreview:
          metadata.dagPreview && typeof metadata.dagPreview === "object"
            ? metadata.dagPreview as TaskPlan["dagPreview"]
            : undefined,
        items: items
          .map((item) => (item && typeof item === "object" ? item : null))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item) => ({
            index: typeof item.index === "number" ? item.index : 0,
            plannerTaskId:
              typeof item.plannerTaskId === "string" ? item.plannerTaskId : undefined,
            title: typeof item.title === "string" ? item.title : "Untitled task",
            description:
              typeof item.description === "string" ? item.description : "",
            taskType:
              typeof item.taskType === "string"
                ? normalizeTaskType(item.taskType)
                : typeof item.task_type === "string"
                  ? normalizeTaskType(item.task_type)
                  : "general",
            expectedOutput:
              typeof item.expectedOutput === "string"
                ? item.expectedOutput
                : typeof item.expected_output === "string"
                  ? item.expected_output
                  : "",
            dependsOn:
              Array.isArray(item.dependsOn)
                ? item.dependsOn.filter((entry): entry is string => typeof entry === "string")
                : Array.isArray(item.depends_on)
                  ? item.depends_on.filter((entry): entry is string => typeof entry === "string")
                  : [],
            affectedFiles:
              Array.isArray(item.affectedFiles)
                ? item.affectedFiles.filter((entry): entry is string => typeof entry === "string")
                : Array.isArray(item.affected_files)
                  ? item.affected_files.filter((entry): entry is string => typeof entry === "string")
                  : [],
            suggestedAgent:
              typeof item.suggestedAgent === "string"
                ? item.suggestedAgent
                : typeof item.suggested_agent === "string"
                  ? item.suggested_agent
                  : null,
            assignedAgentId:
              typeof item.assignedAgentId === "string" ? item.assignedAgentId : "",
            assignedAgentName:
              typeof item.assignedAgentName === "string"
                ? item.assignedAgentName
                : "",
            priority: typeof item.priority === "number" ? item.priority : 1,
            taskId: typeof item.taskId === "string" ? item.taskId : "",
            assignmentId:
              typeof item.assignmentId === "string" ? item.assignmentId : "",
            runId: typeof item.runId === "string" && item.runId ? item.runId : null,
            status: (
              item.status === "queued" ||
              item.status === "running" ||
              item.status === "completed" ||
              item.status === "failed" ||
              item.status === "interrupted" ||
              item.status === "cancelled" ||
              item.status === "assigned" ||
              item.status === "pending"
                ? item.status
                : "queued"
            ) as TaskPlan["items"][number]["status"],
            outputSummary:
              typeof item.outputSummary === "string" ? item.outputSummary : null,
          }))
          .filter((item) => item.index > 0 && (item.runId || item.taskId)),
      },
      tasks: [],
      assignments: [],
    };
  }

  private parseMessage(row: Record<string, unknown>): MessageRecord {
    return {
      id: String(row.id),
      conversation_id: String(row.conversation_id),
      sender_type: row.sender_type as MessageSenderType,
      sender_id: row.sender_id === null ? null : String(row.sender_id),
      content: String(row.content),
      message_type: row.message_type as MessageType,
      mentions: parseMentions(row.mentions_json),
      metadata_json: parseMetadata(row.metadata_json),
      created_at: String(row.created_at),
    };
  }

  private getAgentName(agentId: string): string {
    const stmt = this.database.db.prepare(`
      SELECT name
      FROM agents
      WHERE id = ?
    `);
    const row = stmt.get(agentId) as { name?: string } | undefined;
    return row?.name ? String(row.name) : agentId;
  }
}
