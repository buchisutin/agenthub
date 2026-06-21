import { useState } from 'react';
import { useApp } from '../../store/useApp';
import { loadConversationRuntime } from '../../store/runtimeActions';
import { socketService } from '../../services/socket';
import { api } from '../../services/api';
import type { Conversation } from '../../types';

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString('zh-CN', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export type SidebarMode = 'expanded' | 'collapsed' | 'floating';

type SidebarProps = {
  mode: SidebarMode;
  onCollapse: () => void;
  onExpand: () => void;
  onFloatingMouseEnter?: () => void;
  onFloatingMouseLeave?: () => void;
};

export function Sidebar({ mode, onCollapse, onExpand, onFloatingMouseEnter, onFloatingMouseLeave }: SidebarProps) {
  const { state, dispatch } = useApp();
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const sortedConvs = [...state.conversations].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  function handleNewConversation() {
    if (state.selectedConvId) {
      socketService.leaveConversation(state.selectedConvId);
    }
    dispatch({ type: 'SELECT_CONVERSATION', payload: null });
  }

  async function selectConversation(conv: Conversation) {
    if (state.selectedConvId === conv.id) return;
    if (state.selectedConvId) {
      socketService.leaveConversation(state.selectedConvId);
    }
    dispatch({ type: 'SELECT_CONVERSATION', payload: conv.id });
    socketService.joinConversation(conv.id);

    try {
      const result = await loadConversationRuntime(conv.id, dispatch);
      for (const item of result.items) {
        socketService.subscribeRun(item.runId);
      }
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', payload: e instanceof Error ? e.message : '加载会话失败' });
    }
  }

  async function handleDelete(cleanupRunWorkspaces: boolean) {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteConversation(deleteTarget.id, { cleanupRunWorkspaces });
      dispatch({ type: 'REMOVE_CONVERSATION', payload: deleteTarget.id });
      if (state.selectedConvId === deleteTarget.id) {
        dispatch({ type: 'SELECT_CONVERSATION', payload: null });
      }
      setDeleteTarget(null);
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', payload: e instanceof Error ? e.message : '删除会话失败' });
    } finally {
      setDeleting(false);
    }
  }

  if (mode === 'collapsed') return null;

  const isFloating = mode === 'floating';

  return (
    <aside
      className={
        isFloating
          ? 'fixed left-0 top-3 z-50 h-[calc(100%-24px)] w-72 flex min-h-0 flex-col overflow-hidden rounded-r-xl animate-slide-in'
          : 'w-72 flex-shrink-0 flex min-h-0 flex-col h-full overflow-hidden rounded-xl'
      }
      style={{ backgroundColor: '#FCF8F5' }}
      onMouseEnter={isFloating ? onFloatingMouseEnter : undefined}
      onMouseLeave={isFloating ? onFloatingMouseLeave : undefined}
    >
      <div
        className="px-5 pt-5 pb-4 relative group"
        style={{
          borderBottom: '0.5px solid var(--app-border)',
          boxShadow: scrolled ? '0 2px 8px rgba(0,0,0,0.06)' : undefined,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="text-[13px] font-medium" style={{ color: 'var(--app-text)' }}>会话</span>
            {!isFloating && (
              <button
                type="button"
                onClick={onCollapse}
                aria-label="收起侧边栏"
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center w-5 h-5 rounded text-xs hover:opacity-100"
                style={{ color: 'var(--app-text-hint)' }}
              >
                ‹‹
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewConversation}
              className="w-6 h-6 flex items-center justify-center rounded text-base leading-none transition-colors hover:opacity-90"
              style={{ color: 'var(--app-text-hint)' }}
              title="新建会话"
              aria-label="新建会话"
            >
              +
            </button>
            {isFloating && (
              <button
                type="button"
                onClick={onExpand}
                aria-label="固定侧边栏"
                className="flex h-6 w-6 items-center justify-center rounded text-xs transition-colors hover:opacity-90"
                style={{ color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}
              >
                ››
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {state.loadingConvs ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 rounded mb-2" style={{ backgroundColor: 'var(--color-elevated)', width: '70%' }} />
                <div className="h-3 rounded" style={{ backgroundColor: 'var(--color-elevated)', width: '40%' }} />
              </div>
            ))}
          </div>
        ) : sortedConvs.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>暂无会话</p>
            <button
              onClick={handleNewConversation}
              className="mt-3 text-sm underline"
              style={{ color: 'var(--color-accent)' }}
            >
              创建第一个会话
            </button>
          </div>
        ) : (
          sortedConvs.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              active={state.selectedConvId === conv.id}
              onClick={() => void selectConversation(conv)}
              onDelete={() => setDeleteTarget(conv)}
            />
          ))
        )}
      </div>

      {deleteTarget && (
        <DeleteConversationDialog
          deleting={deleting}
          onConfirm={(cleanup) => void handleDelete(cleanup)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  );
}

function ConversationItem({
  conversation,
  active,
  onClick,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="w-full rounded-lg px-3 py-3 text-left transition-colors flex items-center gap-2 group"
      style={{
        backgroundColor: active ? '#f0f5f0' : 'transparent',
        border: active ? '1.5px solid #A8CCB5' : '1.5px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = '#F5F5F4';
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      <button onClick={onClick} className="flex-1 min-w-0 text-left">
        <div className="text-sm truncate" style={{ color: 'var(--app-text)', fontWeight: active ? 500 : 400 }}>
          {conversation.title || '未命名会话'}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'var(--app-text-secondary)' }}>
          {formatTime(conversation.updated_at)}
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-100"
        style={{ color: '#F85149' }}
        title="删除会话"
      >
        ×
      </button>
    </div>
  );
}

function DeleteConversationDialog({
  deleting,
  onConfirm,
  onCancel,
}: {
  deleting: boolean;
  onConfirm: (cleanupRunWorkspaces: boolean) => void;
  onCancel: () => void;
}) {
  const [cleanup, setCleanup] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        className="w-full max-w-sm rounded-[10px] p-6"
        style={{
          backgroundColor: '#FFFFFF',
          boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
          border: '0.5px solid #E8E7E4',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="text-[15px] font-medium" style={{ color: '#1A1A18' }}>删除会话</div>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            aria-label="关闭"
            className="px-1 py-0 text-xl leading-none"
            style={{ backgroundColor: 'transparent', color: '#6B6B64' }}
          >
            ×
          </button>
        </div>
        <div className="mt-4 text-[13px] leading-6" style={{ color: '#6B6B64' }}>
          删除后将移除此会话的消息、任务、Run 和确认记录。不会删除你的原始项目目录。
        </div>
        <label className="mt-4 flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: '#6B6B64' }}>
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
          />
          同时清理该会话产生的临时工作区
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium"
            style={{ backgroundColor: '#FFFFFF', color: '#6B6B64', border: '0.5px solid #E8E7E4' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(cleanup)}
            disabled={deleting}
            className="px-4 py-1.5 rounded-md text-[13px] font-medium"
            style={{ backgroundColor: deleting ? '#D1D0CC' : '#C0392B', color: '#FFFFFF' }}
          >
            {deleting ? '删除中...' : '删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
