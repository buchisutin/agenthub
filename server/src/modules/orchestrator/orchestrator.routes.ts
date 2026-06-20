import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { OrchestratorService } from "./orchestrator.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";

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

export function createOrchestratorRouter(
  conversationsService: ConversationsService,
  workspacesService: WorkspacesService,
  orchestratorService: OrchestratorService,
): Router {
  const router = Router();

  router.post("/conversations/:conversationId/orchestrate", async (req, res) => {
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

    // @slug direct routing — bypasses orchestrateConversation intentionally, not subject to message queue
    const atMatch = /^@([a-z0-9-]+)\s+([\s\S]+)/i.exec(prompt);
    if (atMatch) {
      try {
        const directResult = await orchestratorService.dispatchDirectRun(
          req.params.conversationId,
          atMatch[1],
          atMatch[2].trim(),
          typeof req.body?.sourceMessageId === "string" ? req.body.sourceMessageId : undefined,
        );
        if (directResult) {
          res.json(directResult);
          return;
        }
        // Agent not found for slug — fall through to normal orchestrate
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to dispatch direct run";
        const status = /conversation not found/i.test(message) ? 404 : 500;
        res.status(status).json({ detail: message });
        return;
      }
    }

    try {
      const result = await orchestratorService.orchestrateConversation(
        req.params.conversationId,
        prompt,
        typeof req.body?.sourceMessageId === "string"
          ? req.body.sourceMessageId
          : undefined,
      );
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to orchestrate conversation";
      const status = /available agent/i.test(message)
        ? 400
        : /cyclic dependency/i.test(message)
          ? 400
        : /sourceMessageId/i.test(message)
          ? 400
        : /conversation not found/i.test(message)
          ? 404
          : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/plans/:planMessageId/resume", async (req, res) => {
    const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";
    if (!from) {
      res.status(400).json({ detail: "from is required" });
      return;
    }

    try {
      const result = await orchestratorService.resumePlanFromTask(
        req.params.planMessageId,
        from,
      );
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resume plan";
      const status = /not found/i.test(message)
        ? 404
        : /running/i.test(message)
          ? 409
          : 400;
      res.status(status).json({ detail: message });
    }
  });

  return router;
}
