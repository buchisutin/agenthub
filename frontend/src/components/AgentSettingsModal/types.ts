import type { Agent, RuntimeAdapterCheck, RuntimeAdapterInfo } from '../../types';

export type AgentEditorState = {
  name: string;
  adapterType: string;
  instructions: string;
  enabled: boolean;
  isDefault: boolean;
};

export type SaveState = 'idle' | 'saved' | 'failed';

export interface AgentSettingsModalProps {
  onClose: () => void;
  onAgentsChanged: (agents: Agent[]) => void;
}

export interface AgentListProps {
  agents: Agent[];
  loading: boolean;
  selectedAgentId: string | null;
  createMode: boolean;
  runtimeChecks: RuntimeAdapterCheck[];
  onSelectAgent: (agentId: string) => void;
  onCreateNew: () => void;
}

export interface AgentFormProps {
  selectedAgent: Agent | null;
  form: AgentEditorState;
  loading: boolean;
  saving: boolean;
  saveState: SaveState;
  error: string | null;
  fieldErrors: Partial<Record<'name' | 'slug', string>>;
  adapterOptions: RuntimeAdapterInfo[];
  runtimeChecks: RuntimeAdapterCheck[];
  selectedRuntimeCheck: RuntimeAdapterCheck | null;
  onChange: (next: AgentEditorState) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}
