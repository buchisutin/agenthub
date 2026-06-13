import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { Agent, RuntimeAdapterCheck, RuntimeAdapterInfo } from '../../types';
import { AgentForm } from './AgentForm';
import { AgentList } from './AgentList';
import type { AgentEditorState, AgentSettingsModalProps, SaveState } from './types';

function makeEditorState(agent?: Agent | null): AgentEditorState {
  return {
    name: agent?.name ?? '',
    adapterType: agent?.adapter_type ?? 'claude_cli',
    instructions: agent?.instructions ?? '',
    enabled: agent?.enabled ?? true,
    isDefault: agent?.is_default ?? false,
  };
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeForm(form: AgentEditorState) {
  return {
    ...form,
    name: form.name.trim(),
    instructions: form.instructions,
  };
}

export function AgentSettingsModal({ onClose, onAgentsChanged }: AgentSettingsModalProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeAdapterInfo[]>([]);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeAdapterCheck[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [form, setForm] = useState<AgentEditorState>(() => makeEditorState());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedRuntimeInfo = form.adapterType
    ? runtimes.find((runtime) => runtime.adapterType === form.adapterType) ?? null
    : null;
  const selectedRuntimeCheck = form.adapterType
    ? runtimeChecks.find((runtime) => runtime.adapterType === form.adapterType) ?? null
    : null;

  const adapterOptions = useMemo(() => {
    const options = [...runtimes];
    if (form.adapterType && !options.some((runtime) => runtime.adapterType === form.adapterType)) {
      options.push({
        adapterType: form.adapterType,
        displayName: form.adapterType,
        capabilities: [],
        registered: false,
      });
    }
    return options;
  }, [form.adapterType, runtimes]);

  const fieldErrors = useMemo(() => {
    const next: Partial<Record<'name' | 'slug', string>> = {};
    if (!form.name.trim()) {
      next.name = 'Name is required';
    }
    const derivedSlug = normalizeSlug(
      selectedAgent && form.name.trim() === selectedAgent.name ? selectedAgent.slug : form.name,
    );
    if (!derivedSlug) {
      next.slug = 'Slug is required';
    } else {
      const duplicate = agents.find((agent) => agent.slug === derivedSlug && agent.id !== selectedAgentId);
      if (duplicate) {
        next.slug = 'Slug already exists';
      }
    }
    return next;
  }, [agents, form.name, selectedAgentId, selectedAgent]);

  const hasUnsavedChanges = useMemo(() => {
    const baseline = createMode ? makeEditorState() : makeEditorState(selectedAgent);
    return JSON.stringify(normalizeForm(form)) !== JSON.stringify(normalizeForm(baseline));
  }, [createMode, form, selectedAgent]);

  const reloadAgents = useCallback(async (selectAgentId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const allAgents = await api.listAgents(true);
      setAgents(allAgents);
      onAgentsChanged(allAgents.filter((agent) => agent.enabled));
      const nextSelected =
        selectAgentId
          ? allAgents.find((agent) => agent.id === selectAgentId)?.id ?? null
          : selectedAgentIdRef.current
            ? allAgents.find((agent) => agent.id === selectedAgentIdRef.current)?.id ?? null
            : allAgents[0]?.id ?? null;
      selectedAgentIdRef.current = nextSelected;
      setSelectedAgentId(nextSelected);
      setCreateMode(false);
      setForm(makeEditorState(allAgents.find((agent) => agent.id === nextSelected) ?? null));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载 Agent 失败');
    } finally {
      setLoading(false);
    }
  }, [onAgentsChanged]);

  const loadRuntimeState = useCallback(async () => {
    try {
      const [nextRuntimes, nextChecks] = await Promise.all([
        api.getRuntimes(),
        api.checkAllRuntimes(),
      ]);
      setRuntimes(nextRuntimes);
      setRuntimeChecks(nextChecks);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载 Runtime 失败');
    }
  }, []);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([reloadAgents(), loadRuntimeState()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRuntimeState, reloadAgents]);

  useEffect(() => {
    if (saveState === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setSaveState('idle'), 1000);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function confirmLoseChanges() {
    if (!hasUnsavedChanges) {
      return true;
    }
    return window.confirm('You have unsaved changes. Continue?');
  }

  function handleCreateNew() {
    if (!confirmLoseChanges()) {
      return;
    }
    setCreateMode(true);
    setSelectedAgentId(null);
    selectedAgentIdRef.current = null;
    setForm(makeEditorState());
    setError(null);
    setSaveState('idle');
  }

  function handleSelectAgent(agentId: string) {
    if (!confirmLoseChanges()) {
      return;
    }
    const agent = agents.find((item) => item.id === agentId) ?? null;
    setCreateMode(false);
    setSelectedAgentId(agentId);
    selectedAgentIdRef.current = agentId;
    setForm(makeEditorState(agent));
    setError(null);
    setSaveState('idle');
  }

  function handleRequestClose() {
    if (!confirmLoseChanges()) {
      return;
    }
    onClose();
  }

  async function handleSave() {
    const payload = normalizeForm(form);
    if (fieldErrors.name || fieldErrors.slug) {
      return;
    }
    setSaving(true);
    setError(null);
    setSaveState('idle');
    try {
      const saved = createMode || !selectedAgent
        ? await api.createAgent({
          name: payload.name,
          slug: normalizeSlug(payload.name),
          adapterType: payload.adapterType,
          capabilities: selectedRuntimeInfo?.capabilities ?? [],
          instructions: payload.instructions,
          enabled: payload.enabled,
          isDefault: payload.isDefault,
        })
        : await api.updateAgent(selectedAgent.id, {
          name: payload.name,
          slug: normalizeSlug(payload.name),
          adapterType: payload.adapterType,
          capabilities: selectedRuntimeInfo?.capabilities ?? selectedAgent.capabilities ?? [],
          instructions: payload.instructions,
          enabled: payload.enabled,
          isDefault: payload.isDefault,
        });
      await reloadAgents(saved.id);
      setSaveState('saved');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存 Agent 失败');
      setSaveState('failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedAgent) return;
    if (!window.confirm(`Delete @${selectedAgent.slug}?`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteAgent(selectedAgent.id);
      await reloadAgents();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '删除 Agent 失败');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end overflow-hidden"
      style={{ backdropFilter: 'blur(2px)' }}
    >
      <div
        className="mt-4 mb-4 mr-4 flex h-[calc(100%-32px)] w-[min(960px,calc(100vw-24px))] overflow-hidden rounded-[10px] bg-white transition-transform duration-[250ms]"
        style={{
          boxShadow: '0 18px 48px rgba(9, 9, 11, 0.14)',
          border: '0.5px solid #E8E7E4',
          transform: entered ? 'translateX(0)' : 'translateX(100%)',
          transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        <AgentList
          agents={agents}
          loading={loading}
          selectedAgentId={selectedAgentId}
          createMode={createMode}
          runtimeChecks={runtimeChecks}
          onSelectAgent={handleSelectAgent}
          onCreateNew={handleCreateNew}
        />
        <AgentForm
          selectedAgent={createMode ? null : selectedAgent}
          form={form}
          loading={loading}
          saving={saving}
          saveState={saveState}
          error={error}
          fieldErrors={fieldErrors}
          adapterOptions={adapterOptions}
          runtimeChecks={runtimeChecks}
          selectedRuntimeCheck={selectedRuntimeCheck}
          onChange={setForm}
          onClose={handleRequestClose}
          onSave={() => void handleSave()}
          onDelete={() => void handleDelete()}
        />
      </div>
    </div>
  );
}
