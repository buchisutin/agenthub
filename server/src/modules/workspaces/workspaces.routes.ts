import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { WorkspacesService } from "./workspaces.service.js";
import { WorkspaceDiffService } from "./workspace-diff.service.js";

export function createWorkspacesRouter(
  conversationsService: ConversationsService,
  workspacesService: WorkspacesService,
  workspaceDiffService: WorkspaceDiffService,
): Router {
  const router = Router({ mergeParams: true });

  router.get("/conversations/:conversationId/workspace", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const workspace = workspacesService.getByConversationId(
      req.params.conversationId,
    );
    if (!workspace) {
      res.json(null);
      return;
    }

    res.json(workspace);
  });

  router.post("/workspaces/validate", (req, res) => {
    const rootPath = typeof req.body?.rootPath === "string" ? req.body.rootPath.trim() : "";
    if (!rootPath) {
      res.status(400).json({ detail: "rootPath is required" });
      return;
    }

    const result = workspacesService.validateWorkspacePath(rootPath);
    res.json(result);
  });

  router.get("/workspaces/:workspaceId/file-changes", (req, res) => {
    try {
      res.json(workspaceDiffService.getFileChanges(req.params.workspaceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load workspace changes";
      const status = /not found/i.test(message) ? 404 : /git|workspace path/i.test(message) ? 400 : 500;
      res.status(status).json({ detail: message });
    }
  });

  router.post("/conversations/:conversationId/workspace", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    try {
      const workspace = workspacesService.bindWorkspace(req.params.conversationId, {
        rootPath: req.body?.rootPath,
      });
      res.status(201).json(workspace);
    } catch (error) {
      res.status(400).json({
        detail: error instanceof Error ? error.message : "Invalid workspace",
      });
    }
  });

  return router;
}
