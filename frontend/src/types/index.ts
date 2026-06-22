export type ConversationType = 'single' | 'group';
export type AgentStatus = 'active' | 'unavailable';
export type WorkspaceMode = 'direct';
export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'cancelled'
  | 'pending'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted';
export type AssignmentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted';
export type TaskType =
  | 'frontend'
  | 'backend'
  | 'test'
  | 'docs'
  | 'review'
  | 'deploy'
  | 'general';
export type MessageSenderType = 'user' | 'agent' | 'system' | 'orchestrator';
export type MessageType = 'text' | 'command' | 'plan' | 'system' | 'conflict_review' | 'queued_prompt';

export type RuntimeEventType =
  | 'text_delta'
  | 'tool_started'
  | 'tool_input_delta'
  | 'tool_completed'
  | 'tool_result'
  | 'tool_error'
  | 'command_started'
  | 'command_output'
  | 'file_changed'
  | 'approval_required'
  | 'run_status_changed'
  | 'run_completed'
  | 'run_failed'
  | 'run_interrupted';

export interface Conversation {
  id: string;
  title: string | null;
  type: ConversationType;
  task_id: string | null;
  agent_platform: string | null;
  created_at: string;
  updated_at: string;
  task: TaskSummary | null;
}

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface Agent {
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

export interface Workspace {
  id: string;
  conversation_id: string;
  root_path: string;
  mode: WorkspaceMode;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceExecutionStatus {
  state: 'clean' | 'dirty' | 'unavailable';
  gitRoot: string | null;
  dirtyFilesCount: number;
  dirtyFilesSample: string[];
  lastCommit: string | null;
  suggestion: string;
}

export type RunWorkspaceMode = 'git_worktree' | 'git_clone' | 'copy' | 'legacy';

export interface RunWorkspace {
  mode: RunWorkspaceMode;
  rootPath: string | null;
  branchName: string | null;
  status: 'creating' | 'ready' | 'failed' | 'cleaned';
  errorMessage: string | null;
}

export interface RunCardSummary {
  workspace: RunWorkspace;
  changeApplication: RunChangeApplication | null;
  fileChanges: FileChange[];
  mergeMode?: 'auto' | 'manual';
  mergeStatus?: 'pending' | 'auto_merged' | 'conflict_resolved' | 'needs_approval' | 'failed' | null;
  merge?: {
    id: string;
    runId: string;
    conversationId: string;
    taskId: string | null;
    assignmentId: string | null;
    status: 'pending' | 'auto_merged' | 'conflict_resolved' | 'needs_approval' | 'failed';
    appliedFiles: string[];
    conflicts: Array<{
      filePath: string;
      changeType: 'create' | 'edit' | 'delete' | 'unknown';
      reason: string;
      baseContent: string;
      currentContent: string;
      runContent: string;
      llmAvailable: boolean;
    }>;
    blockedReason: string | null;
    approvalId: string | null;
    mergedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface Run {
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
  trigger_type: 'chat' | 'task' | 'autopilot' | 'workflow';
  trigger_source_id: string | null;
  requested_by: string | null;
  status: RunStatus;
  pid: number | null;
  exit_code: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  events: RunEvent[];
}

export interface RunSummary {
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
  trigger_type: 'chat' | 'task' | 'autopilot' | 'workflow';
  trigger_source_id: string | null;
  requested_by: string | null;
  status: RunStatus;
  pid: number | null;
  exit_code: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
  event_count: number;
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

export type RunEvent = RunEventRecord;

export interface FileChange {
  filePath: string;
  changeType: 'create' | 'edit' | 'delete' | 'unknown';
  oldContent: string;
  newContent: string;
  confidence: 'exact' | 'snapshot' | 'best_effort';
  source: 'snapshot' | 'read_tool' | 'tool_event' | 'filesystem';
}

export interface ProjectFileChange extends FileChange {
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface WorkspaceDiffResponse {
  workspaceId: string;
  baseRef: 'HEAD';
  files: ProjectFileChange[];
  summary: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface WorkspaceChangedEvent {
  type: 'workspace_changed';
  eventId?: string;
  conversationId: string;
  workspaceId: string;
  reason: 'merge_completed';
}

export interface PreviewState {
  runId: string;
  port: number;
  url: string;
  status: 'starting' | 'running' | 'stopped' | 'failed';
}

export interface PreviewStartResponse {
  url: string;
  port: number;
}

export type DeployStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface DeployLogEntry {
  stream: 'stdout' | 'stderr';
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

export type WorkspaceDeployRecord = Omit<DeployRecord, 'runId'> & {
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

export interface OrchestrateResponse {
  plan: TaskPlan | null;
  runs: RunSummary[];
  queued?: boolean;
  pendingClarification?: boolean;
  preview?: boolean;
}

export interface ResumePlanResponse {
  plan: TaskPlan;
  runs: RunSummary[];
  rerunPlannerTaskIds: string[];
}

export interface Mention {
  type: 'agent' | 'orchestrator' | 'unknown';
  targetId?: string | null;
  raw: string;
  start?: number;
  end?: number;
}

export interface Message {
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

export type ConversationTimelineItem =
  | {
      type: 'message';
      message: Message;
    }
  | {
      type: 'plan';
      message: Message;
      plan: TaskPlan;
      tasks: Task[];
      assignments: TaskAssignment[];
    }
  | {
      type: 'run';
      run: Run | RunSummary;
    }
  | {
      type: 'confirmation';
      approval: ApprovalRequest;
    };

export interface PlanCardModel {
  id: string;
  conversationId: string;
  prompt: string;
  summary: string;
  dagPreview?: {
    levels: string[][];
    text: string;
  };
  items: Array<{
    index: number;
    plannerTaskId?: string;
    title: string;
    description?: string;
    taskType?: TaskType;
    expectedOutput?: string;
    affectedFiles?: string[];
    dependsOn?: string[];
    suggestedAgent?: string | null;
    assignedAgentId: string;
    assignedAgentName: string;
    taskId: string;
    assignmentId: string;
    runId: string | null;
    status: RunStatus | TaskStatus;
    outputSummary?: string | null;
  }>;
  createdAt: string;
  preview?: boolean;
}

export interface OrchestratorPlanningState {
  conversationId: string;
  prompt: string;
  output: string;
  startedAt: string;
}

export interface Task {
  id: string;
  conversation_id: string | null;
  source_message_id: string | null;
  plan_message_id: string | null;
  depends_on?: string[];
  title: string;
  description: string | null;
  task_type?: TaskType | null;
  expected_output?: string | null;
  status: TaskStatus;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignment {
  id: string;
  task_id: string;
  conversation_id: string;
  agent_id: string;
  status: AssignmentStatus;
  latest_run_id: string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface TaskDetail {
  task: Task;
  assignments: TaskAssignment[];
  latestRun: Run | RunSummary | null;
}

export type RunChangeApplicationStatus = 'pending' | 'applied' | 'failed' | 'skipped';

export interface SkippedFileEntry {
  filePath: string;
  reason: string;
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

export type ApplyCheckStatus = 'safe' | 'conflict' | 'skipped';

export interface ApplyCheckFile {
  filePath: string;
  changeType: 'create' | 'edit' | 'delete' | 'unknown';
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

export interface RerunTaskResponse {
  task: Task;
  assignment: TaskAssignment | null;
  run: Run;
}

export interface RuntimeBaseEvent {
  eventId?: string;
  occurredAt?: string;
  seq?: number;
  runId: string;
  conversationId: string;
  agentId: string;
  taskId: string | null;
  assignmentId?: string | null;
}

export interface TextDeltaEvent extends RuntimeBaseEvent {
  type: 'text_delta';
  delta: string;
}

export interface ToolStartedEvent extends RuntimeBaseEvent {
  type: 'tool_started';
  toolUseId: string;
  toolName: string;
}

export interface ToolInputDeltaEvent extends RuntimeBaseEvent {
  type: 'tool_input_delta';
  toolUseId: string;
  toolName: string;
  partialJson: string;
  parsedInput?: Record<string, unknown>;
}

export interface ToolCompletedEvent extends RuntimeBaseEvent {
  type: 'tool_completed';
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent extends RuntimeBaseEvent {
  type: 'tool_result';
  toolUseId: string;
  toolName: string;
  summary: string;
  content?: string;
  isError?: boolean;
}

export interface ToolErrorEvent extends RuntimeBaseEvent {
  type: 'tool_error';
  toolUseId: string;
  toolName: string;
  error: string;
}

export interface CommandStartedEvent extends RuntimeBaseEvent {
  type: 'command_started';
  command: string;
}

export interface CommandOutputEvent extends RuntimeBaseEvent {
  type: 'command_output';
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export interface FileChangedEvent extends RuntimeBaseEvent {
  type: 'file_changed';
  path: string;
  changeType: string;
}

export interface ApprovalRequiredEvent extends RuntimeBaseEvent {
  type: 'approval_required';
  reason: string;
  approvalId?: string;
  rawEvent?: Record<string, unknown>;
}

export interface ApprovalStatusChangedEvent extends RuntimeBaseEvent {
  type: 'approval_status_changed';
  approvalId: string;
  status: 'approved' | 'rejected' | 'cancelled' | 'executed' | 'failed';
}

export interface RunStatusChangedEvent extends RuntimeBaseEvent {
  type: 'run_status_changed';
  status: RunStatus;
}

export interface RunCompletedEvent extends RuntimeBaseEvent {
  type: 'run_completed';
  finalText: string;
  exitCode: number;
}

export interface RunFailedEvent extends RuntimeBaseEvent {
  type: 'run_failed';
  error: string;
}

export interface RunInterruptedEvent extends RuntimeBaseEvent {
  type: 'run_interrupted';
  reason: string;
}

export interface OrchestratorPlanningStartedEvent {
  eventId?: string;
  type: 'orchestrator_planning_started';
  conversationId: string;
  prompt: string;
}

export interface OrchestratorTextDeltaEvent {
  eventId?: string;
  type: 'orchestrator_text_delta';
  conversationId: string;
  delta: string;
}

export interface OrchestratorPlanningDoneEvent {
  eventId?: string;
  type: 'orchestrator_planning_done';
  conversationId: string;
  planId: string;
  summary: string;
}

export type RuntimeSocketEvent =
  | TextDeltaEvent
  | ToolStartedEvent
  | ToolInputDeltaEvent
  | ToolCompletedEvent
  | ToolResultEvent
  | ToolErrorEvent
  | CommandStartedEvent
  | CommandOutputEvent
  | FileChangedEvent
  | ApprovalRequiredEvent
  | ApprovalStatusChangedEvent
  | RunStatusChangedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunInterruptedEvent;

export type OrchestratorSocketEvent =
  | OrchestratorPlanningStartedEvent
  | OrchestratorTextDeltaEvent
  | OrchestratorPlanningDoneEvent;

export interface AgentTextBlock {
  kind: 'agent_text';
  id: string;
  content: string;
}

export interface ToolCallBlock {
  kind: 'tool_call';
  id: string;
  toolUseId: string;
  toolName: string;
  status: 'running' | 'completed' | 'error';
  inputPreview: string;
  input: Record<string, unknown> | null;
  partialJson: string;
  summary: string | null;
  resultContent: string | null;
  expanded: boolean;
  resultKind: 'read' | 'bash' | 'write' | 'generic';
}

export interface ApprovalRequestBlock {
  kind: 'approval_request';
  id: string;
  reason: string;
  approvalId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'executed' | 'failed';
}

export interface FileChangeIndicatorBlock {
  kind: 'file_change_indicator';
  id: string;
  filePath: string;
  changeType: 'create' | 'edit';
}

export type TimelineBlock =
  | AgentTextBlock
  | ToolCallBlock
  | ApprovalRequestBlock
  | FileChangeIndicatorBlock;

export interface ChatTimelineItem {
  id: string;
  conversationId: string;
  runId: string;
  taskId: string | null;
  assignmentId?: string | null;
  agentId: string;
  agentName: string | null;
  agentSessionId: string | null;
  prompt: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  eventCount?: number;
  detailsLoaded?: boolean;
  blocks: TimelineBlock[];
  error: string | null;
}

export type ApprovalActionType =
  | 'apply_changes'
  | 'apply_and_commit'
  | 'resolve_conflicts'
  | 'cleanup_workspace'
  | 'cleanup_conversation_workspaces';

export type ConflictResolutionStrategy = 'use_run' | 'use_base' | 'use_llm';

export interface ConflictResolutionChoice {
  filePath: string;
  strategy: ConflictResolutionStrategy;
}

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'cancelled';

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

export interface CreateConversationWithWorkspaceResponse {
  conversation: Conversation;
  workspace: Workspace;
  validation: WorkspaceValidationResult;
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
