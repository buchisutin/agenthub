import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../store/useApp';
import { api } from '../../services/api';
import { loadConversationRuntime } from '../../store/runtimeActions';
import { socketService } from '../../services/socket';
import { AgentSettingsModal } from '../AgentSettingsModal';
import { Badge } from '../ui/Badge';
import type { BadgeVariant } from '../ui/Badge';
import type { Agent, ConversationType, WorkspaceValidationResult } from '../../types';

interface WorkspaceSetupProps {
  compact?: boolean;
  onCreated?: (convId: string) => void;
}

const DEBOUNCE_MS = 800;
const PLACEHOLDER = '粘贴项目绝对路径，如 /Users/me/myproject';

export function WorkspaceSetup({ compact, onCreated }: WorkspaceSetupProps) {
  const { state, dispatch } = useApp();
  const [rootPath, setRootPath] = useState('');
  const [conversationType, setConversationType] = useState<ConversationType>('group');
  const [singleAgentId, setSingleAgentId] = useState('');
  const [validating, setValidating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [validation, setValidation] = useState<WorkspaceValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledAgents = useMemo(() => state.agents.filter((agent) => agent.enabled), [state.agents]);

  // Check runtime once on mount (for the badge).
  useEffect(() => {
    api.checkRuntime('claude_cli')
      .then((c) => setRuntimeAvailable(c.available))
      .catch(() => setRuntimeAvailable(false));
  }, []);

  useEffect(() => {
    if (enabledAgents.some((agent) => agent.id === singleAgentId)) return;
    const defaultAgent = enabledAgents.find((agent) => agent.is_default) ?? enabledAgents[0];
    if (defaultAgent) setSingleAgentId(defaultAgent.id);
  }, [enabledAgents, singleAgentId]);

  const handleAgentsChanged = useCallback((agents: Agent[]) => {
    dispatch({ type: 'SET_AGENTS', payload: agents });
  }, [dispatch]);

  const triggerValidate = useCallback((path: string) => {
    if (!path.trim()) {
      setValidation(null);
      setError(null);
      return;
    }
    setValidating(true);
    setError(null);
    api.validateWorkspace(path.trim())
      .then((result) => setValidation(result))
      .catch((e) => setError(e instanceof Error ? e.message : '验证失败'))
      .finally(() => setValidating(false));
  }, []);

  function handleChange(value: string) {
    setRootPath(value);
    setValidation(null);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerValidate(value), DEBOUNCE_MS);
  }

  async function handleCreate() {
    if (!rootPath.trim() || creating || !validation || validation.errors.length > 0) return;
    setCreating(true);
    setError(null);
    try {
      const result = await api.createConversationWithWorkspace({
        title: pathBasename(rootPath.trim()),
        rootPath: rootPath.trim(),
        type: conversationType,
      });
      if (conversationType === 'single' && singleAgentId) writeSingleAgentId(result.conversation.id, singleAgentId);
      dispatch({ type: 'ADD_CONVERSATION', payload: result.conversation });
      dispatch({ type: 'SET_WORKSPACE', payload: { convId: result.conversation.id, workspace: result.workspace } });
      dispatch({ type: 'SELECT_CONVERSATION', payload: result.conversation.id });
      socketService.joinConversation(result.conversation.id);
      try {
        const tl = await loadConversationRuntime(result.conversation.id, dispatch);
        for (const item of tl.items) socketService.subscribeRun(item.runId);
      } catch { /* non-critical */ }
      onCreated?.(result.conversation.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建协作会话失败');
    } finally {
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || !canCreate || creating) return;
    e.preventDefault();
    void handleCreate();
  }

  const valid = Boolean(validation && validation.errors.length === 0);
  const invalid = Boolean(validation && validation.errors.length > 0);
  const canCreate = Boolean(validation?.exists && validation?.isDirectory && validation?.errors.length === 0 && !error);
  const badges = validation ? buildBadges(validation, runtimeAvailable) : [];

  const card = (
    <div className="agenthub-card w-full max-w-[460px] p-8">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-[-0.02em]" style={{ color: 'var(--app-text)' }}>
            开始协作
          </h2>
          <button
            type="button"
            onClick={() => setShowAgentSettings(true)}
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}
          >
            配置 Agents
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={conversationType === 'single'}
            title="单聊"
            description="选一个 Agent，一对一对话"
            onClick={() => setConversationType('single')}
          />
          <ModeButton
            active={conversationType === 'group'}
            title="群聊"
            description="@成员或 @orchestrator 协作"
            onClick={() => setConversationType('group')}
          />
        </div>

        {conversationType === 'single' && (
          <div className="space-y-2">
            <div className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
              单聊对象
            </div>
            <div className="grid max-h-[260px] gap-2 overflow-y-auto pr-1" data-testid="agent-picker-list">
              {enabledAgents.map((agent) => (
                <AgentChoiceCard
                  key={agent.id}
                  active={agent.id === singleAgentId}
                  name={agent.name}
                  description={describeAgent(agent)}
                  onClick={() => setSingleAgentId(agent.id)}
                />
              ))}
            </div>
          </div>
        )}

        {conversationType === 'group' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
                群聊成员
              </div>
              <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                {enabledAgents.length} 个可用
              </span>
            </div>
            <div className="grid max-h-[260px] gap-2 overflow-y-auto pr-1" data-testid="agent-picker-list">
              {enabledAgents.map((agent) => (
                <AgentChoiceCard
                  key={agent.id}
                  active={agent.is_default}
                  name={agent.name}
                  description={describeAgent(agent)}
                  onClick={() => setShowAgentSettings(true)}
                  actionLabel={agent.is_default ? '默认' : '配置'}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="relative">
            <input
              value={rootPath}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={PLACEHOLDER}
              className="w-full rounded-lg px-4 py-3 text-sm font-mono outline-none"
              style={getInputStyle(valid, invalid)}
              autoFocus={!compact}
              spellCheck={false}
            />
            {validating && (
              <span className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 animate-spin"
                style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
              />
            )}
          </div>

          {valid && (
            <div className="flex flex-wrap items-center gap-2">
              {badges.map((b) => (
                <Badge key={b.label} variant={b.variant}>{b.label}</Badge>
              ))}
            </div>
          )}

          {invalid && validation && (
            <div className="space-y-1">
              {validation.errors.map((err) => (
                <div key={err} className="text-sm" style={{ color: 'var(--status-danger)' }}>{err}</div>
              ))}
            </div>
          )}

          {error && (
            <div className="text-sm" style={{ color: 'var(--status-danger)' }}>{error}</div>
          )}
        </div>

        <button
          type="button"
          disabled={!canCreate || creating}
          onClick={() => void handleCreate()}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors"
          aria-label={creating ? '创建中...' : '创建协作会话'}
          style={{
            backgroundColor: canCreate ? '#1A6BCC' : 'var(--card-strong)',
            color: canCreate ? '#FFFFFF' : 'var(--app-text-secondary)',
            border: canCreate ? '0.5px solid #1A6BCC' : '0.5px solid var(--app-border)',
            boxShadow: canCreate ? '0 4px 12px rgba(26, 107, 204, 0.16)' : 'none',
            opacity: creating ? 0.8 : 1,
            cursor: !canCreate || creating ? 'not-allowed' : 'pointer',
          }}
        >
          <span
            style={{
              color: canCreate ? '#FFFFFF' : 'var(--app-text-secondary)',
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {creating ? '创建中...' : '创建协作会话 →'}
          </span>
        </button>
      </div>
      {showAgentSettings && (
        <AgentSettingsModal
          onClose={() => setShowAgentSettings(false)}
          onAgentsChanged={handleAgentsChanged}
        />
      )}
    </div>
  );

  if (compact) return card;

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12" style={{ backgroundColor: 'var(--app-bg)' }}>
      {card}
    </div>
  );
}

function AgentChoiceCard({
  active,
  name,
  description,
  onClick,
  actionLabel,
}: {
  active: boolean;
  name: string;
  description: string;
  onClick: () => void;
  actionLabel?: string;
}) {
  const marker = actionLabel ?? (active ? '✓' : '');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-lg px-3 py-3 text-left transition-colors"
      style={{
        backgroundColor: active ? '#EFF8FF' : 'var(--card-bg)',
        border: active ? '1px solid #93C5FD' : '0.5px solid var(--app-border)',
        boxShadow: active ? '0 0 0 2px rgba(147, 197, 253, 0.18)' : 'none',
        color: 'var(--app-text)',
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="mt-1 line-clamp-2 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
            {description}
          </div>
        </div>
        <span
          className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
          style={{
            backgroundColor: active ? '#1A6BCC' : 'var(--card-subtle)',
            color: active ? '#FFFFFF' : 'var(--app-text-secondary)',
            border: active ? '0.5px solid #1A6BCC' : '0.5px solid var(--app-border)',
          }}
        >
          {marker}
        </span>
      </div>
    </button>
  );
}

function describeAgent(agent: { name: string; slug: string; instructions: string | null }) {
  const custom = agent.instructions?.trim();
  if (custom) return custom;
  const key = `${agent.name} ${agent.slug}`.toLowerCase();
  if (key.includes('builder')) return '负责实现功能、修改代码和整理基础工程结构。';
  if (key.includes('tester') || key.includes('test')) return '负责补充测试、验证行为和发现回归风险。';
  if (key.includes('review')) return '负责代码审查、风险判断和改进建议。';
  if (key.includes('design') || key.includes('frontend')) return '负责前端界面、交互体验和视觉细节。';
  return '适合一对一处理具体开发任务。';
}

function ModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-3 py-3 text-left transition-colors"
      style={{
        backgroundColor: active ? '#EFF8FF' : 'var(--card-bg)',
        border: active ? '1px solid #BFDBFE' : '0.5px solid var(--app-border)',
        color: 'var(--app-text)',
      }}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>{description}</div>
    </button>
  );
}

function singleAgentStorageKey(conversationId: string) {
  return `agenthub.singleAgent.${conversationId}`;
}

function writeSingleAgentId(conversationId: string, agentId: string) {
  try {
    localStorage.setItem(singleAgentStorageKey(conversationId), agentId);
  } catch {
    // The selected agent is a UI preference; creation should still succeed.
  }
}

function buildBadges(validation: WorkspaceValidationResult, runtimeAvailable: boolean | null) {
  const badges: Array<{ label: string; variant: BadgeVariant }> = [];
  if (validation.isGitRepo) badges.push({ label: '✓ git', variant: 'completed' });
  else badges.push({ label: '✗ git', variant: 'muted' });
  if (validation.previewCapable) badges.push({ label: '✓ 预览', variant: 'completed' });
  else badges.push({ label: '✗ 预览', variant: 'best_effort' });
  const rtLabel = runtimeAvailable === false ? '⚠ runtime' : runtimeAvailable === true ? '✓ runtime' : '… runtime';
  const rtVariant: BadgeVariant = runtimeAvailable === false ? 'best_effort' : runtimeAvailable === true ? 'completed' : 'muted';
  badges.push({ label: rtLabel, variant: rtVariant });
  return badges;
}

function getInputStyle(valid: boolean, invalid: boolean) {
  const borderColor = valid
    ? '#1A7F4B'
    : invalid
      ? 'var(--status-danger)'
      : 'var(--app-border)';
  return {
    backgroundColor: 'var(--card-bg)',
    color: 'var(--app-text)',
    border: `1px solid ${borderColor}`,
    borderRadius: '8px',
  };
}

function pathBasename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'project';
}
