import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Sidebar } from './index';
import { AppContext } from '../../store/AppContext';
import type { Action, AppState } from '../../store/appState';
import { socketService } from '../../services/socket';
import type { Conversation } from '../../types';
import type { SidebarMode } from './index';

vi.mock('../../store/runtimeActions', () => ({
  loadConversationRuntime: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  api: {
    deleteConversation: vi.fn(),
  },
}));

vi.mock('../../services/socket', () => ({
  socketService: {
    joinConversation: vi.fn(),
    leaveConversation: vi.fn(),
  },
}));

function makeConversation(id: string, title: string): Conversation {
  return {
    id,
    title,
    type: 'single',
    task_id: null,
    agent_platform: 'claude_cli',
    created_at: '2026-06-10T16:42:00.000Z',
    updated_at: '2026-06-10T16:42:00.000Z',
    task: null,
  };
}

function renderSidebar({
  conversations = [makeConversation('conv-1', 'agenthub-test1')],
  selectedConvId = 'conv-1',
  mode = 'expanded',
  onCollapse = vi.fn(),
  onExpand = vi.fn(),
}: {
  conversations?: Conversation[];
  selectedConvId?: string | null;
  mode?: SidebarMode;
  onCollapse?: () => void;
  onExpand?: () => void;
} = {}) {
  const state: AppState = {
    conversations,
    selectedConvId,
    agents: [],
    workspaces: {},
    messagesByConversation: {},
    timeline: {},
    plansByConversation: {},
    planningByConversation: {},
    activeRunIdsByConversation: {},
    connected: true,
    loadingConvs: false,
    loadingAgents: false,
    loadingTimeline: false,
    error: null,
  };
  const dispatch = vi.fn<(action: Action) => void>();

  const result = render(
    <AppContext.Provider value={{ state, dispatch }}>
      <Sidebar mode={mode} onCollapse={onCollapse} onExpand={onExpand} />
    </AppContext.Provider>,
  );

  return { dispatch, onCollapse, onExpand, container: result.container };
}

describe('Sidebar new conversation navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the plus button to navigate to the blank setup view without creating a record', () => {
    const { dispatch } = renderSidebar();

    fireEvent.click(screen.getByTitle('新建会话'));

    expect(socketService.leaveConversation).toHaveBeenCalledWith('conv-1');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_CONVERSATION', payload: null });
  });

  it('uses the empty-state action to navigate without requiring an existing selection', () => {
    const { dispatch } = renderSidebar({ conversations: [], selectedConvId: null });

    fireEvent.click(screen.getByText('创建第一个会话'));

    expect(socketService.leaveConversation).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_CONVERSATION', payload: null });
  });

  it('renders the conversation list in expanded mode', () => {
    renderSidebar();

    expect(screen.getByText('agenthub-test1')).toBeTruthy();
    expect(screen.getByText('会话')).toBeTruthy();
    expect(screen.getByLabelText('新建会话')).toBeTruthy();
  });

  it('calls onCollapse when the collapse hint button is clicked', () => {
    const { onCollapse } = renderSidebar();

    const collapseBtn = screen.getByLabelText('收起侧边栏');
    fireEvent.click(collapseBtn);

    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it('renders the expand button and calls onExpand in floating mode', () => {
    const { onExpand } = renderSidebar({ mode: 'floating' });

    const expandBtn = screen.getByLabelText('固定侧边栏');
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn);

    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('renders nothing in collapsed mode', () => {
    renderSidebar({ mode: 'collapsed' });

    expect(screen.queryByText('会话')).toBeNull();
    expect(screen.queryByText('agenthub-test1')).toBeNull();
  });
});
