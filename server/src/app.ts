import http from "node:http";
import cors from "cors";
import express from "express";
import { getEnvConfig, type EnvConfig } from "./config/env.js";
import { DatabaseClient } from "./db/client.js";
import { AgentsService } from "./modules/agents/agents.service.js";
import { createAgentsRouter } from "./modules/agents/agents.routes.js";
import { AgentRuntimesService } from "./modules/agent-runtimes/agent-runtimes.service.js";
import { AgentSessionsService } from "./modules/agent-sessions/agent-sessions.service.js";
import { ConversationsService } from "./modules/conversations/conversations.service.js";
import { createConversationsRouter } from "./modules/conversations/conversations.routes.js";
import { AssignmentsService } from "./modules/assignments/assignments.service.js";
import { createOrchestratorRouter } from "./modules/orchestrator/orchestrator.routes.js";
import {
  HiddenPlannerDeps,
  OrchestratorService,
} from "./modules/orchestrator/orchestrator.service.js";
import { createMessagesRouter } from "./modules/messages/messages.routes.js";
import { MessagesService } from "./modules/messages/messages.service.js";
import { createPreviewRouter } from "./modules/preview/preview.routes.js";
import { PreviewService, type PreviewServiceDeps } from "./modules/preview/preview.service.js";
import { RunsService } from "./modules/runs/runs.service.js";
import { createRunsRouter } from "./modules/runs/runs.routes.js";
import { RunChangeApplicationService } from "./modules/runs/run-change-application.service.js";
import { MergeService } from "./modules/merge/merge.service.js";
import { TasksService } from "./modules/tasks/tasks.service.js";
import { createTasksRouter } from "./modules/tasks/tasks.routes.js";
import { createRuntimesRouter } from "./modules/runtimes/runtimes.routes.js";
import { WorkspacesService } from "./modules/workspaces/workspaces.service.js";
import { WorkspaceIsolationService } from "./modules/workspaces/workspace-isolation.service.js";
import { createWorkspacesRouter } from "./modules/workspaces/workspaces.routes.js";
import { ApprovalService } from "./modules/approvals/approvals.service.js";
import { createApprovalsRouter, type ApprovalExecutor } from "./modules/approvals/approvals.routes.js";
import { ClaudeCliRuntime } from "./runtime/claude/claude-cli-runtime.js";
import { CodexCliRuntime } from "./runtime/codex/codex-cli-runtime.js";
import { RunManager } from "./runtime/manager/run-manager.js";
import { RuntimeRegistry } from "./runtime/runtime-registry.js";
import { RealtimeServer } from "./sockets/socket-server.js";

export interface AgentHubServer {
  app: express.Express;
  httpServer: http.Server;
  realtimeServer: RealtimeServer;
  env: EnvConfig;
  close: () => Promise<void>;
}

export interface AgentHubServerOptions {
  previewService?: PreviewService;
  previewServiceDeps?: PreviewServiceDeps;
  orchestratorService?: OrchestratorService;
  orchestratorPlanner?: HiddenPlannerDeps["plan"];
  workspaceIsolationService?: WorkspaceIsolationService;
  enableWorkspaceIsolation?: boolean;
  runtimeRegistry?: RuntimeRegistry;
}

export function createAgentHubServer(
  overrides: Partial<EnvConfig> = {},
  options: AgentHubServerOptions = {},
): AgentHubServer {
  const SLOW_REQUEST_MS = 200;
  const env = getEnvConfig(overrides);
  const database = new DatabaseClient(env.dbPath);
  const tasksService = new TasksService(database);
  const assignmentsService = new AssignmentsService(database);
  const conversationsService = new ConversationsService(database, tasksService);
  const runtimeRegistry =
    options.runtimeRegistry ??
    new RuntimeRegistry({
      claude_cli: new ClaudeCliRuntime(env),
      codex_cli: new CodexCliRuntime(env),
    });
  const agentsService = new AgentsService(database, env, runtimeRegistry);
  const agentRuntimesService = new AgentRuntimesService(database);
  const agentSessionsService = new AgentSessionsService(database);
  const workspacesService = new WorkspacesService(database);
  const workspaceIsolationService: WorkspaceIsolationService | undefined =
    options.workspaceIsolationService ??
    (options.enableWorkspaceIsolation === false ? undefined : new WorkspaceIsolationService(database));
  const runsService = new RunsService(database);
  const approvalService = new ApprovalService(database);
  const messagesService = new MessagesService(
    database,
    conversationsService,
    runsService,
    tasksService,
    assignmentsService,
    approvalService,
  );
  const previewService =
    options.previewService ??
    new PreviewService(runsService, workspacesService, options.previewServiceDeps);
  const mergeService = new MergeService(database, {
    getRun: (id) => runsService.getById(id),
    getRunWorkspace: (id) => runsService.getRunWorkspace(id),
    getBaseWorkspaceRootPath: (workspaceId) => {
      const ws = workspacesService.getById(workspaceId);
      return ws?.root_path ?? null;
    },
    getFileChanges: (id) => runsService.getFileChanges(id),
  });

  if (workspaceIsolationService) {
    workspaceIsolationService.setPreviewRunningCheck(
      (runId: string) => previewService.isPreviewRunning(runId),
    );
  }

  const defaultAgent = agentsService.ensureDefaultClaudeAgent();
  agentRuntimesService.ensureLocalRuntime(defaultAgent.id, defaultAgent.platform);
  const codexAgent = agentsService.ensureBuiltinCodexAgent();
  agentRuntimesService.ensureLocalRuntime(codexAgent.id, codexAgent.platform);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      if (durationMs < SLOW_REQUEST_MS) {
        return;
      }
      console.log(
        `[slow request] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${durationMs}ms`,
      );
    });
    next();
  });
  app.locals.conversationsService = conversationsService;
  app.locals.agentsService = agentsService;
  app.locals.agentRuntimesService = agentRuntimesService;
  app.locals.agentSessionsService = agentSessionsService;
  app.locals.runsService = runsService;
  app.locals.messagesService = messagesService;
  app.locals.tasksService = tasksService;
  app.locals.assignmentsService = assignmentsService;
  app.locals.workspacesService = workspacesService;
  app.locals.approvalService = approvalService;
  app.locals.previewService = previewService;
  app.locals.runtimeRegistry = runtimeRegistry;
  app.locals.mergeService = mergeService;

  const httpServer = http.createServer(app);
  const runManager = new RunManager({
    conversationsService,
    agentsService,
    agentRuntimesService,
    agentSessionsService,
    workspacesService,
    workspaceIsolationService,
    runsService,
    tasksService,
    assignmentsService,
    runtimeRegistry,
    emitEvent: (event) => realtimeServer.emitRunEvent(event),
  });
  const realtimeServer = new RealtimeServer(httpServer, runManager);
  const orchestratorService =
    options.orchestratorService ??
    new OrchestratorService(
      conversationsService,
      agentsService,
      workspacesService,
      messagesService,
      tasksService,
      assignmentsService,
      runtimeRegistry,
      runManager,
      {
        ...(options.orchestratorPlanner ? { plan: options.orchestratorPlanner } : {}),
        emitEvent: (event) => realtimeServer.emitConversationEvent(event),
        approvalService,
        mergeService,
      },
    );
  app.locals.orchestratorService = orchestratorService;

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const changeApplicationService = new RunChangeApplicationService(database, {
    getRun: (id) => runsService.getById(id),
    getRunWorkspace: (id) => runsService.getRunWorkspace(id),
    getRunWorkspaceId: (runId) => {
      const stmt = database.db.prepare(
        "SELECT id FROM run_workspaces WHERE run_id = ? LIMIT 1",
      );
      const row = stmt.get(runId) as { id: string } | undefined;
      return row?.id ?? null;
    },
    getBaseWorkspaceRootPath: (workspaceId) => {
      const ws = workspacesService.getById(workspaceId);
      return ws?.root_path ?? null;
    },
    getFileChanges: (id) => runsService.getFileChanges(id),
    getAgentSlug: (agentId) => agentsService.getById(agentId)?.slug ?? null,
  });
  if (typeof orchestratorService.resumeWatchingPlans === "function") {
    void orchestratorService.resumeWatchingPlans();
  }

  const approvalExecutor: ApprovalExecutor = {
    executeApplyChanges: async (runId: string) => {
      return changeApplicationService.applyRunChanges(runId) as unknown as Record<string, unknown>;
    },
    executeApplyAndCommit: async (runId: string) => {
      return changeApplicationService.applyAndCommitRunChanges(runId) as unknown as Record<string, unknown>;
    },
    executeResolveConflicts: async (approval) => {
      const runId = approval.runId;
      if (!runId) {
        throw new Error("Approval has no runId");
      }
      const resolutions = Array.isArray(approval.payload?.resolutions)
        ? approval.payload.resolutions
        : [];
      return mergeService.resolveConflicts(
        runId,
        resolutions as never,
      ) as unknown as Record<string, unknown>;
    },
    executeCleanupWorkspace: async (runId: string) => {
      if (!workspaceIsolationService) throw new Error("Workspace isolation not enabled");
      return workspaceIsolationService.cleanupRunWorkspace(runId) as unknown as Record<string, unknown>;
    },
    executeCleanupConversationWorkspaces: async (conversationId: string) => {
      if (!workspaceIsolationService) {
        throw new Error("Workspace isolation not enabled");
      }
      return workspaceIsolationService.cleanupConversationWorkspaces(conversationId, runsService) as unknown as Record<string, unknown>;
    },
  };

  app.use("/conversations", createConversationsRouter({
    conversationsService,
    workspacesService,
    workspaceIsolationService,
    previewService,
    tasksService,
    assignmentsService,
    runsService,
    approvalService,
    database,
  }));
  app.use("/conversations", createMessagesRouter(conversationsService, messagesService));
  app.use("/", createWorkspacesRouter(conversationsService, workspacesService));
  app.use(
    "/",
    createRunsRouter(
      conversationsService,
      messagesService,
      runManager,
      workspacesService,
      tasksService,
      workspaceIsolationService,
      runsService,
      changeApplicationService,
      approvalService,
      mergeService,
    ),
  );
  app.use("/", createApprovalsRouter(conversationsService, approvalService, approvalExecutor));
  app.use("/", createOrchestratorRouter(conversationsService, workspacesService, orchestratorService));
  app.use(
    "/",
    createTasksRouter(
      conversationsService,
      tasksService,
      assignmentsService,
      runsService,
      runManager,
    ),
  );
  app.use("/", createPreviewRouter(previewService));
  app.use("/agents", createAgentsRouter(agentsService));
  app.use("/", createRuntimesRouter(runtimeRegistry));

  return {
    app,
    httpServer,
    realtimeServer,
    env,
    close: async () => {
      if (typeof orchestratorService.close === "function") {
        orchestratorService.close();
      }
      await previewService.cleanupAllPreviews();
      await runManager.close();
      await realtimeServer.close();
      await new Promise<void>((resolve, reject) => {
        if (!httpServer.listening) {
          resolve();
          return;
        }
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      database.close();
    },
  };
}
