import { useCallback, useEffect, useState, useMemo } from 'react';
import { useApp } from '../../store/useApp';
import { api } from '../../services/api';
import { AgentSettingsModal } from '../AgentSettingsModal';
import type { Agent, RuntimeAdapterCheck, WorkspaceValidationResult } from '../../types';
import type { ProjectArtifactTab } from '../ProjectArtifactPanel';

interface TopBarProps {
  onOpenProjectArtifact?: (tab: ProjectArtifactTab) => void;
  projectPanelOpen?: boolean;
  activeProjectTab?: ProjectArtifactTab;
  projectFileCount?: number;
}

export function TopBar({
  onOpenProjectArtifact = () => {},
  projectPanelOpen = false,
  activeProjectTab,
}: TopBarProps) {
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
    <header
      data-testid="conversation-topbar"
      className="flex-shrink-0"
      style={{ borderBottom: '0.5px solid rgba(23, 49, 34, 0.08)' }}
    >
      {/* Row 1: title + status + path / actions */}
      <div className="flex items-center justify-between px-6 pt-3 pb-2 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 min-w-0 text-[13px]">
            <h1 className="text-[15px] font-medium truncate" style={{ color: 'var(--app-text)' }}>
              {conv?.title || 'AgentHub'}
            </h1>
            {state.selectedConvId && activeRunCount > 0 && (
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs flex-shrink-0"
                style={{ backgroundColor: 'rgba(37, 99, 235, 0.08)', color: 'var(--status-running)' }}
              >
                {activeRunCount} running
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
              <span className="min-w-0 truncate text-[12px]" title={workspace?.root_path} style={{ color: 'var(--app-text-secondary)' }}>
                {workspaceLabel}
              </span>
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
          {(['diff', 'preview', 'deploy'] as ProjectArtifactTab[]).map((tab) => {
            const baseLabel = tab === 'diff' ? '代码改动' : tab === 'preview' ? '网页预览' : '部署';
            const isActive = projectPanelOpen && activeProjectTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onOpenProjectArtifact(tab)}
                className="rounded-lg px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
                style={isActive
                  ? { backgroundColor: '#2E6B4F', color: '#fff', border: '0.5px solid #2E6B4F' }
                  : { backgroundColor: '#f0f5f0', color: '#2E6B4F', border: '0.5px solid #A8CCB5' }
                }
              >
                {baseLabel}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowAgentSettings(true)}
            className="rounded-lg px-3 py-1 text-xs font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: '#f0f5f0', color: '#2E6B4F', border: '0.5px solid #A8CCB5' }}
            title={defaultAgent ? `默认 Agent: @${defaultAgent.slug} · 共 ${state.agents.length} 个` : `共 ${state.agents.length} 个 Agent`}
          >
            Agents
          </button>
        </div>
      </div>


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
