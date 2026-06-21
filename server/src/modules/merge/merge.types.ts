import {
  ConflictResolutionChoice,
  MergeConflictFile,
  RunMerge,
  RunMergeRecord,
  RunMergeStatus,
  WorkspaceChangedEvent,
} from "../../shared/types.js";

export type MergeResolutionResult =
  | {
      status: "merged";
      merge: RunMerge;
    }
  | {
      status: "needs_approval";
      merge: RunMerge;
    };

export interface MergeServiceDeps {
  getRun: (runId: string) => {
    id: string;
    conversation_id: string;
    task_id: string | null;
    assignment_id: string | null;
    workspace_id: string;
    agent_id: string;
    status: string;
  } | null;
  getRunWorkspace: (runId: string) => {
    root_path: string;
    status: string;
  } | null;
  getBaseWorkspaceRootPath: (workspaceId: string) => string | null;
  getFileChanges: (runId: string) => Array<{
    filePath: string;
    changeType: "create" | "edit" | "delete" | "unknown";
    oldContent: string;
    newContent: string;
  }>;
  canAutoResolveConflict?: (conflict: MergeConflictFile) => Promise<{
    canAutoMerge: boolean;
    mergedContent?: string;
    reason?: string;
  }>;
  onWorkspaceChanged?: (event: WorkspaceChangedEvent) => void;
}

export interface PersistMergeInput {
  runId: string;
  conversationId: string;
  taskId: string | null;
  assignmentId: string | null;
  status: RunMergeStatus;
  appliedFiles: string[];
  conflicts: MergeConflictFile[];
  blockedReason: string | null;
  approvalId?: string | null;
  mergedAt?: string | null;
}

export function recordToRunMerge(record: RunMergeRecord): RunMerge {
  return {
    id: record.id,
    runId: record.run_id,
    conversationId: record.conversation_id,
    taskId: record.task_id,
    assignmentId: record.assignment_id,
    status: record.status,
    appliedFiles: record.applied_files_json ? JSON.parse(record.applied_files_json) as string[] : [],
    conflicts: record.conflict_files_json ? JSON.parse(record.conflict_files_json) as MergeConflictFile[] : [],
    blockedReason: record.blocked_reason,
    approvalId: record.approval_id,
    mergedAt: record.merged_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export function indexResolutions(
  resolutions: ConflictResolutionChoice[],
): Map<string, ConflictResolutionChoice["strategy"]> {
  return new Map(resolutions.map((resolution) => [resolution.filePath, resolution.strategy]));
}
