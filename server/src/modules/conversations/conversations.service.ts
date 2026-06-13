import crypto from "node:crypto";
import { DatabaseClient } from "../../db/client.js";
import {
  type ConversationRecord,
  type ConversationType,
  type CreateConversationInput,
} from "../../shared/types.js";
import { TasksService } from "../tasks/tasks.service.js";

const nowIso = () => new Date().toISOString();

export class ConversationsService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly tasksService: TasksService,
  ) {}

  create(input: CreateConversationInput): ConversationRecord {
    const task = this.tasksService.create({
      title: (input.taskTitle ?? input.title ?? "New task").trim() || "New task",
    });

    const now = nowIso();
    const record: ConversationRecord = {
      id: crypto.randomUUID(),
      title: input.title ?? null,
      type: (input.type ?? "single") as ConversationType,
      task_id: task.id,
      agent_platform: "claude_cli",
      created_at: now,
      updated_at: now,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
      },
    };

    const stmt = this.database.db.prepare(`
      INSERT INTO conversations (
        id, title, type, task_id, agent_platform, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.id,
      record.title,
      record.type,
      record.task_id,
      record.agent_platform,
      record.created_at,
      record.updated_at,
    );
    return this.getById(record.id)!;
  }

  list(): ConversationRecord[] {
    const stmt = this.database.db.prepare(`
      SELECT
        c.id, c.title, c.type, c.task_id, c.agent_platform, c.created_at, c.updated_at,
        t.id AS linked_task_id,
        t.title AS task_title,
        t.status AS task_status
      FROM conversations c
      LEFT JOIN tasks t ON t.id = c.task_id
      ORDER BY c.updated_at DESC
    `);
    return stmt
      .all()
      .map((row) => this.parseConversation(row as Record<string, unknown>));
  }

  getById(id: string): ConversationRecord | null {
    const stmt = this.database.db.prepare(`
      SELECT
        c.id, c.title, c.type, c.task_id, c.agent_platform, c.created_at, c.updated_at,
        t.id AS linked_task_id,
        t.title AS task_title,
        t.status AS task_status
      FROM conversations c
      LEFT JOIN tasks t ON t.id = c.task_id
      WHERE c.id = ?
    `);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.parseConversation(row) : null;
  }

  touch(id: string): void {
    const stmt = this.database.db.prepare(`
      UPDATE conversations
      SET updated_at = ?
      WHERE id = ?
    `);
    stmt.run(nowIso(), id);
  }

  delete(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;

    const stmt = this.database.db.prepare("DELETE FROM conversations WHERE id = ?");
    stmt.run(id);
    return true;
  }

  private parseConversation(row: Record<string, unknown>): ConversationRecord {
    return {
      id: String(row.id),
      title: row.title === null ? null : String(row.title),
      type: row.type as ConversationType,
      task_id: row.task_id === null ? null : String(row.task_id),
      agent_platform:
        row.agent_platform === null ? null : String(row.agent_platform),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      task:
        row.linked_task_id && row.task_title && row.task_status
          ? {
              id: String(row.linked_task_id),
              title: String(row.task_title),
              status: row.task_status as NonNullable<ConversationRecord["task"]>["status"],
            }
          : null,
    };
  }
}
