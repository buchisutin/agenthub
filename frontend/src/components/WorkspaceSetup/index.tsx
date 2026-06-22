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
const RECENT_KEY = 'agenthub.recentWorkspaces';
const MAX_RECENT = 5;

function loadRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentWorkspace(path: string) {
  try {
    const existing = loadRecentWorkspaces().filter((p) => p !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...existing].slice(0, MAX_RECENT)));
  } catch { /* non-critical */ }
}

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
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => loadRecentWorkspaces());
  const [picking, setPicking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledAgents = useMemo(() => state.agents.filter((agent) => agent.enabled), [state.agents]);
  const defaultAgent = enabledAgents.find((agent) => agent.is_default) ?? enabledAgents[0] ?? null;
  const selectedSingleAgentId = enabledAgents.some((agent) => agent.id === singleAgentId)
    ? singleAgentId
    : defaultAgent?.id ?? '';

  // Check runtime once on mount (for the badge).
  useEffect(() => {
    api.checkRuntime('claude_cli')
      .then((c) => setRuntimeAvailable(c.available))
      .catch(() => setRuntimeAvailable(false));
  }, []);

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
      if (conversationType === 'single' && selectedSingleAgentId) writeSingleAgentId(result.conversation.id, selectedSingleAgentId);
      dispatch({ type: 'ADD_CONVERSATION', payload: result.conversation });
      dispatch({ type: 'SET_WORKSPACE', payload: { convId: result.conversation.id, workspace: result.workspace } });
      dispatch({ type: 'SELECT_CONVERSATION', payload: result.conversation.id });
      socketService.joinConversation(result.conversation.id);
      try {
        const tl = await loadConversationRuntime(result.conversation.id, dispatch);
        for (const item of tl.items) socketService.subscribeRun(item.runId);
      } catch { /* non-critical */ }
      saveRecentWorkspace(rootPath.trim());
      setRecentWorkspaces(loadRecentWorkspaces());
      onCreated?.(result.conversation.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '创建协作会话失败');
    } finally {
      setCreating(false);
    }
  }

  async function handlePickDirectory() {
    setPicking(true);
    try {
      const res = await fetch('http://localhost:8000/system/pick-directory', { method: 'POST' });
      const data = await res.json() as { path: string | null };
      if (data.path) handleChange(data.path);
    } catch { /* user cancelled or server error — do nothing */ }
    finally { setPicking(false); }
  }

  const valid = Boolean(validation && validation.errors.length === 0);
  const invalid = Boolean(validation && validation.errors.length > 0);
  const canCreate = Boolean(validation?.exists && validation?.isDirectory && validation?.errors.length === 0 && !error);
  const badges = validation ? buildBadges(validation, runtimeAvailable) : [];

  const card = (
    <div
      data-testid="workspace-setup-card"
      className="w-full max-w-[460px] rounded-2xl px-8 pt-8 pb-6"
      style={{
        backgroundColor: 'rgba(255, 252, 250, 0.66)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(103, 115, 101, 0.13)',
        boxShadow: '0 12px 32px rgba(62, 78, 64, 0.07)',
      }}
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-[-0.02em]" style={{ color: 'var(--app-text)' }}>
            开始协作
          </h2>
          <button
            type="button"
            onClick={() => setShowAgentSettings(true)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/75"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.52)',
              color: '#244A2D',
              border: '1px solid rgba(103, 115, 101, 0.2)',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
            }}
          >
            配置 Agents
          </button>
        </div>

        {/* Horizontal mode + agent picker */}
        <div
          className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-1 px-1"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
          data-testid="mode-agent-picker"
        >
          {/* Group card — always first */}
          <button
            type="button"
            onClick={() => setConversationType('group')}
            className="flex-shrink-0 snap-start rounded-xl px-4 py-3.5 text-left transition-all w-[148px]"
            style={{
              backgroundColor: conversationType === 'group' ? '#EFF8FF' : 'var(--card-bg)',
              border: conversationType === 'group' ? '1.5px solid #93C5FD' : '0.5px solid var(--app-border)',
              boxShadow: conversationType === 'group' ? '0 0 0 3px rgba(147,197,253,0.15)' : 'none',
            }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <GroupIcon />
              <span className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>群聊</span>
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--app-text-secondary)' }}>
              多 Agent 协作完成任务
            </div>
            <div className="mt-2 text-[11px] font-medium" style={{ color: conversationType === 'group' ? '#1A6BCC' : 'var(--app-text-secondary)' }}>
              {enabledAgents.length} 个可用
            </div>
          </button>

          {/* Divider */}
          <div className="flex-shrink-0 flex items-center">
            <div className="h-10 w-px" style={{ backgroundColor: 'var(--app-border)' }} />
          </div>

          {/* Individual agent cards */}
          {enabledAgents.map((agent) => {
            const isActive = conversationType === 'single' && selectedSingleAgentId === agent.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => { setConversationType('single'); setSingleAgentId(agent.id); }}
                className="flex-shrink-0 snap-start rounded-xl px-4 py-3.5 text-left transition-all w-[148px]"
                style={{
                  backgroundColor: isActive ? '#EFF8FF' : 'var(--card-bg)',
                  border: isActive ? '1.5px solid #93C5FD' : '0.5px solid var(--app-border)',
                  boxShadow: isActive ? '0 0 0 3px rgba(147,197,253,0.15)' : 'none',
                }}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AgentIcon />
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--app-text)' }}>{agent.name}</span>
                </div>
                <div className="text-[11px] leading-relaxed line-clamp-3" style={{ color: 'var(--app-text-secondary)' }}>
                  {describeAgent(agent)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          {/* Drop zone / picker button */}
          {!rootPath ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void handlePickDirectory()}
                disabled={picking}
                className="w-full rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                style={{ borderColor: 'var(--app-border)', backgroundColor: 'var(--card-subtle)' }}
              >
                <div className="flex flex-col items-center gap-2">
                  <FolderIcon />
                  <span className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>{picking ? '选择中...' : '选择项目目录'}</span>
                  <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>点击浏览，或拖入文件夹</span>
                </div>
              </button>

              {recentWorkspaces.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>最近使用</div>
                  <div className="flex flex-col gap-1">
                    {recentWorkspaces.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleChange(p)}
                        className="w-full rounded-lg px-3 py-2 text-left font-mono text-xs transition-colors hover:bg-white/70"
                        style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--app-text)', border: '0.5px solid var(--app-border)' }}
                      >
                        <span className="truncate block">{p}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : (
            /* Path selected — show result row */
            <div className={`relative flex items-center gap-3 rounded-lg px-4 py-3 ${
              valid ? 'border border-green-600 bg-green-50/30' :
              invalid ? 'border border-red-400 bg-red-50/30' :
              'border border-gray-200 bg-gray-50/50'
            }`}>
              <FolderIcon size={16} />
              <span className="flex-1 truncate font-mono text-sm" style={{ color: 'var(--app-text)' }}>
                {rootPath}
              </span>
              {validating && (
                <span className="h-4 w-4 flex-shrink-0 rounded-full border-2 animate-spin"
                  style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
                />
              )}
              <button
                type="button"
                onClick={() => handleChange('')}
                className="flex-shrink-0 rounded-full p-0.5 text-xs hover:bg-gray-200 transition-colors"
                style={{ color: 'var(--app-text-secondary)' }}
                aria-label="清除"
              >
                ✕
              </button>
            </div>
          )}

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
          className="relative isolate inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full p-[2px] text-sm font-semibold transition-all hover:-translate-y-px hover:brightness-[1.015] active:translate-y-0 disabled:transform-none disabled:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9CAA98] focus-visible:ring-offset-2"
          aria-label={creating ? '创建中...' : '创建协作会话'}
          style={{
            background: canCreate
              ? 'linear-gradient(#98a596 0%, #dce9d8 100%)'
              : 'linear-gradient(#b6c0b4 0%, #e1eae0 100%)',
            color: canCreate ? '#31543A' : '#849084',
            boxShadow: canCreate
              ? '0 8px 18px rgba(112, 137, 108, 0.12), 0 2px 5px rgba(0, 0, 0, 0.03)'
              : '0 4px 12px rgba(112, 137, 108, 0.05)',
            opacity: creating ? 0.8 : 1,
            cursor: !canCreate || creating ? 'not-allowed' : 'pointer',
          }}
        >
          <span
            data-testid="create-button-surface"
            aria-hidden="true"
            className="pointer-events-none absolute inset-[2px] rounded-full border border-white/50"
            style={{
              background: canCreate
                ? 'linear-gradient(#f7faf5 0%, #ced8ca 55%, #edf5e9 100%)'
                : 'linear-gradient(#f3f6f1 0%, #dce4d8 55%, #eff4ed 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.56), inset 0 -1px 0 rgba(224, 237, 220, 0.52)',
            }}
          />
          <span
            className="relative z-10"
            style={{
              color: canCreate ? '#31543A' : '#849084',
              fontWeight: 650,
              lineHeight: 1,
              textShadow: 'none',
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
    <div
      data-testid="workspace-setup-surface"
      className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12"
      style={{ background: 'linear-gradient(#e8eee7 0%, #f7f7f1 55%, #fff8f7 100%)' }}
    >
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

function GroupIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--app-text-secondary)', flexShrink: 0 }}>
      <circle cx="9" cy="7" r="3" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--app-text-secondary)', flexShrink: 0 }}>
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
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

function pathBasename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || 'project';
}


function FolderIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--app-text-secondary)' }}>
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}
