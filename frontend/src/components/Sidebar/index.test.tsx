import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Sidebar } from './index';
import { AppContext } from '../../store/AppContext';
import type { Action, AppState } from '../../store/appState';
import { socketService } from '../../services/socket';
import type { Conversation } from '../../types';

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
}: {
  conversations?: Conversation[];
  selectedConvId?: string | null;
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

  render(
    <AppContext.Provider value={{ state, dispatch }}>
      <Sidebar />
    </AppContext.Provider>,
  );

  return { dispatch };
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

  it('collapses the conversation list to prioritize the chat area', () => {
    renderSidebar();

    fireEvent.click(screen.getByLabelText('收起会话列表'));

    expect(screen.queryByText('agenthub-test1')).toBeNull();
    expect(screen.getByLabelText('展开会话列表')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('展开会话列表'));

    expect(screen.getByText('agenthub-test1')).toBeTruthy();
  });
});
