import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import { AgentRuntimeRecord, RuntimeMode, RuntimeStatus } from "../../shared/types.js";

const nowIso = () => new Date().toISOString();

function parseRuntime(row: Record<string, unknown>): AgentRuntimeRecord {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    mode: row.mode as RuntimeMode,
    provider: String(row.provider),
    status: row.status as RuntimeStatus,
    owner_id: row.owner_id === null ? null : String(row.owner_id),
    runtime_identity:
      row.runtime_identity === null ? null : String(row.runtime_identity),
    last_heartbeat_at:
      row.last_heartbeat_at === null ? null : String(row.last_heartbeat_at),
    metadata_json: row.metadata_json
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export class AgentRuntimesService {
  constructor(private readonly database: DatabaseClient) {}

  ensureLocalRuntime(agentId: string, provider: string): AgentRuntimeRecord {
    const existing = this.getDefaultForAgent(agentId);
    if (existing) {
      if (existing.status !== "online") {
        this.touch(existing.id, "online");
        return this.getById(existing.id)!;
      }
      return existing;
    }

    const now = nowIso();
    const record: AgentRuntimeRecord = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      mode: "local",
      provider,
      status: "online",
      owner_id: null,
      runtime_identity: `${provider}:local`,
      last_heartbeat_at: now,
      metadata_json: null,
      created_at: now,
      updated_at: now,
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO agent_runtimes (
        id, agent_id, mode, provider, status, owner_id,
        runtime_identity, last_heartbeat_at, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.agent_id,
      record.mode,
      record.provider,
      record.status,
      record.owner_id,
      record.runtime_identity,
      record.last_heartbeat_at,
      record.metadata_json ? JSON.stringify(record.metadata_json) : null,
      record.created_at,
      record.updated_at,
    );

    return record;
  }

  getDefaultForAgent(agentId: string): AgentRuntimeRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agent_runtimes
      WHERE agent_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(agentId) as Record<string, unknown> | undefined;
    return row ? parseRuntime(row) : null;
  }

  getById(id: string): AgentRuntimeRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agent_runtimes
      WHERE id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? parseRuntime(row) : null;
  }

  touch(id: string, status: RuntimeStatus): void {
    const now = nowIso();
    const stmt = this.database.db.prepare(`
      UPDATE agent_runtimes
      SET status = ?, last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, now, now, id);
  }
}
