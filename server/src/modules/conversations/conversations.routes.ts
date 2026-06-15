import { Router } from "express";
import { ConversationsService } from "./conversations.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import { WorkspaceIsolationService } from "../workspaces/workspace-isolation.service.js";
import { PreviewService } from "../preview/preview.service.js";
import { TasksService } from "../tasks/tasks.service.js";
import { AssignmentsService } from "../assignments/assignments.service.js";
import { RunsService } from "../runs/runs.service.js";
import { ApprovalService } from "../approvals/approvals.service.js";
import { ConversationSummary } from "../../shared/types.js";
import { DatabaseClient } from "../../db/client.js";

export interface ConversationsRouterDeps {
  conversationsService: ConversationsService;
  workspacesService?: WorkspacesService;
  workspaceIsolationService?: WorkspaceIsolationService;
  previewService?: PreviewService;
  tasksService?: TasksService;
  assignmentsService?: AssignmentsService;
  runsService?: RunsService;
  approvalService?: ApprovalService;
  database?: DatabaseClient;
}

export function createConversationsRouter(deps: ConversationsRouterDeps): Router {
  const { conversationsService, workspacesService, workspaceIsolationService, previewService, tasksService, assignmentsService, runsService, approvalService, database } = deps;
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(conversationsService.list());
  });

  router.post("/", (req, res) => {
    const conversation = conversationsService.create({
      title: req.body?.title,
      type: req.body?.type,
      taskTitle: req.body?.taskTitle,
    });
    res.status(201).json(conversation);
  });

  router.get("/:conversationId", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }
    res.json(conversation);
  });

  router.post("/with-workspace", (req, res) => {
    if (!workspacesService) {
      res.status(400).json({ detail: "Workspace service is not available" });
      return;
    }

    const rootPath = typeof req.body?.rootPath === "string" ? req.body.rootPath.trim() : "";
    if (!rootPath) {
      res.status(400).json({ detail: "rootPath is required" });
      return;
    }

    const validation = workspacesService.validateWorkspacePath(rootPath);
    if (!validation.exists || !validation.isDirectory) {
      res.status(400).json({ detail: "Invalid workspace path", validation });
      return;
    }

    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : null;
      const type = req.body?.type === "single" ? "single" : "group";
      const conversation = conversationsService.create({ title, type });
      const workspace = workspacesService.bindWorkspace(conversation.id, {
        rootPath: validation.rootPath,
      });

      res.status(201).json({ conversation, workspace, validation });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create conversation";
      res.status(400).json({ detail: message });
    }
  });

  router.get("/:conversationId/summary", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const convId = req.params.conversationId;

    // Workspace
    let workspaceInfo: ConversationSummary["workspace"] = null;
    if (workspacesService) {
      const ws = workspacesService.getByConversationId(convId);
      if (ws) {
        let isGitRepo: boolean | undefined;
        let previewCapable: boolean | undefined;
        try {
          const validation = workspacesService.validateWorkspacePath(ws.root_path);
          isGitRepo = validation.isGitRepo;
          previewCapable = validation.previewCapable;
        } catch {
          // validation failed, leave undefined
        }
        workspaceInfo = {
          rootPath: ws.root_path,
          isGitRepo,
          previewCapable,
        };
      }
    }

    // Messages count
    let messagesCount = 0;
    if (database) {
      try {
        const row = database.db.prepare(
          "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?"
        ).get(convId) as { c: number } | undefined;
        messagesCount = row?.c ?? 0;
      } catch { /* ignore */ }
    }

    // Tasks
    const taskList: ConversationSummary["tasks"] = [];
    if (tasksService) {
      try {
        const tasks = tasksService.listByConversation(convId);
        for (const task of tasks) {
          let assignedAgentName: string | undefined;
          let latestRunId: string | undefined;
          if (assignmentsService) {
            try {
              const assignment = assignmentsService.listAssignmentsByTask(task.id)[0];
              if (assignment) {
                latestRunId = assignment.latest_run_id ?? undefined;
                if (database) {
                  try {
                    const agentRow = database.db.prepare("SELECT name FROM agents WHERE id = ?").get(assignment.agent_id) as { name?: string } | undefined;
                    assignedAgentName = agentRow?.name;
                  } catch { /* ignore */ }
                }
              }
            } catch { /* ignore */ }
          }
          taskList.push({
            id: task.id,
            title: task.title,
            status: task.status,
            assignedAgentName,
            latestRunId,
          });
        }
      } catch { /* ignore */ }
    }

    // Runs
    const runList: ConversationSummary["runs"] = [];
    const changedFiles: ConversationSummary["changedFiles"] = [];
    let completedRuns = 0;
    let failedRuns = 0;
    let interruptedRuns = 0;
    let appliedRuns = 0;
    let cleanedWorkspaces = 0;

    if (runsService) {
      try {
        const runs = runsService.listByConversationId(convId);
        for (const run of runs) {
          if (run.status === "completed") completedRuns++;
          else if (run.status === "failed") failedRuns++;
          else if (run.status === "interrupted") interruptedRuns++;

          let agentName: string | undefined;
          if (database) {
            try {
              const agentRow = database.db.prepare("SELECT name FROM agents WHERE id = ?").get(run.agent_id) as { name?: string } | undefined;
              agentName = agentRow?.name;
            } catch { /* ignore */ }
          }

          let workspaceMode: string | undefined;
          let workspaceStatus: string | undefined;
          try {
            const rws = runsService.getRunWorkspace(run.id);
            if (rws) {
              workspaceMode = rws.mode;
              workspaceStatus = rws.status;
              if (rws.status === "cleaned") cleanedWorkspaces++;
            }
          } catch { /* ignore */ }

          let applied: boolean | undefined;
          try {
            const stmt = database?.db.prepare("SELECT status FROM run_change_applications WHERE run_id = ?");
            const row = stmt?.get(run.id) as { status?: string } | undefined;
            applied = row?.status === "applied";
            if (applied) appliedRuns++;
          } catch { /* ignore */ }

          let changedFilesCount: number | undefined;
          try {
            const fcs = runsService.getFileChanges(run.id);
            changedFilesCount = fcs.length;
            for (const fc of fcs) {
              changedFiles.push({
                runId: run.id.slice(0, 8),
                filePath: fc.filePath,
                changeType: fc.changeType,
              });
            }
          } catch { /* ignore */ }

          runList.push({
            id: run.id,
            agentName,
            status: run.status,
            taskId: run.task_id ?? undefined,
            workspaceMode,
            workspaceStatus,
            applied,
            changedFilesCount,
          });
        }
      } catch { /* ignore */ }
    }

    // Confirmations
    const confirmations: ConversationSummary["confirmations"] = [];
    let pendingConfirmations = 0;
    if (approvalService) {
      try {
        const approvals = approvalService.listByConversation(convId);
        for (const a of approvals) {
          confirmations.push({
            id: a.id,
            actionType: a.actionType,
            status: a.status,
          });
          if (a.status === "pending") pendingConfirmations++;
        }
      } catch { /* ignore */ }
    }

    const summary: ConversationSummary = {
      conversationId: convId,
      title: conversation.title,
      workspace: workspaceInfo,
      counts: {
        messages: messagesCount,
        tasks: taskList.length,
        runs: runList.length,
        completedRuns,
        failedRuns,
        interruptedRuns,
        appliedRuns,
        cleanedWorkspaces,
        pendingConfirmations,
      },
      tasks: taskList,
      runs: runList,
      changedFiles,
      confirmations,
    };

    res.json(summary);
  });

  router.delete("/:conversationId", async (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const cleanupRunWorkspaces = req.body?.cleanupRunWorkspaces === true;
    let workspaceCleanup: { cleaned: unknown[]; skipped: Array<{ runId: string; reason: string }> } | undefined;

    if (cleanupRunWorkspaces && workspaceIsolationService && runsService) {
      try {
        // Stop active previews first
        if (previewService) {
          const runWorkspacesStmt = database?.db.prepare(
            "SELECT run_id FROM run_workspaces WHERE conversation_id = ? AND status != 'cleaned'"
          );
          const activeRunIds = (runWorkspacesStmt?.all(req.params.conversationId) as Array<{ run_id: string }> | undefined) ?? [];
          for (const row of activeRunIds) {
            try {
              if (previewService.isPreviewRunning(row.run_id)) {
                await previewService.stopPreviewForRun(row.run_id);
              }
            } catch { /* skip */ }
          }
        }

        workspaceCleanup = await workspaceIsolationService.cleanupConversationWorkspaces(
          req.params.conversationId,
          runsService,
        );
      } catch {
        workspaceCleanup = { cleaned: [], skipped: [{ runId: "-", reason: "Cleanup failed during deletion" }] };
      }
    }

    const deleted = conversationsService.delete(req.params.conversationId);
    if (!deleted) {
      res.status(500).json({ detail: "Failed to delete conversation" });
      return;
    }

    res.json({
      ok: true,
      deletedConversationId: req.params.conversationId,
      workspaceCleanup,
    });
  });

  return router;
}
