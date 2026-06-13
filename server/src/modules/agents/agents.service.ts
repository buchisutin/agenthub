import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import { EnvConfig } from "../../config/env.js";
import { AgentRecord } from "../../shared/types.js";
import { RuntimeRegistry } from "../../runtime/runtime-registry.js";

const nowIso = () => new Date().toISOString();

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    platform: String(row.platform),
    adapter_type: String(row.adapter_type),
    instructions: row.instructions === null ? null : String(row.instructions),
    status: row.status as AgentRecord["status"],
    capabilities: row.capabilities_json
      ? (JSON.parse(String(row.capabilities_json)) as string[])
      : null,
    config_json: row.config_json
      ? (JSON.parse(String(row.config_json)) as Record<string, unknown>)
      : null,
    enabled: Number(row.enabled ?? 1) === 1,
    is_default: Number(row.is_default ?? 0) === 1,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
  };
}

function normalizeCapabilities(capabilities?: string[] | null): string[] | null {
  if (!capabilities) {
    return null;
  }
  const normalized = capabilities
    .map((capability) => capability.trim())
    .filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

export class AgentsService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly env: EnvConfig,
    private readonly runtimeRegistry?: RuntimeRegistry,
  ) {}

  ensureDefaultClaudeAgent(): AgentRecord {
    const existingDefault = this.getDefaultAgent();
    if (existingDefault) {
      return existingDefault;
    }

    const existingClaude = this.listAgents({ includeDisabled: true }).find(
      (agent) => agent.slug === "claude-code" || agent.name === "claude-code",
    );
    if (existingClaude) {
      return this.setDefaultAgent(existingClaude.id);
    }

    return this.createAgent({
      name: "claude-code",
      slug: "claude-code",
      adapterType: "claude_cli",
      instructions: "Default general-purpose coding agent.",
      capabilities: ["text_generation", "command_execution", "file_editing"],
      enabled: true,
      isDefault: true,
      platform: "claude-cli",
      config_json: {
        command: this.env.claudeCommand,
        baseArgs: this.env.claudeBaseArgs,
        allowedTools: this.env.claudeAllowedTools,
        disallowedTools: this.env.claudeDisallowedTools,
      },
    });
  }

  ensureBuiltinCodexAgent(): AgentRecord {
    const existing = this.listAgents({ includeDisabled: true }).find(
      (agent) => agent.slug === "codex-cli" || agent.name === "codex-cli",
    );
    if (existing) {
      return existing;
    }

    return this.createAgent({
      name: "codex-cli",
      slug: "codex-cli",
      adapterType: "codex_cli",
      instructions: "OpenAI Codex CLI coding agent.",
      capabilities: ["text_generation", "command_execution", "file_editing"],
      enabled: true,
      isDefault: false,
      platform: "codex-cli",
      config_json: {
        command: this.env.codexCommand,
        baseArgs: this.env.codexBaseArgs,
      },
    });
  }

  listAgents(input: { includeDisabled?: boolean } = {}): AgentRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agents
      ${input.includeDisabled ? "" : "WHERE enabled = 1"}
      ORDER BY is_default DESC, created_at ASC
    `);
    return stmt.all().map((row) => parseAgent(row as Record<string, unknown>));
  }

  list(): AgentRecord[] {
    return this.listAgents();
  }

  getAgent(agentId: string): AgentRecord | null {
    const stmt = this.database.db.prepare(`SELECT * FROM agents WHERE id = ?`);
    const row = stmt.get(agentId) as Record<string, unknown> | undefined;
    return row ? parseAgent(row) : null;
  }

  getById(id: string): AgentRecord | null {
    return this.getAgent(id);
  }

  getDefaultAgent(): AgentRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT *
      FROM agents
      WHERE is_default = 1 AND enabled = 1
      ORDER BY updated_at DESC, created_at ASC
      LIMIT 1
    `);
    const row = stmt.get() as Record<string, unknown> | undefined;
    return row ? parseAgent(row) : null;
  }

  resolve(id?: string): AgentRecord | null {
    if (id) {
      const agent = this.getAgent(id);
      if (!agent || !agent.enabled) {
        return null;
      }
      return agent;
    }
    return this.getDefaultAgent();
  }

  resolveAgentByMention(slugOrName: string): AgentRecord | null {
    const normalized = slugOrName.trim().toLowerCase();
    const slug = slugify(normalized);
    return (
      this.listAgents().find(
        (agent) =>
          agent.slug.toLowerCase() === normalized ||
          agent.slug.toLowerCase() === slug ||
          agent.name.toLowerCase() === normalized,
      ) ?? null
    );
  }

  create(input: {
    name: string;
    platform: string;
    adapter_type: string;
    status?: AgentRecord["status"];
    capabilities?: string[] | null;
    config_json?: Record<string, unknown> | null;
    isDefault?: boolean;
  }): AgentRecord {
    return this.createAgent({
      name: input.name,
      adapterType: input.adapter_type,
      capabilities: input.capabilities ?? undefined,
      enabled: input.status !== "unavailable",
      isDefault: input.isDefault ?? false,
      platform: input.platform,
      config_json: input.config_json,
    });
  }

  createAgent(input: {
    name: string;
    slug?: string;
    adapterType: string;
    instructions?: string;
    capabilities?: string[];
    enabled?: boolean;
    isDefault?: boolean;
    platform?: string;
    config_json?: Record<string, unknown> | null;
  }): AgentRecord {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Agent name is required");
    }
    const slug = this.validateSlug(input.slug ?? slugify(name));
    this.ensureSlugAvailable(slug);
    if (!input.adapterType?.trim()) {
      throw new Error("adapterType is required");
    }
    this.ensureAdapterRegistered(input.adapterType.trim());
    if (input.isDefault && input.enabled === false) {
      throw new Error("Default agent cannot be disabled");
    }

    const now = nowIso();
    const record: AgentRecord = {
      id: crypto.randomUUID(),
      name,
      slug,
      platform: input.platform ?? input.adapterType.replace(/_/g, "-"),
      adapter_type: input.adapterType.trim(),
      instructions: input.instructions?.trim() || null,
      status: input.enabled === false ? "unavailable" : "active",
      capabilities: normalizeCapabilities(input.capabilities),
      config_json: input.config_json ?? null,
      enabled: input.enabled !== false,
      is_default: input.isDefault === true,
      created_at: now,
      updated_at: now,
    };

    if (record.is_default) {
      this.clearDefaultAgent();
    }

    const stmt = this.database.db.prepare(`
      INSERT INTO agents (
        id, name, slug, platform, adapter_type, instructions, status,
        capabilities_json, config_json, enabled, is_default, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.name,
      record.slug,
      record.platform,
      record.adapter_type,
      record.instructions,
      record.status,
      JSON.stringify(record.capabilities),
      JSON.stringify(record.config_json),
      record.enabled ? 1 : 0,
      record.is_default ? 1 : 0,
      record.created_at,
      record.updated_at,
    );

    return this.getAgent(record.id)!;
  }

  updateAgent(
    agentId: string,
    input: {
      name?: string;
      slug?: string;
      adapterType?: string;
      instructions?: string;
      capabilities?: string[];
      enabled?: boolean;
      isDefault?: boolean;
    },
  ): AgentRecord {
    const current = this.getAgent(agentId);
    if (!current) {
      throw new Error("Agent not found");
    }

    const name = input.name !== undefined ? input.name.trim() : current.name;
    if (!name) {
      throw new Error("Agent name is required");
    }
    const slug = this.validateSlug(input.slug ?? current.slug);
    this.ensureSlugAvailable(slug, agentId);
    const adapterType = input.adapterType?.trim() || current.adapter_type;
    if (!adapterType) {
      throw new Error("adapterType is required");
    }
    this.ensureAdapterRegistered(adapterType);
    const enabled = input.enabled ?? current.enabled;
    const isDefault = input.isDefault ?? current.is_default;
    if (isDefault && !enabled) {
      throw new Error("Default agent cannot be disabled");
    }

    if (isDefault) {
      this.clearDefaultAgent(agentId);
    }

    const stmt = this.database.db.prepare(`
      UPDATE agents
      SET name = ?,
          slug = ?,
          adapter_type = ?,
          instructions = ?,
          status = ?,
          capabilities_json = ?,
          enabled = ?,
          is_default = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      name,
      slug,
      adapterType,
      input.instructions !== undefined ? input.instructions.trim() || null : current.instructions,
      enabled ? "active" : "unavailable",
      JSON.stringify(
        input.capabilities !== undefined
          ? normalizeCapabilities(input.capabilities)
          : current.capabilities,
      ),
      enabled ? 1 : 0,
      isDefault ? 1 : 0,
      nowIso(),
      agentId,
    );

    return this.getAgent(agentId)!;
  }

  setDefaultAgent(agentId: string): AgentRecord {
    const current = this.getAgent(agentId);
    if (!current) {
      throw new Error("Agent not found");
    }
    if (!current.enabled) {
      throw new Error("Disabled agent cannot be default");
    }
    this.clearDefaultAgent(agentId);
    this.database.db
      .prepare(`UPDATE agents SET is_default = 1, updated_at = ? WHERE id = ?`)
      .run(nowIso(), agentId);
    return this.getAgent(agentId)!;
  }

  disableAgent(agentId: string): AgentRecord {
    const current = this.getAgent(agentId);
    if (!current) {
      throw new Error("Agent not found");
    }
    if (current.is_default) {
      throw new Error("Default agent cannot be disabled");
    }
    this.database.db
      .prepare(`UPDATE agents SET enabled = 0, status = 'unavailable', updated_at = ? WHERE id = ?`)
      .run(nowIso(), agentId);
    return this.getAgent(agentId)!;
  }

  enableAgent(agentId: string): AgentRecord {
    const current = this.getAgent(agentId);
    if (!current) {
      throw new Error("Agent not found");
    }
    this.database.db
      .prepare(`UPDATE agents SET enabled = 1, status = 'active', updated_at = ? WHERE id = ?`)
      .run(nowIso(), agentId);
    return this.getAgent(agentId)!;
  }

  deleteAgent(agentId: string) {
    const current = this.getAgent(agentId);
    if (!current) {
      throw new Error("Agent not found");
    }
    if (current.is_default) {
      throw new Error("Default agent cannot be deleted");
    }

    const runRef = this.database.db
      .prepare(`SELECT id FROM agent_runs WHERE agent_id = ? LIMIT 1`)
      .get(agentId) as { id: string } | undefined;
    if (runRef) {
      throw new Error("Agent has run history and cannot be deleted");
    }

    this.database.db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId);
  }

  private clearDefaultAgent(exceptAgentId?: string) {
    const stmt = this.database.db.prepare(`
      UPDATE agents
      SET is_default = 0, updated_at = ?
      ${exceptAgentId ? "WHERE id != ?" : ""}
    `);
    if (exceptAgentId) {
      stmt.run(nowIso(), exceptAgentId);
      return;
    }
    stmt.run(nowIso());
  }

  private validateSlug(slug: string): string {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) {
      throw new Error("Agent slug is required");
    }
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      throw new Error("Agent slug may only contain lowercase letters, numbers, and hyphens");
    }
    return normalized;
  }

  private ensureSlugAvailable(slug: string, exceptAgentId?: string) {
    const row = this.database.db
      .prepare(`SELECT id FROM agents WHERE slug = ?`)
      .get(slug) as { id: string } | undefined;
    if (row && row.id !== exceptAgentId) {
      throw new Error("Agent slug already exists");
    }
  }

  private ensureAdapterRegistered(adapterType: string) {
    if (this.runtimeRegistry && !this.runtimeRegistry.hasAdapter(adapterType)) {
      throw new Error(`Runtime adapter not registered: ${adapterType}`);
    }
  }
}
