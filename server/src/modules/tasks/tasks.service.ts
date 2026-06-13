import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import { TaskRecord, TaskStatus, TaskSummary, TaskType } from "../../shared/types.js";

const nowIso = () => new Date().toISOString();

function parseTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    conversation_id: row.conversation_id === null ? null : String(row.conversation_id),
    source_message_id:
      row.source_message_id === null ? null : String(row.source_message_id),
    plan_message_id:
      row.plan_message_id === null ? null : String(row.plan_message_id),
    parent_task_id:
      row.parent_task_id === null ? null : String(row.parent_task_id),
    depends_on:
      typeof row.depends_on_json === "string" && row.depends_on_json
        ? (JSON.parse(String(row.depends_on_json)) as string[])
        : [],
    title: String(row.title),
    description: row.description === null ? null : String(row.description),
    task_type: row.task_type === null ? null : (String(row.task_type) as TaskType),
    expected_output:
      row.expected_output === null ? null : String(row.expected_output),
    status: row.status as TaskStatus,
    priority: Number(row.priority ?? 1),
    workspace_id: row.workspace_id === null ? null : String(row.workspace_id),
    owner_id: row.owner_id === null ? null : String(row.owner_id),
    assignee_type: row.assignee_type === null ? null : String(row.assignee_type),
    assignee_id: row.assignee_id === null ? null : String(row.assignee_id),
    created_by_type:
      row.created_by_type === null ? null : (String(row.created_by_type) as TaskRecord["created_by_type"]),
    created_by_id: row.created_by_id === null ? null : String(row.created_by_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class TasksService {
  constructor(private readonly database: DatabaseClient) {}

  create(input: {
    title: string;
    description?: string | null;
    taskType?: TaskType | null;
    expectedOutput?: string | null;
    conversationId?: string | null;
    sourceMessageId?: string | null;
    planMessageId?: string | null;
    parentTaskId?: string | null;
    dependsOn?: string[];
    status?: TaskStatus;
    priority?: number;
    createdByType?: TaskRecord["created_by_type"];
    createdById?: string | null;
  }): TaskRecord {
    const now = nowIso();
    const record: TaskRecord = {
      id: crypto.randomUUID(),
      conversation_id: input.conversationId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      plan_message_id: input.planMessageId ?? null,
      parent_task_id: input.parentTaskId ?? null,
      depends_on: input.dependsOn ?? [],
      title: input.title,
      description: input.description ?? null,
      task_type: input.taskType ?? null,
      expected_output: input.expectedOutput ?? null,
      status: input.status ?? "todo",
      priority: input.priority ?? 1,
      workspace_id: null,
      owner_id: null,
      assignee_type: null,
      assignee_id: null,
      created_by_type: input.createdByType ?? null,
      created_by_id: input.createdById ?? null,
      created_at: now,
      updated_at: now,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO tasks (
        id, conversation_id, source_message_id, plan_message_id, parent_task_id,
        depends_on_json,
        title, description, task_type, expected_output, status, priority, workspace_id, owner_id,
        assignee_type, assignee_id, created_by_type, created_by_id,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.conversation_id,
      record.source_message_id,
      record.plan_message_id,
      record.parent_task_id,
      JSON.stringify(record.depends_on),
      record.title,
      record.description,
      record.task_type,
      record.expected_output,
      record.status,
      record.priority,
      record.workspace_id,
      record.owner_id,
      record.assignee_type,
      record.assignee_id,
      record.created_by_type,
      record.created_by_id,
      record.created_at,
      record.updated_at,
    );

    return record;
  }

  listByConversation(conversationId: string): TaskRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM tasks
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(conversationId).map((row) => parseTask(row as Record<string, unknown>));
  }

  listForPlan(planMessageId: string): TaskRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM tasks
      WHERE plan_message_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(planMessageId).map((row) => parseTask(row as Record<string, unknown>));
  }

  getSummaryById(id: string | null | undefined): TaskSummary | null {
    if (!id) {
      return null;
    }

    const stmt = this.database.db.prepare(`
      SELECT id, title, status
      FROM tasks
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      title: String(row.title),
      status: row.status as TaskStatus,
    };
  }

  getById(id: string): TaskRecord | null {
    const stmt = this.database.db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? parseTask(row) : null;
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const stmt = this.database.db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, nowIso(), taskId);
  }

  setTaskStatusForRerun(taskId: string, status: TaskStatus): void {
    this.updateTaskStatus(taskId, status);
  }
}
