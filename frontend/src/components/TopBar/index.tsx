import { useCallback, useEffect, useState, useMemo } from 'react';
import { useApp } from '../../store/useApp';
import { api } from '../../services/api';
import { AgentSettingsModal } from '../AgentSettingsModal';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';
import type { Agent, RuntimeAdapterCheck, WorkspaceValidationResult, PlanCardModel, ChatTimelineItem } from '../../types';
import type { ArtifactTab } from '../ArtifactPanel';

interface TopBarProps {
  onOpenArtifacts: (tab: ArtifactTab) => void;
}

function getLatestPlan(plans: PlanCardModel[]) {
  return [...plans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] ?? null;
}

export function TopBar({ onOpenArtifacts }: TopBarProps) {
  const { state, dispatch } = useApp();
  const conv = state.conversations.find((c) => c.id === state.selectedConvId);
  const workspace = state.selectedConvId ? state.workspaces[state.selectedConvId] : null;
  const activeRunCount = state.selectedConvId
    ? (state.activeRunIdsByConversation[state.selectedConvId] ?? []).length
    : 0;
  const defaultAgent = state.agents.find((agent) => agent.is_default) ?? null;
  const [cleanAllResult, setCleanAllResult] = useState<string | null>(null);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [wsValidation, setWsValidation] = useState<WorkspaceValidationResult | null>(null);
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeAdapterCheck | null>(null);

  const convId = state.selectedConvId;
  const timeline = useMemo(() => (convId ? state.timeline[convId] ?? [] : []), [convId, state.timeline]);
  const plans = useMemo(() => (convId ? state.plansByConversation[convId] ?? [] : []), [convId, state.plansByConversation]);
  const activeRunIds = useMemo(() => (convId ? state.activeRunIdsByConversation[convId] ?? [] : []), [convId, state.activeRunIdsByConversation]);

  const plan = useMemo(() => getLatestPlan(plans), [plans]);
  const totalTasks = plan?.items.length ?? 0;
  const completedTasks = plan?.items.filter((item) => item.status === 'completed').length ?? 0;
  const activeRuns = useMemo(() => timeline.filter((item) => activeRunIds.includes(item.runId)), [timeline, activeRunIds]);
  const attentionRuns = useMemo(() => timeline.filter((item) => item.status === 'failed' || item.status === 'interrupted'), [timeline]);
  const completedRuns = useMemo(() => timeline.filter((item) => item.status === 'completed').length, [timeline]);

  useEffect(() => {
    if (!workspace?.root_path) return;
    let cancelled = false;
    api.validateWorkspace(workspace.root_path)
      .then((v) => { if (!cancelled) setWsValidation(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspace?.root_path]);

  useEffect(() => {
    let cancelled = false;
    api.checkRuntime('claude_cli')
      .then((c) => { if (!cancelled) setRuntimeCheck(c); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const wsValidationOrNull = workspace?.root_path ? wsValidation : null;
  const runtimeUnavailable = runtimeCheck && !runtimeCheck.available;
  const handleAgentsChanged = useCallback((agents: Agent[]) => {
    dispatch({ type: 'SET_AGENTS', payload: agents });
  }, [dispatch]);

  const workspaceLabel = useMemo(() => {
    if (!workspace?.root_path) return null;
    return workspace.root_path;
  }, [workspace]);

  return (
    <header className="flex-shrink-0" style={{ backgroundColor: '#FFFFFF', borderBottom: '0.5px solid var(--app-border)' }}>
      {/* Row 1: title + status + path / actions */}
      <div className="flex items-center justify-between px-6 pt-3 pb-2 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 min-w-0 text-[13px]">
            <h1 className="text-[15px] font-medium truncate" style={{ color: 'var(--app-text)' }}>
              {conv?.title || 'AgentHub'}
            </h1>
            {state.selectedConvId && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs flex-shrink-0"
                style={{
                  backgroundColor: activeRunCount > 0 ? 'rgba(37, 99, 235, 0.08)' : 'var(--card-strong)',
                  color: activeRunCount > 0 ? 'var(--status-running)' : 'var(--app-text-secondary)',
                }}
              >
                {activeRunCount > 0 ? `${activeRunCount} running` : 'idle'}
              </span>
            )}
            {state.connected !== undefined && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: state.connected ? '#3FB950' : '#F85149' }}
                title={state.connected ? 'connected' : 'disconnected'}
              />
            )}
            {runtimeUnavailable && (
              <span
                className="px-2 py-0.5 rounded-full text-xs flex-shrink-0"
                style={{ backgroundColor: 'rgba(220, 38, 38, 0.08)', color: 'var(--status-danger)' }}
                title="当前默认 Agent 的 Runtime 不可用，Run 创建可能失败。"
              >
                Runtime 不可用
              </span>
            )}
            {workspaceLabel && (
              <>
                <span className="flex-shrink-0" style={{ color: 'var(--app-text-tertiary)' }}>·</span>
                <span className="min-w-0 truncate text-[12px]" title={workspace?.root_path} style={{ color: 'var(--app-text-secondary)' }}>
                  {workspaceLabel}
                </span>
              </>
            )}
            {workspaceLabel && (
              <>
              {wsValidationOrNull?.isGitRepo && (
                <span
                  className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px]"
                  style={{ backgroundColor: 'rgba(5, 150, 105, 0.08)', color: 'var(--status-success)' }}
                >
                  git
                </span>
              )}
              {wsValidationOrNull && !wsValidationOrNull.isGitRepo && (
                <span
                  className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px]"
                  style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text-secondary)' }}
                >
                  no git
                </span>
              )}
              </>
            )}
            {!workspaceLabel && !state.selectedConvId && (
            <span className="text-xs truncate" style={{ color: 'var(--app-text-secondary)' }}>
              选择会话并绑定工作区
            </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenArtifacts(completedRuns > 0 ? 'diff' : 'tasks')}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}
          >
            成果
          </button>
          <button
            type="button"
            onClick={() => setShowAgentSettings(true)}
            className="rounded-full px-3 py-1 text-xs font-medium transition-colors hover:opacity-90"
            style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}
            title={defaultAgent ? `默认 Agent: @${defaultAgent.slug} · 共 ${state.agents.length} 个` : `共 ${state.agents.length} 个 Agent`}
          >
            Agents
          </button>
        </div>
      </div>

      {/* Row 2: status numbers */}
      {(plan || timeline.length > 0) && (
        <div className="flex items-center gap-4 px-6 pb-3 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          <span>{completedTasks}/{totalTasks} 完成</span>
          <span>{activeRuns.length} 运行中</span>
          <span style={{ color: attentionRuns.length > 0 ? '#991B1B' : 'var(--app-text-secondary)' }}>
            {attentionRuns.length} 待处理
          </span>
          {activeRuns[0] ? (
            <Badge variant={getStatusVariant(activeRuns[0].status)}>{getStatusLabel(activeRuns[0].status)}</Badge>
          ) : null}
        </div>
      )}

      {cleanAllResult && (
        <div
          className="fixed top-4 right-4 rounded-lg px-4 py-2 text-sm z-50"
          style={{
            backgroundColor: 'var(--card-bg)',
            color: 'var(--app-text)',
            border: '1px solid var(--app-border)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
          onClick={() => setCleanAllResult(null)}
        >
          {cleanAllResult}
        </div>
      )}
      {showAgentSettings && (
        <AgentSettingsModal
          onClose={() => setShowAgentSettings(false)}
          onAgentsChanged={handleAgentsChanged}
        />
      )}
    </header>
  );
}
