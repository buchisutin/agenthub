export type ConversationType = "single" | "group";
export type WorkspaceMode = "direct";
export type RunWorkspaceMode = "git_worktree" | "git_clone" | "copy";
export type RunWorkspaceStatus = "creating" | "ready" | "failed" | "cleaned";
export type AgentStatus = "active" | "unavailable";
export type SessionStatus = "none" | "active" | "invalid" | "interrupted";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "in_review"
  | "blocked"
  | "done"
  | "cancelled"
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";
export type AssignmentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";
export type RuntimeMode = "local" | "cloud";
export type RuntimeStatus = "online" | "offline" | "busy" | "error";
export type AgentSessionLifecycleStatus =
  | "none"
  | "active"
  | "invalid"
  | "interrupted"
  | "closed";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";
export type RunTriggerType = "chat" | "task" | "autopilot" | "workflow";
export type MessageSenderType = "user" | "agent" | "system" | "orchestrator";
export type MessageType = "text" | "command" | "plan" | "system" | "conflict_review" | "queued_prompt";
export type TaskType =
  | "frontend"
  | "backend"
  | "test"
  | "docs"
  | "review"
  | "deploy"
  | "general";

export type RuntimeEventType =
  | "text_delta"
  | "tool_started"
  | "tool_input_delta"
  | "tool_completed"
  | "tool_result"
  | "tool_error"
  | "session_bound"
  | "command_started"
  | "command_output"
  | "file_changed"
  | "approval_required"
  | "approval_status_changed"
  | "run_status_changed"
  | "run_completed"
  | "run_failed"
  | "run_interrupted";

export type OrchestratorEventType =
  | "orchestrator_planning_started"
  | "orchestrator_text_delta"
  | "orchestrator_planning_done";

export interface ConversationRecord {
  id: string;
  title: string | null;
  type: ConversationType;
  task_id: string | null;
  agent_platform: string | null;
  created_at: string;
  updated_at: string;
  task: TaskSummary | null;
}

export interface TaskRecord {
  id: string;
  conversation_id: string | null;
  source_message_id: string | null;
  plan_message_id: string | null;
  parent_task_id: string | null;
  depends_on: string[];
  title: string;
  description: string | null;
  task_type: TaskType | null;
  expected_output: string | null;
  status: TaskStatus;
  priority: number;
  workspace_id: string | null;
  owner_id: string | null;
  assignee_type: string | null;
  assignee_id: string | null;
  created_by_type: MessageSenderType | null;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignmentRecord {
  id: string;
  task_id: string;
  conversation_id: string;
  agent_id: string;
  status: AssignmentStatus;
  latest_run_id: string | null;
  assigned_by_type: "orchestrator" | "user" | "system" | null;
  assigned_by_id: string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata_json: Record<string, unknown> | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface AgentRecord {
  id: string;
  name: string;
  slug: string;
  platform: string;
  adapter_type: string;
  instructions: string | null;
  status: AgentStatus;
  capabilities: string[] | null;
  config_json: Record<string, unknown> | null;
  enabled: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuntimeAdapterInfo {
  adapterType: string;
  displayName: string;
  capabilities: string[];
  registered: boolean;
}

export interface RuntimeAdapterCheck {
  adapterType: string;
  available: boolean;
  message?: string;
  version?: string | null;
  executablePath?: string | null;
}

export interface AgentRuntimeRecord {
  id: string;
  agent_id: string;
  mode: RuntimeMode;
  provider: string;
  status: RuntimeStatus;
  owner_id: string | null;
  runtime_identity: string | null;
  last_heartbeat_at: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSessionRecord {
  id: string;
  task_id: string | null;
  conversation_id: string | null;
  agent_id: string;
  runtime_id: string;
  provider_session_id: string | null;
  status: AgentSessionLifecycleStatus;
  invalid_reason: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  last_resumed_at: string | null;
  updated_at: string;
}

export interface WorkspaceRecord {
  id: string;
  conversation_id: string;
  root_path: string;
  mode: WorkspaceMode;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceExecutionStatus {
  state: "clean" | "dirty" | "unavailable";
  gitRoot: string | null;
  dirtyFilesCount: number;
  dirtyFilesSample: string[];
  lastCommit: string | null;
  suggestion: string;
}

export interface RunWorkspaceRecord {
  id: string;
  run_id: string;
  conversation_id: string;
  base_workspace_id: string;
  mode: RunWorkspaceMode;
  root_path: string;
  branch_name: string | null;
  base_ref: string | null;
  status: RunWorkspaceStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunWorkspaceSummary {
  mode: string;
  rootPath: string | null;
  branchName: string | null;
  status: string;
  errorMessage: string | null;
}

export interface RunCardSummary {
  workspace: RunWorkspaceSummary;
  changeApplication: RunChangeApplication | null;
  fileChanges: FileChange[];
  mergeMode: "auto" | "manual";
  mergeStatus: RunMergeStatus | null;
  merge: RunMerge | null;
}

export interface AgentRunRecord {
  id: string;
  conversation_id: string;
  task_id: string | null;
  assignment_id: string | null;
  agent_id: string;
  runtime_id: string | null;
  agent_session_id: string | null;
  source_message_id: string | null;
  workspace_id: string;
  prompt: string;
  trigger_type: RunTriggerType;
  trigger_source_id: string | null;
  requested_by: string | null;
  status: RunStatus;
  pid: number | null;
  exit_code: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface RunEventRecord {
  id: string;
  event_id: string;
  run_id: string;
  conversation_id: string;
  event_type: RuntimeEventType;
  event_family: string;
  dedup_key: string;
  seq: number;
  payload_json: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface RunSummary extends AgentRunRecord {
  event_count: number;
}

export interface RunDetail extends AgentRunRecord {
  events: RunEventRecord[];
}

export interface Mention {
  type: "agent" | "orchestrator" | "unknown";
  targetId?: string | null;
  raw: string;
  start?: number;
  end?: number;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  sender_type: MessageSenderType;
  sender_id: string | null;
  content: string;
  message_type: MessageType;
  mentions: Mention[] | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface FileChange {
  filePath: string;
  changeType: "create" | "edit" | "delete" | "unknown";
  oldContent: string;
  newContent: string;
  confidence: "exact" | "snapshot" | "best_effort";
  source: "snapshot" | "read_tool" | "tool_event" | "filesystem";
}

export interface ProjectFileChange extends FileChange {
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface WorkspaceDiffResponse {
  workspaceId: string;
  baseRef: "HEAD";
  files: ProjectFileChange[];
  summary: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface WorkspaceChangedEvent {
  type: "workspace_changed";
  eventId?: string;
  conversationId: string;
  workspaceId: string;
  reason: "merge_completed";
}

export interface PreviewState {
  runId: string;
  port: number;
  url: string;
  status: "starting" | "running" | "stopped" | "failed";
}

export interface PreviewStartResponse {
  url: string;
  port: number;
}

export type DeployStatus = "idle" | "running" | "succeeded" | "failed";

export interface DeployLogEntry {
  stream: "stdout" | "stderr";
  chunk: string;
  at: string;
}

export interface DeployScriptsResponse {
  runId: string;
  scripts: string[];
  defaultScript: string | null;
}

export interface DeployRecord {
  runId: string;
  status: DeployStatus;
  script: string;
  command: string;
  logs: DeployLogEntry[];
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface WorkspaceDeployScriptsResponse {
  workspaceId: string;
  scripts: string[];
  defaultScript: string | null;
}

export type WorkspaceDeployRecord = Omit<DeployRecord, "runId"> & {
  workspaceId: string;
};

export interface TaskPlanItem {
  index: number;
  plannerTaskId?: string;
  title: string;
  description: string;
  taskType?: TaskType;
  expectedOutput?: string;
  affectedFiles?: string[];
  dependsOn?: string[];
  suggestedAgent?: string | null;
  assignedAgentId: string;
  assignedAgentName: string;
  priority: number;
  taskId: string;
  assignmentId: string;
  runId: string | null;
  status: RunStatus | TaskStatus;
  outputSummary?: string | null;
}

export interface TaskPlan {
  id: string;
  summary: string;
  items: TaskPlanItem[];
  dagPreview?: {
    levels: string[][];
    text: string;
  };
}

export interface OrchestrateRequest {
  prompt: string;
  sourceMessageId?: string;
}

export interface OrchestrateResponse {
  plan: TaskPlan | null;
  runs: RunSummary[];
  queued?: boolean;
  pendingClarification?: boolean;
  preview?: boolean;
}

export type ConversationTimelineItem =
  | {
      type: "message";
      message: MessageRecord;
    }
  | {
      type: "plan";
      message: MessageRecord;
      plan: TaskPlan;
      tasks: TaskRecord[];
      assignments: TaskAssignmentRecord[];
    }
  | {
      type: "run";
      run: RunSummary | RunDetail;
    }
  | {
      type: "confirmation";
      approval: ApprovalRequest;
    };

export interface CreateConversationInput {
  title?: string | null;
  type?: ConversationType;
  taskTitle?: string | null;
}

export interface RuntimeBaseEvent {
  eventId?: string;
  occurredAt?: string;
  seq?: number;
  runId: string;
  conversationId: string;
  agentId?: string;
  taskId?: string | null;
  assignmentId?: string | null;
}

export interface TextDeltaEvent extends RuntimeBaseEvent {
  type: "text_delta";
  delta: string;
}

export interface ToolStartedEvent extends RuntimeBaseEvent {
  type: "tool_started";
  toolUseId: string;
  toolName: string;
}

export interface ToolInputDeltaEvent extends RuntimeBaseEvent {
  type: "tool_input_delta";
  toolUseId: string;
  toolName: string;
  partialJson: string;
  parsedInput?: Record<string, unknown>;
}

export interface ToolCompletedEvent extends RuntimeBaseEvent {
  type: "tool_completed";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent extends RuntimeBaseEvent {
  type: "tool_result";
  toolUseId: string;
  toolName: string;
  summary: string;
  content?: string;
  isError?: boolean;
}

export interface ToolErrorEvent extends RuntimeBaseEvent {
  type: "tool_error";
  toolUseId: string;
  toolName: string;
  error: string;
}

export interface SessionBoundEvent extends RuntimeBaseEvent {
  type: "session_bound";
  sessionId: string;
}

export interface CommandStartedEvent extends RuntimeBaseEvent {
  type: "command_started";
  command: string;
}

export interface CommandOutputEvent extends RuntimeBaseEvent {
  type: "command_output";
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface FileChangedEvent extends RuntimeBaseEvent {
  type: "file_changed";
  path: string;
  changeType: string;
}

export interface ApprovalRequiredEvent extends RuntimeBaseEvent {
  type: "approval_required";
  reason: string;
  approvalId?: string;
  rawEvent?: Record<string, unknown>;
}

export interface ApprovalStatusChangedEvent extends RuntimeBaseEvent {
  type: "approval_status_changed";
  approvalId: string;
  status: ApprovalStatus;
}

export interface RunStatusChangedEvent extends RuntimeBaseEvent {
  type: "run_status_changed";
  status: RunStatus;
}

export interface RunCompletedEvent extends RuntimeBaseEvent {
  type: "run_completed";
  finalText: string;
  exitCode: number;
}

export interface RunFailedEvent extends RuntimeBaseEvent {
  type: "run_failed";
  error: string;
}

export interface RunInterruptedEvent extends RuntimeBaseEvent {
  type: "run_interrupted";
  reason: string;
}

export interface OrchestratorPlanningStartedEvent {
  eventId?: string;
  type: "orchestrator_planning_started";
  conversationId: string;
  prompt: string;
}

export interface OrchestratorTextDeltaEvent {
  eventId?: string;
  type: "orchestrator_text_delta";
  conversationId: string;
  delta: string;
}

export interface OrchestratorPlanningDoneEvent {
  eventId?: string;
  type: "orchestrator_planning_done";
  conversationId: string;
  planId: string;
  summary: string;
}

export type RuntimeEvent =
  | TextDeltaEvent
  | ToolStartedEvent
  | ToolInputDeltaEvent
  | ToolCompletedEvent
  | ToolResultEvent
  | ToolErrorEvent
  | SessionBoundEvent
  | CommandStartedEvent
  | CommandOutputEvent
  | FileChangedEvent
  | ApprovalRequiredEvent
  | ApprovalStatusChangedEvent
  | RunStatusChangedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunInterruptedEvent;

export type OrchestratorEvent =
  | OrchestratorPlanningStartedEvent
  | OrchestratorTextDeltaEvent
  | OrchestratorPlanningDoneEvent;

export type RunChangeApplicationStatus = "pending" | "applied" | "failed" | "skipped";

export type ConflictResolutionStrategy = "use_run" | "use_base" | "use_llm";

export interface ConflictResolutionChoice {
  filePath: string;
  strategy: ConflictResolutionStrategy;
}

export interface SkippedFileEntry {
  filePath: string;
  reason: string;
}

export interface RunChangeApplicationRecord {
  id: string;
  run_id: string;
  conversation_id: string;
  run_workspace_id: string | null;
  status: RunChangeApplicationStatus;
  applied_files_json: string | null;
  skipped_files_json: string | null;
  error_message: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunChangeApplication {
  id: string;
  runId: string;
  conversationId: string;
  runWorkspaceId: string | null;
  status: RunChangeApplicationStatus;
  appliedFiles: string[];
  skippedFiles: SkippedFileEntry[];
  errorMessage: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunMergeStatus =
  | "pending"
  | "auto_merged"
  | "conflict_resolved"
  | "needs_approval"
  | "failed";

export interface MergeConflictFile {
  filePath: string;
  changeType: FileChange["changeType"];
  reason: string;
  baseContent: string;
  currentContent: string;
  runContent: string;
  llmAvailable: boolean;
}

export interface RunMergeRecord {
  id: string;
  run_id: string;
  conversation_id: string;
  task_id: string | null;
  assignment_id: string | null;
  status: RunMergeStatus;
  applied_files_json: string | null;
  conflict_files_json: string | null;
  blocked_reason: string | null;
  approval_id: string | null;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunMerge {
  id: string;
  runId: string;
  conversationId: string;
  taskId: string | null;
  assignmentId: string | null;
  status: RunMergeStatus;
  appliedFiles: string[];
  conflicts: MergeConflictFile[];
  blockedReason: string | null;
  approvalId: string | null;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplyCheckStatus = "safe" | "conflict" | "skipped";

export interface ApplyCheckFile {
  filePath: string;
  changeType: FileChange["changeType"];
  status: ApplyCheckStatus;
  reason?: string;
}

export interface ApplyCheckResult {
  runId: string;
  canApply: boolean;
  files: ApplyCheckFile[];
  summary: {
    safe: number;
    conflict: number;
    skipped: number;
  };
}

export interface BindWorkspaceInput {
  rootPath: string;
  mode?: WorkspaceMode;
}

export interface WorkspaceValidationResult {
  rootPath: string;
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  gitRoot: string | null;
  packageJsonExists: boolean;
  previewCapable: boolean;
  errors: string[];
}

export interface CreateConversationWithWorkspaceInput {
  title?: string | null;
  rootPath: string;
}

export interface ConversationSummary {
  conversationId: string;
  title: string | null;
  workspace: {
    rootPath: string;
    isGitRepo?: boolean;
    previewCapable?: boolean;
  } | null;
  counts: {
    messages: number;
    tasks: number;
    runs: number;
    completedRuns: number;
    failedRuns: number;
    interruptedRuns: number;
    appliedRuns: number;
    cleanedWorkspaces: number;
    pendingConfirmations: number;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    assignedAgentName?: string;
    latestRunId?: string;
  }>;
  runs: Array<{
    id: string;
    agentName?: string;
    status: string;
    taskId?: string;
    workspaceMode?: string;
    workspaceStatus?: string;
    applied?: boolean;
    changedFilesCount?: number;
  }>;
  changedFiles: Array<{
    runId: string;
    filePath: string;
    changeType: string;
  }>;
  confirmations: Array<{
    id: string;
    actionType: string;
    status: string;
  }>;
}

export interface CreateRunInput {
  agentId?: string;
  prompt: string;
  sourceMessageId?: string;
}

export type ApprovalActionType =
  | "apply_changes"
  | "apply_and_commit"
  | "resolve_conflicts"
  | "cleanup_workspace"
  | "cleanup_conversation_workspaces"
  | "tool_use";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "cancelled";

export interface ApprovalRequestRecord {
  id: string;
  conversation_id: string;
  run_id: string | null;
  task_id: string | null;
  assignment_id: string | null;
  action_type: ApprovalActionType;
  status: ApprovalStatus;
  title: string;
  description: string | null;
  payload_json: string | null;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
  decided_at: string | null;
  executed_at: string | null;
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  runId: string | null;
  taskId: string | null;
  assignmentId: string | null;
  actionType: ApprovalActionType;
  status: ApprovalStatus;
  title: string;
  description: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface CreateApprovalInput {
  conversationId: string;
  runId?: string | null;
  taskId?: string | null;
  assignmentId?: string | null;
  actionType: ApprovalActionType;
  title: string;
  description?: string | null;
  payload?: Record<string, unknown> | null;
}
