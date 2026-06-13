import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { WorkspacesService } from "./workspaces.service.js";

export function createWorkspacesRouter(
  conversationsService: ConversationsService,
  workspacesService: WorkspacesService,
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
