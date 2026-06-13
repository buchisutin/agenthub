export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT NOT NULL,
  task_id TEXT,
  agent_platform TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  source_message_id TEXT,
  plan_message_id TEXT,
  parent_task_id TEXT,
  depends_on_json TEXT,
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT,
  expected_output TEXT,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT,
  owner_id TEXT,
  assignee_type TEXT,
  assignee_id TEXT,
  created_by_type TEXT,
  created_by_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (plan_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  instructions TEXT,
  status TEXT NOT NULL,
  capabilities_json TEXT,
  config_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  mode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runtimes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_id TEXT,
  runtime_identity TEXT,
  last_heartbeat_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  conversation_id TEXT,
  agent_id TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  provider_session_id TEXT,
  status TEXT NOT NULL,
  invalid_reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  last_resumed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (runtime_id) REFERENCES agent_runtimes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  assignment_id TEXT,
  agent_id TEXT NOT NULL,
  runtime_id TEXT,
  agent_session_id TEXT,
  source_message_id TEXT,
  workspace_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'chat',
  trigger_source_id TEXT,
  requested_by TEXT,
  status TEXT NOT NULL,
  pid INTEGER,
  exit_code INTEGER,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (assignment_id) REFERENCES task_assignments(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (runtime_id) REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  FOREIGN KEY (agent_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL,
  mentions_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  latest_run_id TEXT,
  assigned_by_type TEXT,
  assigned_by_id TEXT,
  assigned_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  FOREIGN KEY (latest_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS run_workspaces (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  base_workspace_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  root_path TEXT NOT NULL,
  branch_name TEXT,
  base_ref TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (base_workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_family TEXT,
  dedup_key TEXT,
  seq INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_change_applications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  run_workspace_id TEXT,
  status TEXT NOT NULL,
  applied_files_json TEXT,
  skipped_files_json TEXT,
  error_message TEXT,
  applied_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (run_workspace_id) REFERENCES run_workspaces(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS run_merges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  task_id TEXT,
  assignment_id TEXT,
  status TEXT NOT NULL,
  applied_files_json TEXT,
  conflict_files_json TEXT,
  blocked_reason TEXT,
  approval_id TEXT,
  merged_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (assignment_id) REFERENCES task_assignments(id) ON DELETE SET NULL,
  FOREIGN KEY (approval_id) REFERENCES approval_requests(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT,
  task_id TEXT,
  assignment_id TEXT,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  payload_json TEXT,
  result_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (assignment_id) REFERENCES task_assignments(id) ON DELETE SET NULL
);
`;

export const schemaIndexesSql = `
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_task_id ON conversations(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_conversation_created_at ON tasks(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_source_message_id ON tasks(source_message_id);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_message_id ON tasks(plan_message_id);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_agent_runtimes_agent_id ON agent_runtimes(agent_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_slug ON agents(slug);
CREATE INDEX IF NOT EXISTS idx_agents_enabled_default ON agents(enabled, is_default, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation_agent ON agent_sessions(conversation_id, agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_conversation_id ON agent_runs(conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_session_id ON agent_runs(agent_session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_assignment_id ON agent_runs(assignment_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_source_message_id ON agent_runs(source_message_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_task_assignments_task_id ON task_assignments(task_id, assigned_at ASC);
CREATE INDEX IF NOT EXISTS idx_task_assignments_agent_id ON task_assignments(agent_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id_seq ON run_events(run_id, seq ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id ON run_events(event_id);
CREATE INDEX IF NOT EXISTS idx_run_workspaces_run_id ON run_workspaces(run_id);
CREATE INDEX IF NOT EXISTS idx_run_workspaces_conversation_id ON run_workspaces(conversation_id);
CREATE INDEX IF NOT EXISTS idx_run_workspaces_status ON run_workspaces(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_change_applications_run_id ON run_change_applications(run_id);
CREATE INDEX IF NOT EXISTS idx_run_change_applications_conversation_id ON run_change_applications(conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_merges_run_id ON run_merges(run_id);
CREATE INDEX IF NOT EXISTS idx_run_merges_conversation_id ON run_merges(conversation_id);
CREATE INDEX IF NOT EXISTS idx_run_merges_status ON run_merges(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_conversation_created_at ON approval_requests(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_run_id ON approval_requests(run_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
`;
