import type {
  Agent,
  ApprovalRequest,
  ConversationSummary,
  CreateConversationWithWorkspaceResponse,
  RuntimeAdapterCheck,
  RuntimeAdapterInfo,
  ApplyCheckResult,
  ConflictResolutionChoice,
  ConversationTimelineItem,
  Conversation,
  FileChange,
  Mention,
  Message,
  OrchestrateResponse,
  PreviewStartResponse,
  DeployRecord,
  DeployScriptsResponse,
  RerunTaskResponse,
  ResumePlanResponse,
  Run,
  RunCardSummary,
  RunChangeApplication,
  RunSummary,
  RunWorkspace,
  Task,
  TaskDetail,
  TaskAssignment,
  Workspace,
  WorkspaceDeployRecord,
  WorkspaceDeployScriptsResponse,
  WorkspaceDiffResponse,
  WorkspaceExecutionStatus,
  WorkspaceValidationResult,
} from '../types';

const BASE_URL = 'http://localhost:8000';
const RUNTIME_CHECK_CACHE_TTL_MS = 30_000;
const APPROVALS_CACHE_TTL_MS = 5_000;

type RuntimeCheckCacheEntry = {
  value: RuntimeAdapterCheck;
  expiresAt: number;
};

const runtimeCheckCache = new Map<string, RuntimeCheckCacheEntry>();
const runtimeCheckInflight = new Map<string, Promise<RuntimeAdapterCheck>>();
const approvalsCache = new Map<string, { value: ApprovalRequest[]; expiresAt: number }>();
const approvalsInflight = new Map<string, Promise<ApprovalRequest[]>>();

function logRuntimeCheck(adapterType: string, state: 'cache_hit' | 'inflight_join' | 'network_request') {
  const stack = new Error().stack
    ?.split('\n')
    .slice(2, 6)
    .map((line) => line.trim())
    .join(' | ');
  console.debug(`[runtime check] ${adapterType} ${state}${stack ? ` :: ${stack}` : ''}`);
}

export class ApiError extends Error {
  code?: string;
  workspaceStatus?: WorkspaceExecutionStatus;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const apiError = new ApiError(err.detail || `HTTP ${res.status}`);
    apiError.code = typeof err.code === 'string' ? err.code : undefined;
    apiError.workspaceStatus =
      err.workspaceStatus && typeof err.workspaceStatus === 'object'
        ? (err.workspaceStatus as WorkspaceExecutionStatus)
        : undefined;
    throw apiError;
  }
  return res.json();
}

function getCachedRuntimeCheck(adapterType: string): RuntimeAdapterCheck | null {
  const cached = runtimeCheckCache.get(adapterType);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    runtimeCheckCache.delete(adapterType);
    return null;
  }
  return cached.value;
}

function getCachedApprovals(conversationId: string): ApprovalRequest[] | null {
  const cached = approvalsCache.get(conversationId);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    approvalsCache.delete(conversationId);
    return null;
  }
  return cached.value;
}

function invalidateConversationApprovals(conversationId: string | null | undefined) {
  if (!conversationId) {
    return;
  }
  approvalsCache.delete(conversationId);
  approvalsInflight.delete(conversationId);
}

export const api = {
  async listConversations(): Promise<Conversation[]> {
    const res = await fetch(`${BASE_URL}/conversations`);
    return handleResponse(res);
  },

  async createConversation(title?: string, type: 'single' | 'group' = 'single'): Promise<Conversation> {
    const res = await fetch(`${BASE_URL}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type }),
    });
    return handleResponse(res);
  },

  async getConversation(id: string): Promise<Conversation> {
    const res = await fetch(`${BASE_URL}/conversations/${id}`);
    return handleResponse(res);
  },

  async listAgents(includeDisabled = false): Promise<Agent[]> {
    const query = includeDisabled ? '?includeDisabled=true' : '';
    const res = await fetch(`${BASE_URL}/agents${query}`);
    return handleResponse(res);
  },

  async getAgent(agentId: string): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}`);
    return handleResponse(res);
  },

  async createAgent(payload: {
    name: string;
    slug?: string;
    adapterType: string;
    instructions?: string;
    capabilities?: string[];
    enabled?: boolean;
    isDefault?: boolean;
  }): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async updateAgent(
    agentId: string,
    payload: {
      name?: string;
      slug?: string;
      adapterType?: string;
      instructions?: string;
      capabilities?: string[];
      enabled?: boolean;
      isDefault?: boolean;
    },
  ): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async setDefaultAgent(agentId: string): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}/default`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async disableAgent(agentId: string): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}/disable`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async enableAgent(agentId: string): Promise<Agent> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}/enable`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async deleteAgent(agentId: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/agents/${agentId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
  },

  async getRuntimes(): Promise<RuntimeAdapterInfo[]> {
    const res = await fetch(`${BASE_URL}/runtimes`);
    return handleResponse(res);
  },

  async checkRuntime(adapterType: string): Promise<RuntimeAdapterCheck> {
    const cached = getCachedRuntimeCheck(adapterType);
    if (cached) {
      logRuntimeCheck(adapterType, 'cache_hit');
      return cached;
    }

    const inflight = runtimeCheckInflight.get(adapterType);
    if (inflight) {
      logRuntimeCheck(adapterType, 'inflight_join');
      return inflight;
    }

    logRuntimeCheck(adapterType, 'network_request');
    const request = fetch(`${BASE_URL}/runtimes/${adapterType}/check`)
      .then((res) => handleResponse<RuntimeAdapterCheck>(res))
      .then((result) => {
        runtimeCheckCache.set(adapterType, {
          value: result,
          expiresAt: Date.now() + RUNTIME_CHECK_CACHE_TTL_MS,
        });
        return result;
      })
      .finally(() => {
        runtimeCheckInflight.delete(adapterType);
      });

    runtimeCheckInflight.set(adapterType, request);
    return request;
  },

  async checkAllRuntimes(): Promise<RuntimeAdapterCheck[]> {
    const res = await fetch(`${BASE_URL}/runtimes/check`);
    return handleResponse(res);
  },

  async getWorkspace(conversationId: string): Promise<Workspace | null> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/workspace`);
    return handleResponse(res);
  },

  async bindWorkspace(conversationId: string, rootPath: string): Promise<Workspace> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath }),
    });
    return handleResponse(res);
  },

  async listRuns(conversationId: string): Promise<RunSummary[]> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/runs`);
    return handleResponse(res);
  },

  async getRun(runId: string): Promise<Run> {
    const res = await fetch(`${BASE_URL}/runs/${runId}`);
    return handleResponse(res);
  },

  async createRun(
    conversationId: string,
    prompt: string,
    agentId?: string,
    sourceMessageId?: string,
  ): Promise<Run> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, agentId, sourceMessageId }),
    });
    return handleResponse(res);
  },

  async createMessage(
    conversationId: string,
    payload: {
      content: string;
      mentions?: Mention[];
      messageType?: 'text' | 'command';
    },
  ): Promise<Message> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async getConversationMessages(conversationId: string): Promise<Message[]> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/messages`);
    return handleResponse(res);
  },

  async getConversationTimeline(
    conversationId: string,
  ): Promise<ConversationTimelineItem[]> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/timeline`);
    return handleResponse(res);
  },

  async getConversationTasks(conversationId: string): Promise<Task[]> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/tasks`);
    return handleResponse(res);
  },

  async getTask(taskId: string): Promise<Task & { assignments: TaskAssignment[]; latestRun: RunSummary | null }> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}`);
    return handleResponse(res);
  },

  async getTaskDetail(taskId: string): Promise<TaskDetail> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/detail`);
    return handleResponse(res);
  },

  async getTaskAssignments(taskId: string): Promise<TaskAssignment[]> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/assignments`);
    return handleResponse(res);
  },

  async getConversationAssignments(conversationId: string): Promise<TaskAssignment[]> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/assignments`);
    return handleResponse(res);
  },

  async updateTaskStatus(taskId: string, status: 'cancelled'): Promise<Task> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return handleResponse(res);
  },

  async rerunTask(taskId: string, payload?: { agentId?: string }): Promise<RerunTaskResponse> {
    const res = await fetch(`${BASE_URL}/tasks/${taskId}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
    });
    return handleResponse(res);
  },

  async resumePlan(planMessageId: string, from: string): Promise<ResumePlanResponse> {
    const res = await fetch(`${BASE_URL}/plans/${planMessageId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from }),
    });
    return handleResponse(res);
  },

  async interruptRun(runId: string): Promise<Run> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/interrupt`, { method: 'POST' });
    return handleResponse(res);
  },

  async getRunFileChanges(runId: string): Promise<FileChange[]> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/file-changes`);
    return handleResponse(res);
  },

  async getWorkspaceFileChanges(workspaceId: string): Promise<WorkspaceDiffResponse> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/file-changes`);
    return handleResponse(res);
  },

  async startWorkspacePreview(workspaceId: string): Promise<PreviewStartResponse> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/preview/start`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async stopWorkspacePreview(workspaceId: string): Promise<{ ok: true }> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/preview/stop`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async getWorkspaceDeployScripts(workspaceId: string): Promise<WorkspaceDeployScriptsResponse> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy/scripts`);
    return handleResponse(res);
  },

  async startWorkspaceDeploy(
    workspaceId: string,
    script?: string,
  ): Promise<WorkspaceDeployRecord> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    return handleResponse(res);
  },

  async getWorkspaceDeploy(workspaceId: string): Promise<WorkspaceDeployRecord | null> {
    const res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy`);
    return handleResponse(res);
  },

  async startRunPreview(runId: string): Promise<PreviewStartResponse> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/preview/start`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async stopRunPreview(runId: string): Promise<{ ok: true }> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/preview/stop`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async getRunDeployScripts(runId: string): Promise<DeployScriptsResponse> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/deploy/scripts`);
    return handleResponse(res);
  },

  async startRunDeploy(runId: string, script?: string): Promise<DeployRecord> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/deploy/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    return handleResponse(res);
  },

  async getRunDeploy(runId: string): Promise<DeployRecord | null> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/deploy`);
    return handleResponse(res);
  },

  async getRunWorkspace(runId: string): Promise<RunWorkspace> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/workspace`);
    return handleResponse(res);
  },

  async orchestrateConversation(
    conversationId: string,
    prompt: string,
    sourceMessageId?: string,
    preview?: boolean,
  ): Promise<OrchestrateResponse> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, sourceMessageId, preview }),
    });
    return handleResponse(res);
  },

  async executePlan(planMessageId: string): Promise<OrchestrateResponse> {
    const res = await fetch(`${BASE_URL}/plans/${planMessageId}/execute`, {
      method: 'POST',
    });
    return handleResponse(res);
  },

  async getRunChangeApplication(runId: string): Promise<RunChangeApplication | null> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/change-application`);
    return handleResponse(res);
  },

  async getRunCardSummary(runId: string): Promise<RunCardSummary> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/card-summary`);
    return handleResponse(res);
  },

  async checkRunApply(runId: string): Promise<ApplyCheckResult> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/apply-check`);
    return handleResponse(res);
  },

  async applyRunChanges(
    runId: string,
    mode: 'request' | 'execute' = 'request',
    actionType: 'apply_changes' | 'apply_and_commit' = 'apply_changes',
  ): Promise<RunChangeApplication | ApprovalRequest | Record<string, unknown>> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/apply-changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, actionType }),
    });
    if (res.status === 409) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const error = Object.assign(new Error(err.detail || 'Apply conflicts detected'), {
        statusCode: 409,
        check: err.check as ApplyCheckResult | undefined,
      });
      throw error;
    }
    const result = await handleResponse<RunChangeApplication | ApprovalRequest | Record<string, unknown>>(res);
    if (mode === 'request' && result && typeof result === 'object' && 'conversationId' in result) {
      invalidateConversationApprovals(
        typeof result.conversationId === 'string' ? result.conversationId : null,
      );
    }
    return result;
  },

  async requestApplyChanges(runId: string): Promise<ApprovalRequest> {
    return api.applyRunChanges(runId, 'request', 'apply_changes') as Promise<ApprovalRequest>;
  },

  async requestApplyAndCommit(runId: string): Promise<ApprovalRequest> {
    return api.applyRunChanges(runId, 'request', 'apply_and_commit') as Promise<ApprovalRequest>;
  },

  async requestConflictResolution(
    runId: string,
    resolutions: ConflictResolutionChoice[],
    actionType: 'apply_changes' | 'apply_and_commit' = 'apply_changes',
  ): Promise<ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/conflict-resolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'request', actionType, resolutions }),
    });
    const approval = await handleResponse<ApprovalRequest>(res);
    invalidateConversationApprovals(approval.conversationId);
    return approval;
  },

  async cleanupRunWorkspace(runId: string, mode: 'request' | 'execute' = 'request'): Promise<RunWorkspace | ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/runs/${runId}/workspace/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return handleResponse(res);
  },

  async cleanupConversationWorkspaces(
    conversationId: string,
    mode: 'request' | 'execute' = 'request',
  ): Promise<{ cleaned: RunWorkspace[]; skipped: Array<{ runId: string; reason: string }> } | ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/workspaces/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return handleResponse(res);
  },

  async getConversationApprovals(conversationId: string): Promise<ApprovalRequest[]> {
    const cached = getCachedApprovals(conversationId);
    if (cached) {
      return cached;
    }

    const inflight = approvalsInflight.get(conversationId);
    if (inflight) {
      return inflight;
    }

    const request = fetch(`${BASE_URL}/conversations/${conversationId}/approvals`)
      .then((res) => handleResponse<ApprovalRequest[]>(res))
      .then((result) => {
        approvalsCache.set(conversationId, {
          value: result,
          expiresAt: Date.now() + APPROVALS_CACHE_TTL_MS,
        });
        return result;
      })
      .finally(() => {
        approvalsInflight.delete(conversationId);
      });

    approvalsInflight.set(conversationId, request);
    return request;
  },

  async getApproval(approvalId: string): Promise<ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/approvals/${approvalId}`);
    return handleResponse(res);
  },

  async approveApproval(approvalId: string): Promise<ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/approvals/${approvalId}/approve`, {
      method: 'POST',
    });
    const approval = await handleResponse<ApprovalRequest>(res);
    invalidateConversationApprovals(approval.conversationId);
    return approval;
  },

  async rejectApproval(approvalId: string): Promise<ApprovalRequest> {
    const res = await fetch(`${BASE_URL}/approvals/${approvalId}/reject`, {
      method: 'POST',
    });
    const approval = await handleResponse<ApprovalRequest>(res);
    invalidateConversationApprovals(approval.conversationId);
    return approval;
  },

  async validateWorkspace(rootPath: string): Promise<WorkspaceValidationResult> {
    const res = await fetch(`${BASE_URL}/workspaces/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath }),
    });
    return handleResponse(res);
  },

  async createConversationWithWorkspace(payload: {
    title?: string;
    rootPath: string;
    type?: 'single' | 'group';
  }): Promise<CreateConversationWithWorkspaceResponse> {
    const res = await fetch(`${BASE_URL}/conversations/with-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async getConversationSummary(conversationId: string): Promise<ConversationSummary> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}/summary`);
    return handleResponse(res);
  },

  async deleteConversation(
    conversationId: string,
    options?: { cleanupRunWorkspaces?: boolean },
  ): Promise<{ ok: true; deletedConversationId: string; workspaceCleanup?: { cleaned: unknown[]; skipped: Array<{ runId: string; reason: string }> } }> {
    const res = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cleanupRunWorkspaces: options?.cleanupRunWorkspaces ?? false }),
    });
    return handleResponse(res);
  },
};
