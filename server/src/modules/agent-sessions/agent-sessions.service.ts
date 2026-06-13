import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import {
  AgentSessionLifecycleStatus,
  AgentSessionRecord,
} from "../../shared/types.js";

const nowIso = () => new Date().toISOString();

function parseSession(row: Record<string, unknown>): AgentSessionRecord {
  return {
    id: String(row.id),
    task_id: row.task_id === null ? null : String(row.task_id),
    conversation_id:
      row.conversation_id === null ? null : String(row.conversation_id),
    agent_id: String(row.agent_id),
    runtime_id: String(row.runtime_id),
    provider_session_id:
      row.provider_session_id === null ? null : String(row.provider_session_id),
    status: row.status as AgentSessionLifecycleStatus,
    invalid_reason:
      row.invalid_reason === null ? null : String(row.invalid_reason),
    metadata_json: row.metadata_json
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : null,
    created_at: String(row.created_at),
    last_resumed_at:
      row.last_resumed_at === null ? null : String(row.last_resumed_at),
    updated_at: String(row.updated_at),
  };
}

export class AgentSessionsService {
  constructor(private readonly database: DatabaseClient) {}

  getLatestByConversationAgent(
    conversationId: string,
    agentId: string,
  ): AgentSessionRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agent_sessions
      WHERE conversation_id = ? AND agent_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(conversationId, agentId) as Record<string, unknown> | undefined;
    return row ? parseSession(row) : null;
  }

  getById(id: string): AgentSessionRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agent_sessions
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? parseSession(row) : null;
  }

  createPlaceholder(input: {
    taskId: string | null;
    conversationId: string;
    agentId: string;
    runtimeId: string;
  }): AgentSessionRecord {
    const now = nowIso();
    const record: AgentSessionRecord = {
      id: crypto.randomUUID(),
      task_id: input.taskId,
      conversation_id: input.conversationId,
      agent_id: input.agentId,
      runtime_id: input.runtimeId,
      provider_session_id: null,
      status: "none",
      invalid_reason: null,
      metadata_json: null,
      created_at: now,
      last_resumed_at: null,
      updated_at: now,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO agent_sessions (
        id, task_id, conversation_id, agent_id, runtime_id, provider_session_id,
        status, invalid_reason, metadata_json, created_at, last_resumed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.task_id,
      record.conversation_id,
      record.agent_id,
      record.runtime_id,
      record.provider_session_id,
      record.status,
      record.invalid_reason,
      record.metadata_json ? JSON.stringify(record.metadata_json) : null,
      record.created_at,
      record.last_resumed_at,
      record.updated_at,
    );

    return record;
  }

  bindProviderSession(id: string, providerSessionId: string): void {
    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE agent_sessions
      SET provider_session_id = ?,
          status = 'active',
          invalid_reason = NULL,
          last_resumed_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(providerSessionId, now, now, id);
  }

  markStatus(
    id: string,
    status: AgentSessionLifecycleStatus,
    invalidReason?: string | null,
  ): void {
    const stmt = this.database.db.prepare(`
      UPDATE agent_sessions
      SET status = ?,
          invalid_reason = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, invalidReason ?? null, nowIso(), id);
  }

  closeLatestForConversation(conversationId: string): void {
    const stmt = this.database.db.prepare(`
      UPDATE agent_sessions
      SET status = 'closed',
          updated_at = ?
      WHERE id = (
        SELECT id
        FROM agent_sessions
        WHERE conversation_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      )
    `);
    stmt.run(nowIso(), conversationId);
  }
}
