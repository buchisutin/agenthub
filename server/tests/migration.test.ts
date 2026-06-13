import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import inject from "light-my-request";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentHubServer } from "../src/app.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

function createLegacyDatabase() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-legacy-db-"));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, "legacy.sqlite");
  const workspacePath = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      agent_session_id TEXT,
      session_status TEXT,
      session_last_resumed_at TEXT,
      session_invalid_reason TEXT
    );

    INSERT INTO conversations (
      id, title, type, created_at, updated_at, agent_session_id, session_status,
      session_last_resumed_at, session_invalid_reason
    ) VALUES (
      'legacy-conv',
      'Legacy Conversation',
      'single',
      '2026-05-28T00:00:00.000Z',
      '2026-05-28T00:00:00.000Z',
      'legacy-session',
      'active',
      '2026-05-28T00:00:00.000Z',
      NULL
    );
  `);
  db.close();

  return { dbPath, workspacePath };
}

function createOldestDatabase() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-oldest-db-"));
  tempRoots.push(tempRoot);
  const dbPath = path.join(tempRoot, "oldest.sqlite");
  const workspacePath = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO conversations (
      id, title, type, created_at, updated_at
    ) VALUES (
      'oldest-conv',
      'Oldest Conversation',
      'single',
      '2026-05-28T00:00:00.000Z',
      '2026-05-28T00:00:00.000Z'
    );
  `);
  db.close();

  return { dbPath, workspacePath };
}

describe("legacy conversations migration", () => {
  it("rebuilds the conversations table without session projection columns", async () => {
    const { dbPath, workspacePath } = createLegacyDatabase();
    const server = createAgentHubServer({
      dbPath,
      claudeCommand: process.execPath,
      claudeBaseArgs: [path.resolve("tests/fixtures/mock-claude-cli.mjs")],
      claudeAllowedTools: [],
    });

    try {
      const db = new DatabaseSync(dbPath);
      const columns = db
        .prepare("PRAGMA table_info(conversations)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("agent_session_id");
      expect(columns.map((column) => column.name)).not.toContain("session_status");
      expect(columns.map((column) => column.name)).not.toContain("session_last_resumed_at");
      expect(columns.map((column) => column.name)).not.toContain("session_invalid_reason");
      const runColumns = db
        .prepare("PRAGMA table_info(agent_runs)")
        .all() as Array<{ name: string }>;
      expect(runColumns.map((column) => column.name)).toContain("source_message_id");
      expect(runColumns.map((column) => column.name)).toContain("assignment_id");
      const taskColumns = db
        .prepare("PRAGMA table_info(tasks)")
        .all() as Array<{ name: string }>;
      expect(taskColumns.map((column) => column.name)).toContain("conversation_id");
      expect(taskColumns.map((column) => column.name)).toContain("plan_message_id");
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
      const assignmentTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_assignments'")
        .all() as Array<{ name: string }>;
      expect(assignmentTables).toHaveLength(1);
      const agentColumns = db
        .prepare("PRAGMA table_info(agents)")
        .all() as Array<{ name: string }>;
      expect(agentColumns.map((column) => column.name)).toContain("slug");
      expect(agentColumns.map((column) => column.name)).toContain("instructions");
      expect(agentColumns.map((column) => column.name)).toContain("enabled");
      expect(agentColumns.map((column) => column.name)).toContain("is_default");
      expect(agentColumns.map((column) => column.name)).toContain("updated_at");
      db.close();

      const conversationResponse = await inject(server.app, {
        method: "GET",
        url: "/conversations/legacy-conv",
      });
      expect(conversationResponse.statusCode).toBe(200);
      expect(conversationResponse.json().id).toBe("legacy-conv");
      expect(conversationResponse.json().agent_session_id).toBeUndefined();

      const workspaceResponse = await inject(server.app, {
        method: "POST",
        url: "/conversations/legacy-conv/workspace",
        payload: { rootPath: workspacePath },
      });
      expect(workspaceResponse.statusCode).toBe(201);

      const runResponse = await inject(server.app, {
        method: "POST",
        url: "/conversations/legacy-conv/runs",
        payload: { prompt: "hello from migrated db" },
      });
      expect(runResponse.statusCode).toBe(201);

      const runsResponse = await inject(server.app, {
        method: "GET",
        url: "/conversations/legacy-conv/runs",
      });
      expect(runsResponse.statusCode).toBe(200);
      expect(runsResponse.json()).toHaveLength(1);

      const resetResponse = await inject(server.app, {
        method: "POST",
        url: "/conversations/legacy-conv/session/reset",
      });
      expect(resetResponse.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("starts against older conversations schemas without task_id or agent_platform", async () => {
    const { dbPath, workspacePath } = createOldestDatabase();
    const server = createAgentHubServer({
      dbPath,
      claudeCommand: process.execPath,
      claudeBaseArgs: [path.resolve("tests/fixtures/mock-claude-cli.mjs")],
      claudeAllowedTools: [],
    });

    try {
      const db = new DatabaseSync(dbPath);
      const columns = db
        .prepare("PRAGMA table_info(conversations)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("task_id");
      expect(columns.map((column) => column.name)).toContain("agent_platform");
      const runColumns = db
        .prepare("PRAGMA table_info(agent_runs)")
        .all() as Array<{ name: string }>;
      expect(runColumns.map((column) => column.name)).toContain("source_message_id");
      expect(runColumns.map((column) => column.name)).toContain("assignment_id");
      const taskColumns = db
        .prepare("PRAGMA table_info(tasks)")
        .all() as Array<{ name: string }>;
      expect(taskColumns.map((column) => column.name)).toContain("conversation_id");
      expect(taskColumns.map((column) => column.name)).toContain("plan_message_id");
      const agentColumns = db
        .prepare("PRAGMA table_info(agents)")
        .all() as Array<{ name: string }>;
      expect(agentColumns.map((column) => column.name)).toContain("slug");
      expect(agentColumns.map((column) => column.name)).toContain("instructions");
      expect(agentColumns.map((column) => column.name)).toContain("enabled");
      expect(agentColumns.map((column) => column.name)).toContain("is_default");
      expect(agentColumns.map((column) => column.name)).toContain("updated_at");
      db.close();

      const listResponse = await inject(server.app, {
        method: "GET",
        url: "/conversations",
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toHaveLength(1);

      const detailResponse = await inject(server.app, {
        method: "GET",
        url: "/conversations/oldest-conv",
      });
      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().id).toBe("oldest-conv");

      const workspaceResponse = await inject(server.app, {
        method: "POST",
        url: "/conversations/oldest-conv/workspace",
        payload: { rootPath: workspacePath },
      });
      expect(workspaceResponse.statusCode).toBe(201);

      const runResponse = await inject(server.app, {
        method: "POST",
        url: "/conversations/oldest-conv/runs",
        payload: { prompt: "hello from oldest db" },
      });
      expect(runResponse.statusCode).toBe(201);

      const runsResponse = await inject(server.app, {
        method: "GET",
        url: "/conversations/oldest-conv/runs",
      });
      expect(runsResponse.statusCode).toBe(200);
      expect(runsResponse.json()).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});
