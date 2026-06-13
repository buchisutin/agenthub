import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { schemaIndexesSql, schemaSql } from "./schema.js";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class DatabaseClient {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const resolved = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec(schemaSql);
    this.migrateConversationsTable();
    this.ensureColumns();
    this.db.exec(schemaIndexesSql);
  }

  close() {
    this.db.close();
  }

  private ensureColumns() {
    this.ensureTableColumns("conversations", [
      { name: "task_id", sql: "TEXT" },
      { name: "agent_platform", sql: "TEXT" },
    ]);

    this.ensureTableColumns("tasks", [
      { name: "conversation_id", sql: "TEXT" },
      { name: "source_message_id", sql: "TEXT" },
      { name: "plan_message_id", sql: "TEXT" },
      { name: "parent_task_id", sql: "TEXT" },
      { name: "depends_on_json", sql: "TEXT" },
      { name: "task_type", sql: "TEXT" },
      { name: "expected_output", sql: "TEXT" },
      { name: "priority", sql: "INTEGER NOT NULL DEFAULT 1" },
      { name: "created_by_type", sql: "TEXT" },
      { name: "created_by_id", sql: "TEXT" },
    ]);

    this.ensureTableColumns("agents", [
      { name: "slug", sql: "TEXT" },
      { name: "instructions", sql: "TEXT" },
      { name: "enabled", sql: "INTEGER NOT NULL DEFAULT 1" },
      { name: "is_default", sql: "INTEGER NOT NULL DEFAULT 0" },
      { name: "updated_at", sql: "TEXT" },
    ]);

    this.ensureTableColumns("agent_runs", [
      { name: "task_id", sql: "TEXT" },
      { name: "assignment_id", sql: "TEXT" },
      { name: "runtime_id", sql: "TEXT" },
      { name: "agent_session_id", sql: "TEXT" },
      { name: "source_message_id", sql: "TEXT" },
      { name: "trigger_type", sql: "TEXT NOT NULL DEFAULT 'chat'" },
      { name: "trigger_source_id", sql: "TEXT" },
      { name: "requested_by", sql: "TEXT" },
    ]);

    this.ensureTableColumns("run_events", [
      { name: "event_id", sql: "TEXT" },
      { name: "event_family", sql: "TEXT" },
      { name: "dedup_key", sql: "TEXT" },
      { name: "occurred_at", sql: "TEXT" },
    ]);

    this.ensureTableColumns("run_merges", [
      { name: "task_id", sql: "TEXT" },
      { name: "assignment_id", sql: "TEXT" },
      { name: "applied_files_json", sql: "TEXT" },
      { name: "conflict_files_json", sql: "TEXT" },
      { name: "blocked_reason", sql: "TEXT" },
      { name: "approval_id", sql: "TEXT" },
      { name: "merged_at", sql: "TEXT" },
    ]);

    this.backfillRunEvents();
    this.backfillAgents();
  }

  private migrateConversationsTable() {
    const rows = this.db
      .prepare(`PRAGMA table_info(${quoteIdentifier("conversations")})`)
      .all() as Array<{ name: string }>;
    const existing = new Set(rows.map((row) => row.name));
    const legacyColumns = [
      "agent_session_id",
      "session_status",
      "session_last_resumed_at",
      "session_invalid_reason",
    ];

    if (!legacyColumns.some((column) => existing.has(column))) {
      return;
    }

    const taskIdSelect = existing.has("task_id") ? "task_id" : "NULL AS task_id";
    const agentPlatformSelect = existing.has("agent_platform")
      ? "agent_platform"
      : "NULL AS agent_platform";

    this.db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE conversations_new (
        id TEXT PRIMARY KEY,
        title TEXT,
        type TEXT NOT NULL,
        task_id TEXT,
        agent_platform TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      );

      INSERT INTO conversations_new (
        id, title, type, task_id, agent_platform, created_at, updated_at
      )
      SELECT id, title, type, ${taskIdSelect}, ${agentPlatformSelect}, created_at, updated_at
      FROM conversations;

      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;

      PRAGMA foreign_keys = ON;
    `);
  }

  private ensureTableColumns(
    tableName: string,
    columns: Array<{ name: string; sql: string }>,
  ) {
    const rows = this.db
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all() as Array<{ name: string }>;
    const existing = new Set(rows.map((row) => row.name));

    for (const column of columns) {
      if (existing.has(column.name)) {
        continue;
      }
      this.db.exec(
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(column.name)} ${column.sql}`,
      );
    }
  }

  private backfillRunEvents() {
    this.db.exec(`
      UPDATE run_events
      SET event_id = COALESCE(event_id, id),
          event_family = COALESCE(event_family, event_type),
          dedup_key = COALESCE(dedup_key, run_id || ':' || seq),
          occurred_at = COALESCE(occurred_at, created_at)
      WHERE event_id IS NULL
         OR event_family IS NULL
         OR dedup_key IS NULL
         OR occurred_at IS NULL
    `);
  }

  private backfillAgents() {
    const rows = this.db.prepare(`
      SELECT id, name, slug, enabled, is_default, created_at, updated_at
      FROM agents
      ORDER BY created_at ASC, id ASC
    `).all() as Array<{
      id: string;
      name: string;
      slug: string | null;
      enabled: number | null;
      is_default: number | null;
      created_at: string | null;
      updated_at: string | null;
    }>;

    const slugCounts = new Map<string, number>();
    const slugify = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "agent";

    const usedSlugs = new Set<string>();
    for (const row of rows) {
      const baseSlug = slugify(row.slug ?? row.name);
      let nextSlug = baseSlug;
      let suffix = slugCounts.get(baseSlug) ?? 0;
      while (usedSlugs.has(nextSlug)) {
        suffix += 1;
        nextSlug = `${baseSlug}-${suffix}`;
      }
      slugCounts.set(baseSlug, suffix);
      usedSlugs.add(nextSlug);

      const createdAt = row.created_at ?? new Date().toISOString();
      const updatedAt = row.updated_at ?? createdAt;
      this.db
        .prepare(`
          UPDATE agents
          SET slug = ?,
              enabled = COALESCE(enabled, 1),
              is_default = COALESCE(is_default, 0),
              created_at = COALESCE(created_at, ?),
              updated_at = COALESCE(updated_at, ?)
          WHERE id = ?
        `)
        .run(nextSlug, createdAt, updatedAt, row.id);
    }
  }
}
