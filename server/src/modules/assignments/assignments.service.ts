import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import {
  AssignmentStatus,
  TaskAssignmentRecord,
} from "../../shared/types.js";

const nowIso = () => new Date().toISOString();

function parseAssignment(row: Record<string, unknown>): TaskAssignmentRecord {
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    conversation_id: String(row.conversation_id),
    agent_id: String(row.agent_id),
    status: row.status as AssignmentStatus,
    latest_run_id: row.latest_run_id === null ? null : String(row.latest_run_id),
    assigned_by_type:
      row.assigned_by_type === null
        ? null
        : (String(row.assigned_by_type) as TaskAssignmentRecord["assigned_by_type"]),
    assigned_by_id:
      row.assigned_by_id === null ? null : String(row.assigned_by_id),
    assigned_at: String(row.assigned_at),
    started_at: row.started_at === null ? null : String(row.started_at),
    completed_at: row.completed_at === null ? null : String(row.completed_at),
    metadata_json:
      row.metadata_json === null ? null : (JSON.parse(String(row.metadata_json)) as Record<string, unknown>),
  };
}

export class AssignmentsService {
  constructor(private readonly database: DatabaseClient) {}

  createAssignment(input: {
    taskId: string;
    conversationId: string;
    agentId: string;
    status?: AssignmentStatus;
    assignedByType?: TaskAssignmentRecord["assigned_by_type"];
    assignedById?: string | null;
    metadata?: Record<string, unknown> | null;
  }): TaskAssignmentRecord {
    const now = nowIso();
    const record: TaskAssignmentRecord = {
      id: crypto.randomUUID(),
      task_id: input.taskId,
      conversation_id: input.conversationId,
      agent_id: input.agentId,
      status: input.status ?? "pending",
      latest_run_id: null,
      assigned_by_type: input.assignedByType ?? null,
      assigned_by_id: input.assignedById ?? null,
      assigned_at: now,
      started_at: null,
      completed_at: null,
      metadata_json: input.metadata ?? null,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO task_assignments (
        id, task_id, conversation_id, agent_id, status, latest_run_id,
        assigned_by_type, assigned_by_id, assigned_at, started_at, completed_at,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.task_id,
      record.conversation_id,
      record.agent_id,
      record.status,
      record.latest_run_id,
      record.assigned_by_type,
      record.assigned_by_id,
      record.assigned_at,
      record.started_at,
      record.completed_at,
      record.metadata_json ? JSON.stringify(record.metadata_json) : null,
    );
    return record;
  }

  updateAssignmentStatus(
    assignmentId: string,
    status: AssignmentStatus,
    latestRunId?: string | null,
  ): void {
    const now = nowIso();
    const startedAt = status === "running" ? now : null;
    const completedAt =
      status === "completed" ||
      status === "failed" ||
      status === "interrupted" ||
      status === "cancelled"
        ? now
        : null;

    const stmt = this.database.db.prepare(`
      UPDATE task_assignments
      SET status = ?,
          latest_run_id = COALESCE(?, latest_run_id),
          started_at = COALESCE(?, started_at),
          completed_at = ? 
      WHERE id = ?
    `);
    stmt.run(
      status,
      latestRunId ?? null,
      startedAt,
      completedAt,
      assignmentId,
    );
  }

  prepareAssignmentRerun(
    assignmentId: string,
    input: {
      agentId: string;
      latestRunId: string;
      status?: AssignmentStatus;
    },
  ): void {
    const stmt = this.database.db.prepare(`
      UPDATE task_assignments
      SET agent_id = ?,
          latest_run_id = ?,
          status = ?,
          started_at = NULL,
          completed_at = NULL
      WHERE id = ?
    `);
    stmt.run(
      input.agentId,
      input.latestRunId,
      input.status ?? "pending",
      assignmentId,
    );
  }

  getAssignment(assignmentId: string): TaskAssignmentRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM task_assignments
      WHERE id = ?
    `);
    const row = stmt.get(assignmentId) as Record<string, unknown> | undefined;
    return row ? parseAssignment(row) : null;
  }

  listAssignmentsByTask(taskId: string): TaskAssignmentRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM task_assignments
      WHERE task_id = ?
      ORDER BY assigned_at ASC
    `);
    return stmt.all(taskId).map((row) => parseAssignment(row as Record<string, unknown>));
  }

  listAssignmentsByConversation(conversationId: string): TaskAssignmentRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM task_assignments
      WHERE conversation_id = ?
      ORDER BY assigned_at ASC
    `);
    return stmt
      .all(conversationId)
      .map((row) => parseAssignment(row as Record<string, unknown>));
  }
}
