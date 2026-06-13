import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inject from "light-my-request";
import { createAgentHubServer, AgentHubServer, AgentHubServerOptions } from "../src/app.js";

export interface InjectClient {
  get: (url: string) => Promise<{ statusCode: number; json: () => any }>;
  post: (
    url: string,
    payload?: unknown,
  ) => Promise<{ statusCode: number; json: () => any }>;
  patch: (
    url: string,
    payload?: unknown,
  ) => Promise<{ statusCode: number; json: () => any }>;
  del: (
    url: string,
    payload?: unknown,
  ) => Promise<{ statusCode: number; json: () => any }>;
}

interface InjectLikeResponse {
  statusCode: number;
  json: () => any;
}

export interface TestHarness {
  client: InjectClient;
  workspacePath: string;
  dbPath: string;
  server: AgentHubServer;
  createAgent: (name: string, input?: { enabled?: boolean; isDefault?: boolean; adapterType?: string }) => string;
  close: () => Promise<void>;
}

export async function createTestHarness(
  serverOptions: AgentHubServerOptions = {},
): Promise<TestHarness> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-server-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const dbPath = path.join(tempRoot, "test.sqlite");
  fs.mkdirSync(workspacePath, { recursive: true });

  const mockCliPath = path.resolve("tests/fixtures/mock-claude-cli.mjs");
  const server = createAgentHubServer(
    {
      port: 8000,
      dbPath,
      claudeCommand: process.execPath,
      claudeBaseArgs: [mockCliPath],
      claudeAllowedTools: [],
    },
    {
      enableWorkspaceIsolation: false,
      ...serverOptions,
    },
  );

  const client: InjectClient = {
    async get(url: string) {
      const response = (await inject(server.app, {
        method: "GET",
        url,
      })) as unknown as InjectLikeResponse;
      return {
        statusCode: response.statusCode,
        json: () => response.json(),
      };
    },
    async post(url: string, payload?: unknown) {
      const response = (await inject(server.app, {
        method: "POST",
        url,
        payload: payload as string | object | Buffer | undefined,
      })) as unknown as InjectLikeResponse;
      return {
        statusCode: response.statusCode,
        json: () => response.json(),
      };
    },
    async patch(url: string, payload?: unknown) {
      const response = (await inject(server.app, {
        method: "PATCH",
        url,
        payload: payload as string | object | Buffer | undefined,
      })) as unknown as InjectLikeResponse;
      return {
        statusCode: response.statusCode,
        json: () => response.json(),
      };
    },
    async del(url: string, payload?: unknown) {
      const response = (await inject(server.app, {
        method: "DELETE",
        url,
        payload: payload as string | object | Buffer | undefined,
      })) as unknown as InjectLikeResponse;
      return {
        statusCode: response.statusCode,
        json: () => response.json(),
      };
    },
  };

  return {
    client,
    workspacePath,
    dbPath,
    server,
    createAgent: (name: string, input = {}) =>
      server.app.locals.agentsService.create({
        name,
        platform: "claude-cli",
        adapter_type: input.adapterType ?? "claude_cli",
        status: input.enabled === false ? "unavailable" : "active",
        capabilities: ["text_generation"],
        config_json: {
          command: process.execPath,
          baseArgs: [mockCliPath],
          allowedTools: [],
        },
        isDefault: input.isDefault ?? false,
      }).id,
    close: async () => {
      await server.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Condition not met before timeout");
}
