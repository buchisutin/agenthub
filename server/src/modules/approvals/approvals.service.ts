import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import {
  ApprovalRequest,
  ApprovalRequestRecord,
  ApprovalStatus,
  CreateApprovalInput,
} from "../../shared/types.js";

const nowIso = () => new Date().toISOString();

function recordToApproval(record: ApprovalRequestRecord): ApprovalRequest {
  return {
    id: record.id,
    conversationId: record.conversation_id,
    runId: record.run_id,
    taskId: record.task_id,
    assignmentId: record.assignment_id,
    actionType: record.action_type as ApprovalRequest["actionType"],
    status: record.status as ApprovalRequest["status"],
    title: record.title,
    description: record.description,
    payload: record.payload_json ? JSON.parse(record.payload_json) as Record<string, unknown> : null,
    result: record.result_json ? JSON.parse(record.result_json) as Record<string, unknown> : null,
    errorMessage: record.error_message,
    createdAt: record.created_at,
    decidedAt: record.decided_at,
    executedAt: record.executed_at,
  };
}

export class ApprovalService {
  constructor(private readonly database: DatabaseClient) {}

  create(input: CreateApprovalInput): ApprovalRequest {
    const now = nowIso();
    const record: ApprovalRequestRecord = {
      id: crypto.randomUUID(),
      conversation_id: input.conversationId,
      run_id: input.runId ?? null,
      task_id: input.taskId ?? null,
      assignment_id: input.assignmentId ?? null,
      action_type: input.actionType,
      status: "pending",
      title: input.title,
      description: input.description ?? null,
      payload_json: input.payload ? JSON.stringify(input.payload) : null,
      result_json: null,
      error_message: null,
      created_at: now,
      decided_at: null,
      executed_at: null,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO approval_requests (
        id, conversation_id, run_id, task_id, assignment_id,
        action_type, status, title, description, payload_json,
        result_json, error_message, created_at, decided_at, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.conversation_id,
      record.run_id,
      record.task_id,
      record.assignment_id,
      record.action_type,
      record.status,
      record.title,
      record.description,
      record.payload_json,
      record.result_json,
      record.error_message,
      record.created_at,
      record.decided_at,
      record.executed_at,
    );

    return recordToApproval(record);
  }

  getById(id: string): ApprovalRequest | null {
    const stmt = this.database.db.prepare("SELECT * FROM approval_requests WHERE id = ?");
    const row = stmt.get(id) as ApprovalRequestRecord | undefined;
    return row ? recordToApproval(row) : null;
  }

  listByConversation(conversationId: string): ApprovalRequest[] {
    const stmt = this.database.db.prepare(`
      SELECT * FROM approval_requests
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `);
    return (stmt.all(conversationId) as unknown as ApprovalRequestRecord[]).map(recordToApproval);
  }

  listByRunId(runId: string): ApprovalRequest[] {
    const stmt = this.database.db.prepare(`
      SELECT * FROM approval_requests
      WHERE run_id = ?
      ORDER BY created_at ASC
    `);
    return (stmt.all(runId) as unknown as ApprovalRequestRecord[]).map(recordToApproval);
  }

  listByConversationAndStatus(
    conversationId: string,
    status: ApprovalStatus,
  ): ApprovalRequest[] {
    const stmt = this.database.db.prepare(`
      SELECT * FROM approval_requests
      WHERE conversation_id = ? AND status = ?
      ORDER BY created_at ASC
    `);
    return (stmt.all(conversationId, status) as unknown as ApprovalRequestRecord[]).map(recordToApproval);
  }

  approve(id: string): ApprovalRequest {
    const approval = this.getById(id);
    if (!approval) {
      throw Object.assign(new Error("Approval request not found"), { statusCode: 404 });
    }
    if (approval.status !== "pending") {
      throw Object.assign(
        new Error(`Cannot approve approval with status ${approval.status}`),
        { statusCode: 400 },
      );
    }

    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE approval_requests
      SET status = ?, decided_at = ?
      WHERE id = ?
    `);
    stmt.run("approved", now, id);

    return { ...approval, status: "approved", decidedAt: now };
  }

  reject(id: string): ApprovalRequest {
    const approval = this.getById(id);
    if (!approval) {
      throw Object.assign(new Error("Approval request not found"), { statusCode: 404 });
    }
    if (approval.status !== "pending") {
      throw Object.assign(
        new Error(`Cannot reject approval with status ${approval.status}`),
        { statusCode: 400 },
      );
    }

    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE approval_requests
      SET status = ?, decided_at = ?
      WHERE id = ?
    `);
    stmt.run("rejected", now, id);

    return { ...approval, status: "rejected", decidedAt: now };
  }

  cancel(id: string, reason?: string): ApprovalRequest {
    const approval = this.getById(id);
    if (!approval) {
      throw Object.assign(new Error("Approval request not found"), { statusCode: 404 });
    }
    if (approval.status !== "pending" && approval.status !== "approved") {
      throw Object.assign(
        new Error(`Cannot cancel approval with status ${approval.status}`),
        { statusCode: 400 },
      );
    }

    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE approval_requests
      SET status = ?, error_message = ?, decided_at = ?
      WHERE id = ?
    `);
    stmt.run("cancelled", reason ?? approval.errorMessage ?? null, now, id);

    return {
      ...approval,
      status: "cancelled",
      errorMessage: reason ?? approval.errorMessage,
      decidedAt: now,
    };
  }

  markExecuted(id: string, result?: Record<string, unknown> | null): ApprovalRequest {
    const approval = this.getById(id);
    if (!approval) {
      throw Object.assign(new Error("Approval request not found"), { statusCode: 404 });
    }
    if (approval.status !== "approved") {
      throw Object.assign(
        new Error(`Cannot execute approval with status ${approval.status}`),
        { statusCode: 400 },
      );
    }

    const now = nowIso();
    const resultJson = result ? JSON.stringify(result) : null;
    const stmt = this.database.db.prepare(`
      UPDATE approval_requests
      SET status = ?, result_json = ?, executed_at = ?
      WHERE id = ?
    `);
    stmt.run("executed", resultJson, now, id);

    return {
      ...approval,
      status: "executed",
      result: result ?? null,
      executedAt: now,
    };
  }

  markFailed(id: string, errorMessage: string): ApprovalRequest {
    const approval = this.getById(id);
    if (!approval) {
      throw Object.assign(new Error("Approval request not found"), { statusCode: 404 });
    }
    if (approval.status !== "approved") {
      throw Object.assign(
        new Error(`Cannot mark failed for approval with status ${approval.status}`),
        { statusCode: 400 },
      );
    }

    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE approval_requests
      SET status = ?, error_message = ?, executed_at = ?
      WHERE id = ?
    `);
    stmt.run("failed", errorMessage, now, id);

    return {
      ...approval,
      status: "failed",
      errorMessage,
      executedAt: now,
    };
  }
}
