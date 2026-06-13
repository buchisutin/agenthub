import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { MessagesService } from "../messages/messages.service.js";
import { RunManager } from "../../runtime/manager/run-manager.js";
import { WorkspaceIsolationService } from "../workspaces/workspace-isolation.service.js";
import { RunsService } from "./runs.service.js";
import { RunChangeApplicationService } from "./run-change-application.service.js";
import { ApprovalService } from "../approvals/approvals.service.js";
import type { ApplyCheckResult, RunCardSummary } from "../../shared/types.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import { TasksService } from "../tasks/tasks.service.js";
import { MergeService } from "../merge/merge.service.js";

function buildDirtyWorkspaceDetail(workspaceStatus: {
  dirtyFilesCount: number;
  dirtyFilesSample: string[];
  suggestion: string;
}) {
  const files =
    workspaceStatus.dirtyFilesSample.length > 0
      ? `：${workspaceStatus.dirtyFilesSample.join(", ")}`
      : "";
  return `Workspace has uncommitted changes (${workspaceStatus.dirtyFilesCount} file(s))${files}. ${workspaceStatus.suggestion}`;
}

export function createRunsRouter(
  conversationsService: ConversationsService,
  messagesService: MessagesService,
  runManager: RunManager,
  workspacesService: WorkspacesService,
  tasksService?: TasksService,
  workspaceIsolationService?: WorkspaceIsolationService,
  runsService?: RunsService,
  changeApplicationService?: RunChangeApplicationService,
  approvalService?: ApprovalService,
  mergeService?: MergeService,
): Router {
  const router = Router();

  router.get("/conversations/:conversationId/runs", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }
    res.json(runManager.listRuns(req.params.conversationId));
  });

  router.post("/conversations/:conversationId/runs", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) {
      res.status(400).json({ detail: "Prompt is required" });
      return;
    }

    const sourceMessageId =
      typeof req.body?.sourceMessageId === "string"
        ? req.body.sourceMessageId
        : undefined;
    if (sourceMessageId) {
      const message = messagesService.getById(sourceMessageId);
      if (!message || message.conversation_id !== req.params.conversationId) {
        res.status(400).json({ detail: "sourceMessageId is invalid" });
        return;
      }
    }

    const workspaceStatus = workspacesService.getExecutionStatusByConversationId(
      req.params.conversationId,
    );
    if (workspaceStatus.state === "dirty") {
      res.status(409).json({
        detail: buildDirtyWorkspaceDetail(workspaceStatus),
        code: "dirty_workspace_blocked",
        workspaceStatus,
      });
      return;
    }
    if (workspaceStatus.state === "unavailable") {
      res.status(400).json({
        detail: workspaceStatus.suggestion,
        code: "workspace_unavailable",
        workspaceStatus,
      });
      return;
    }

    try {
      const run = runManager.createRun({
        conversationId: req.params.conversationId,
        agentId: req.body?.agentId,
        prompt,
        sourceMessageId,
      });
      res.status(201).json(run);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create run";
      const status =
        /workspace|disabled|default agent|invalid/i.test(message)
          ? 400
          : /not found/i.test(message)
            ? 404
            : 400;
      res.status(status).json({ detail: message });
    }
  });

  router.get("/runs/:runId", (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ detail: "Run not found" });
      return;
    }
    res.json(run);
  });

  router.get("/runs/:runId/file-changes", (req, res) => {
    try {
      const changes = runManager.getFileChanges(req.params.runId);
      res.json(changes);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load file changes";
      const status = /run not found/i.test(message)
        ? 404
        : /cleaned/i.test(message)
          ? 400
          : /workspace/i.test(message)
            ? 400
            : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.get("/runs/:runId/workspace", (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ detail: "Run not found" });
      return;
    }
    const runWorkspace = runManager.getRunWorkspace(req.params.runId);
    if (runWorkspace) {
      res.json({
        mode: runWorkspace.mode,
        rootPath: runWorkspace.root_path,
        branchName: runWorkspace.branch_name ?? null,
        status: runWorkspace.status,
        errorMessage: runWorkspace.error_message ?? null,
      });
      return;
    }
    res.json({
      mode: "legacy",
      rootPath: null,
      branchName: null,
      status: "ready",
      errorMessage: null,
    });
  });

  router.get("/runs/:runId/card-summary", (req, res) => {
    const run = runManager.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ detail: "Run not found" });
      return;
    }

    try {
      const runWorkspace = runManager.getRunWorkspace(req.params.runId);
      const task = run.task_id && tasksService ? tasksService.getById(run.task_id) : null;
      const mergeMode: RunCardSummary["mergeMode"] = task?.plan_message_id ? "auto" : "manual";
      const merge = mergeService?.getByRunId(req.params.runId) ?? null;
      const summary: RunCardSummary = {
        workspace: runWorkspace
          ? {
              mode: runWorkspace.mode,
              rootPath: runWorkspace.root_path,
              branchName: runWorkspace.branch_name ?? null,
              status: runWorkspace.status,
              errorMessage: runWorkspace.error_message ?? null,
            }
          : {
              mode: "legacy",
              rootPath: null,
              branchName: null,
              status: "ready",
              errorMessage: null,
            },
        changeApplication: changeApplicationService?.getApplicationForRun(req.params.runId) ?? null,
        fileChanges: runManager.getFileChanges(req.params.runId),
        mergeMode,
        mergeStatus: merge?.status ?? (mergeMode === "auto" ? "pending" : null),
        merge,
      };
      res.json(summary);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load run card summary";
      const status = /run not found/i.test(message)
        ? 404
        : /cleaned/i.test(message)
          ? 400
          : /workspace/i.test(message)
            ? 400
            : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/runs/:runId/workspace/cleanup", async (req, res) => {
    if (!workspaceIsolationService) {
      res.status(400).json({ detail: "Workspace isolation is not enabled" });
      return;
    }

    const mode = req.body?.mode ?? "request";

    try {
      if (mode === "execute") {
        const record = await workspaceIsolationService.cleanupRunWorkspace(req.params.runId);
        res.json(record);
        return;
      }

      // mode === "request" (default): create approval request
      if (!approvalService) {
        res.status(400).json({ detail: "Approval service is not enabled" });
        return;
      }

      const run = runManager.getRun(req.params.runId);
      if (!run) {
        res.status(404).json({ detail: "Run not found" });
        return;
      }

      // Validate cleanup is possible before creating approval
      const ws = workspaceIsolationService.getByRunId(req.params.runId);
      if (!ws) {
        res.status(404).json({ detail: "Run workspace not found" });
        return;
      }
      if (ws.status === "cleaned") {
        res.status(400).json({ detail: "Run workspace is already cleaned" });
        return;
      }
      if (ws.status !== "ready" && ws.status !== "failed") {
        res.status(400).json({ detail: "Run workspace is not in a cleanable state" });
        return;
      }

      const approval = approvalService.create({
        conversationId: run.conversation_id,
        runId: req.params.runId,
        actionType: "cleanup_workspace",
        title: "Clean Workspace",
        description: `Clean run workspace (${ws.mode}${ws.branch_name ? `: ${ws.branch_name}` : ""})`,
        payload: {
          runId: req.params.runId,
          workspaceMode: ws.mode,
          rootPath: ws.root_path,
        },
      });

      res.status(201).json(approval);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
      const statusCode = (error as any).statusCode ?? 500;
      res.status(statusCode).json({ detail: message });
    }
  });

  router.post("/conversations/:conversationId/workspaces/cleanup", async (req, res) => {
    if (!workspaceIsolationService || !runsService) {
      res.status(400).json({ detail: "Workspace isolation is not enabled" });
      return;
    }

    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const mode = req.body?.mode ?? "request";

    try {
      if (mode === "execute") {
        const result = await workspaceIsolationService.cleanupConversationWorkspaces(
          req.params.conversationId,
          runsService,
        );
        res.json(result);
        return;
      }

      // mode === "request" (default): create approval request
      if (!approvalService) {
        res.status(400).json({ detail: "Approval service is not enabled" });
        return;
      }

      const approval = approvalService.create({
        conversationId: req.params.conversationId,
        actionType: "cleanup_conversation_workspaces",
        title: "Clean Conversation Workspaces",
        description: `Clean all eligible run workspaces in conversation ${req.params.conversationId}`,
        payload: {
          conversationId: req.params.conversationId,
        },
      });

      res.status(201).json(approval);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cleanup failed";
      const statusCode = (error as any).statusCode ?? 500;
      res.status(statusCode).json({ detail: message });
    }
  });

  router.get("/runs/:runId/change-application", (req, res) => {
    if (!changeApplicationService) {
      res.status(400).json({ detail: "Change application is not enabled" });
      return;
    }

    try {
      const application = changeApplicationService.getApplicationForRun(req.params.runId);
      res.json(application);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to get change application";
      res.status(500).json({ detail: message });
    }
  });

  router.get("/runs/:runId/apply-check", (req, res) => {
    if (!changeApplicationService) {
      res.status(400).json({ detail: "Change application is not enabled" });
      return;
    }

    try {
      const result = changeApplicationService.checkRunChanges(req.params.runId);
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to check changes";
      const statusCode = (error as any).statusCode ?? 500;
      res.status(statusCode).json({ detail: message });
    }
  });

  router.post("/runs/:runId/apply-changes", (req, res) => {
    if (!changeApplicationService) {
      res.status(400).json({ detail: "Change application is not enabled" });
      return;
    }

    const mode = req.body?.mode ?? "request";
    const actionType =
      req.body?.actionType === "apply_and_commit" ? "apply_and_commit" : "apply_changes";

    try {
      // Always run apply-check first
      const check = changeApplicationService.checkRunChanges(req.params.runId);

      if (!check.canApply) {
        res.status(409).json({ detail: "Apply conflicts detected", check });
        return;
      }

      if (mode === "execute") {
        const result = actionType === "apply_and_commit"
          ? changeApplicationService.applyAndCommitRunChanges(req.params.runId)
          : changeApplicationService.applyRunChanges(req.params.runId);
        res.json(result);
        return;
      }

      // mode === "request" (default): create approval request
      if (!approvalService) {
        res.status(400).json({ detail: "Approval service is not enabled" });
        return;
      }

      const run = runManager.getRun(req.params.runId);
      if (!run) {
        res.status(404).json({ detail: "Run not found" });
        return;
      }

      const approval = approvalService.create({
        conversationId: run.conversation_id,
        runId: req.params.runId,
        actionType,
        title: actionType === "apply_and_commit" ? "Apply and Commit" : "Apply Changes",
        description: `${check.summary.safe} file(s) ready to apply. ${check.summary.skipped > 0 ? `${check.summary.skipped} skipped.` : ""}`,
        payload: {
          runId: req.params.runId,
          actionType,
          summary: check.summary,
          files: check.files.map((f) => ({ filePath: f.filePath, status: f.status })),
        },
      });

      res.status(201).json(approval);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply changes";
      const statusCode = (error as any).statusCode ?? 500;
      const check = (error as any).check as ApplyCheckResult | undefined;
      if (statusCode === 409 && check) {
        res.status(409).json({ detail: message, check });
        return;
      }
      res.status(statusCode).json({ detail: message });
    }
  });

  router.post("/runs/:runId/conflict-resolution", (req, res) => {
    if (!changeApplicationService) {
      res.status(400).json({ detail: "Change application is not enabled" });
      return;
    }

    const mode = req.body?.mode ?? "request";
    const actionType =
      req.body?.actionType === "apply_and_commit" ? "apply_and_commit" : "apply_changes";
    const resolutions = Array.isArray(req.body?.resolutions) ? req.body.resolutions : [];

    try {
      const check = changeApplicationService.checkRunChanges(req.params.runId);
      const conflictFiles = check.files.filter((file) => file.status === "conflict");
      if (conflictFiles.length === 0) {
        res.status(400).json({ detail: "Run has no conflicts to resolve" });
        return;
      }

      if (mode === "execute") {
        const result = changeApplicationService.applyConflictResolutions(
          req.params.runId,
          resolutions,
          { commit: actionType === "apply_and_commit" },
        );
        res.json(result);
        return;
      }

      if (!approvalService) {
        res.status(400).json({ detail: "Approval service is not enabled" });
        return;
      }

      const run = runManager.getRun(req.params.runId);
      if (!run) {
        res.status(404).json({ detail: "Run not found" });
        return;
      }

      const approval = approvalService.create({
        conversationId: run.conversation_id,
        runId: req.params.runId,
        taskId: run.task_id,
        assignmentId: run.assignment_id,
        actionType: "resolve_conflicts",
        title: "Resolve Conflicts",
        description: `${conflictFiles.length} conflict file(s) selected for resolution.`,
        payload: {
          runId: req.params.runId,
          actionType,
          resolutions,
          summary: check.summary,
        },
      });
      res.status(201).json(approval);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve conflicts";
      const statusCode = (error as any).statusCode ?? 500;
      res.status(statusCode).json({ detail: message });
    }
  });

  router.post("/runs/:runId/interrupt", async (req, res) => {
    try {
      const run = await runManager.interruptRun(req.params.runId);
      res.json(run);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to interrupt run";
      const status = /not found/i.test(message) ? 404 : 400;
      res.status(status).json({ detail: message });
    }
  });
  return router;
}
