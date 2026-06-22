import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { ApprovalService } from "./approvals.service.js";
import { ApprovalRequest, RuntimeEvent } from "../../shared/types.js";

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
  emitEvent?: (event: RuntimeEvent) => void,
): Router {
  const router = Router();

  // Called by the PreToolUse hook script running inside Claude Code CLI subprocesses.
  // Creates an ApprovalRequest and pushes a socket event so the frontend can prompt the user.
  router.post("/internal/hook/approval", (req, res) => {
    const runId = req.headers["x-run-id"] as string | undefined;
    const conversationId = req.headers["x-conv-id"] as string | undefined;
    const body = req.body as Record<string, unknown>;
    const toolName = typeof body.tool_name === "string" ? body.tool_name : "unknown";
    const toolInput = body.tool_input as Record<string, unknown> | undefined;

    if (!runId || !conversationId) {
      res.status(400).json({ detail: "Missing X-Run-Id or X-Conv-Id header" });
      return;
    }

    const approval = approvalService.create({
      conversationId,
      runId,
      actionType: "tool_use",
      title: `Allow ${toolName}?`,
      description: toolInput ? JSON.stringify(toolInput, null, 2) : null,
      payload: { toolName, toolInput: toolInput ?? {} },
    });

    emitEvent?.({
      type: "approval_required",
      runId,
      conversationId,
      approvalId: approval.id,
      reason: `Tool use requires approval: ${toolName}`,
    });

    res.json({ approvalId: approval.id });
  });

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

      if (approval.runId) {
        emitEvent?.({
          type: "approval_status_changed",
          runId: approval.runId,
          conversationId: approval.conversationId,
          approvalId: approval.id,
          status: "approved",
        });
      }

      if (!executor || approval.actionType === "tool_use") {
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

      if (approval.runId) {
        emitEvent?.({
          type: "approval_status_changed",
          runId: approval.runId,
          conversationId: approval.conversationId,
          approvalId: approval.id,
          status: "rejected",
        });
      }

      res.json(approval);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject";
      const statusCode = (error as any).statusCode ?? 400;
      res.status(statusCode).json({ detail: message });
    }
  });

  return router;
}
