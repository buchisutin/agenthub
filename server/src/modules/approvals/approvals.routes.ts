import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { ApprovalService } from "./approvals.service.js";
import { ApprovalRequest } from "../../shared/types.js";

export interface ApprovalExecutor {
  executeApplyChanges(runId: string): Promise<Record<string, unknown>>;
  executeApplyAndCommit(runId: string): Promise<Record<string, unknown>>;
  executeResolveConflicts(approval: ApprovalRequest): Promise<Record<string, unknown>>;
  executeCleanupWorkspace(runId: string): Promise<Record<string, unknown>>;
  executeCleanupConversationWorkspaces(conversationId: string): Promise<Record<string, unknown>>;
}

export function createApprovalsRouter(
  conversationsService: ConversationsService,
  approvalService: ApprovalService,
  executor?: ApprovalExecutor,
): Router {
  const router = Router();

  router.get("/conversations/:conversationId/approvals", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }
    res.json(approvalService.listByConversation(req.params.conversationId));
  });

  router.get("/approvals/:approvalId", (req, res) => {
    const approval = approvalService.getById(req.params.approvalId);
    if (!approval) {
      res.status(404).json({ detail: "Approval request not found" });
      return;
    }
    res.json(approval);
  });

  router.post("/approvals/:approvalId/approve", async (req, res) => {
    try {
      const approval = approvalService.approve(req.params.approvalId);

      if (!executor) {
        res.json(approval);
        return;
      }

      try {
        let result: Record<string, unknown>;
        switch (approval.actionType) {
          case "apply_changes": {
            if (!approval.runId) {
              throw new Error("Approval has no runId");
            }
            result = await executor.executeApplyChanges(approval.runId);
            break;
          }
          case "apply_and_commit": {
            if (!approval.runId) {
              throw new Error("Approval has no runId");
            }
            result = await executor.executeApplyAndCommit(approval.runId);
            break;
          }
          case "resolve_conflicts": {
            result = await executor.executeResolveConflicts(approval);
            break;
          }
          case "cleanup_workspace": {
            if (!approval.runId) {
              throw new Error("Approval has no runId");
            }
            result = await executor.executeCleanupWorkspace(approval.runId);
            break;
          }
          case "cleanup_conversation_workspaces": {
            result = await executor.executeCleanupConversationWorkspaces(approval.conversationId);
            break;
          }
          default:
            throw new Error(`Unknown action type: ${approval.actionType}`);
        }

        const executed = approvalService.markExecuted(req.params.approvalId, result);
        res.json(executed);
      } catch (execError) {
        const msg = execError instanceof Error ? execError.message : "Execution failed";
        const failed = approvalService.markFailed(req.params.approvalId, msg);
        res.status(500).json(failed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve";
      const statusCode = (error as any).statusCode ?? 400;
      res.status(statusCode).json({ detail: message });
    }
  });

  router.post("/approvals/:approvalId/reject", (req, res) => {
    try {
      const approval = approvalService.reject(req.params.approvalId);
      res.json(approval);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject";
      const statusCode = (error as any).statusCode ?? 400;
      res.status(statusCode).json({ detail: message });
    }
  });

  return router;
}
