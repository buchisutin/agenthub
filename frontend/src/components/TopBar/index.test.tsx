import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Dispatch } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TopBar } from './index';
import { AppContext } from '../../store/AppContext';
import type { Action, AppState } from '../../store/appState';
import type { Agent } from '../../types';

vi.mock('../../store/runtimeActions', () => ({
  bindWorkspace: vi.fn(),
}));

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      cleanupConversationWorkspaces: vi.fn(),
      listAgents: vi.fn(),
      getRuntimes: vi.fn(),
      checkAllRuntimes: vi.fn(),
      checkRuntime: vi.fn().mockResolvedValue({ adapterType: 'claude_cli', available: true }),
      createAgent: vi.fn(),
      updateAgent: vi.fn(),
      setDefaultAgent: vi.fn(),
      disableAgent: vi.fn(),
      enableAgent: vi.fn(),
      getConversationSummary: vi.fn().mockResolvedValue({
        conversationId: '',
        title: null,
        workspace: null,
        counts: { messages: 0, tasks: 0, runs: 0, completedRuns: 0, failedRuns: 0, interruptedRuns: 0, appliedRuns: 0, cleanedWorkspaces: 0, pendingConfirmations: 0 },
        tasks: [],
        runs: [],
        fileChanges: [],
        confirmations: [],
      }),
      validateWorkspace: vi.fn().mockResolvedValue({
        rootPath: '/tmp/workspace',
        exists: true,
        isDirectory: true,
        isGitRepo: true,
        gitRoot: '/tmp/workspace',
        packageJsonExists: true,
        previewCapable: true,
        errors: [],
      }),
    },
  };
});

import { api } from '../../services/api';

const mockedListAgents = vi.mocked(api.listAgents);
const mockedGetRuntimes = vi.mocked(api.getRuntimes);
const mockedCheckAllRuntimes = vi.mocked(api.checkAllRuntimes);
const mockedCheckRuntime = vi.mocked(api.checkRuntime);
const mockedValidateWorkspace = vi.mocked(api.validateWorkspace);
const mockedGetConversationSummary = vi.mocked(api.getConversationSummary);
const mockedCreateAgent = vi.mocked(api.createAgent);
const mockedUpdateAgent = vi.mocked(api.updateAgent);
const mockedSetDefaultAgent = vi.mocked(api.setDefaultAgent);
const mockedDisableAgent = vi.mocked(api.disableAgent);
const mockedEnableAgent = vi.mocked(api.enableAgent);

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'frontend-agent',
    slug: 'frontend-agent',
    platform: 'claude-cli',
    adapter_type: 'claude_cli',
    instructions: 'Focus on UI',
    status: 'active',
    capabilities: ['frontend', 'react'],
    config_json: null,
    enabled: true,
    is_default: false,
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
    ...overrides,
  };
}

function mockRuntimeApis() {
  mockedGetRuntimes.mockResolvedValue([
    {
      adapterType: 'claude_cli',
      displayName: 'Claude Code',
      capabilities: ['planning'],
      registered: true,
    },
    {
      adapterType: 'fake_adapter',
      displayName: 'Fake Adapter',
      capabilities: ['test'],
      registered: true,
    },
  ]);
  mockedCheckAllRuntimes.mockResolvedValue([
    {
      adapterType: 'claude_cli',
      available: true,
      version: '1.0.0',
      executablePath: '/usr/bin/claude',
    },
    {
      adapterType: 'fake_adapter',
      available: false,
      message: 'fake runtime unavailable',
      version: null,
      executablePath: null,
    },
  ]);
}

describe('TopBar', () => {
  beforeEach(() => {
    mockedListAgents.mockReset();
    mockedGetRuntimes.mockReset();
    mockedCheckAllRuntimes.mockReset();
    mockedCheckRuntime.mockReset();
    mockedValidateWorkspace.mockReset();
    mockedGetConversationSummary.mockReset();
    mockedCreateAgent.mockReset();
    mockedUpdateAgent.mockReset();
    mockedSetDefaultAgent.mockReset();
    mockedDisableAgent.mockReset();
    mockedEnableAgent.mockReset();
    mockedCheckRuntime.mockResolvedValue({ adapterType: 'claude_cli', available: true, version: '1.0.0' });
    mockedValidateWorkspace.mockResolvedValue({
      rootPath: '/tmp/workspace',
      exists: true, isDirectory: true, isGitRepo: true, gitRoot: '/tmp/workspace',
      packageJsonExists: true, previewCapable: true, errors: [],
    });
    mockRuntimeApis();
  });

  it('uses compact corners and a thin border for project actions', () => {
    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };

    render(
      <AppContext.Provider value={{ state, dispatch: vi.fn<Dispatch<Action>>() }}>
        <TopBar onOpenProjectArtifact={vi.fn()} />
      </AppContext.Provider>,
    );

    for (const name of ['代码改动', '网页预览', '部署', 'Agents']) {
      const button = screen.getByRole('button', { name });
      expect(button.classList.contains('rounded-lg')).toBe(true);
      expect(button.classList.contains('rounded-full')).toBe(false);
      expect(button.style.borderWidth).toBe('0.5px');
    }
  });

  it('routes top controls to project-scoped tabs without showing the file count', () => {
    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const onOpenProjectArtifact = vi.fn();
    render(
      <AppContext.Provider value={{ state, dispatch: vi.fn<Dispatch<Action>>() }}>
        <TopBar onOpenProjectArtifact={onOpenProjectArtifact} projectFileCount={3} />
      </AppContext.Provider>,
    );

    expect(screen.queryByRole('button', { name: '代码改动 3' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '代码改动' }));
    fireEvent.click(screen.getByRole('button', { name: '网页预览' }));
    fireEvent.click(screen.getByRole('button', { name: '部署' }));

    expect(onOpenProjectArtifact.mock.calls).toEqual([
      ['diff'],
      ['preview'],
      ['deploy'],
    ]);
  });

  it('shows the running run count for the selected conversation', () => {
    const state: AppState = {
      conversations: [
        {
          id: 'conv-1',
          title: '验收会话',
          type: 'single',
          task_id: 'task-1',
          agent_platform: 'claude_cli',
          created_at: '2026-05-28T00:00:00.000Z',
          updated_at: '2026-05-28T00:00:00.000Z',
          task: {
            id: 'task-1',
            title: '稳定化验收',
            status: 'todo',
          },
        },
      ],
      selectedConvId: 'conv-1',
      agents: [],
      workspaces: { 'conv-1': { id: 'ws-1', conversation_id: 'conv-1', root_path: '/Users/test/project', mode: 'direct', created_at: '2026-05-28T00:00:00.000Z', updated_at: '2026-05-28T00:00:00.000Z' } },
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: { 'conv-1': ['run-1', 'run-2'] },
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    expect(screen.getByText('2 running')).toBeTruthy();
    expect(screen.queryByText('Task: 稳定化验收')).toBeNull();
  });

  it('does not re-check all runtimes on parent rerender while agent modal stays open', async () => {
    mockedListAgents.mockResolvedValue([makeAgent({ is_default: true, enabled: true })]);

    const state: AppState = {
      conversations: [
        {
          id: 'conv-1',
          title: 'Test',
          type: 'single',
          task_id: null,
          agent_platform: null,
          created_at: '2026-05-28T00:00:00.000Z',
          updated_at: '2026-05-28T00:00:00.000Z',
          task: null,
        },
      ],
      selectedConvId: 'conv-1',
      agents: [makeAgent({ is_default: true, enabled: true })],
      workspaces: { 'conv-1': { id: 'ws-1', conversation_id: 'conv-1', root_path: '/Users/test/project', mode: 'direct', created_at: '2026-05-28T00:00:00.000Z', updated_at: '2026-05-28T00:00:00.000Z' } },
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    const { rerender } = render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => {
      expect(mockedCheckAllRuntimes).toHaveBeenCalledTimes(1);
    });

    rerender(
      <AppContext.Provider
        value={{
          state: {
            ...state,
            connected: false,
          },
          dispatch,
        }}
      >
        <TopBar />
      </AppContext.Provider>,
    );

    await screen.findByRole('button', { name: /@frontend-agent/i });
    expect(mockedCheckAllRuntimes).toHaveBeenCalledTimes(1);
  });

  it('opens agent settings and renders the agent list', async () => {
    mockedListAgents.mockResolvedValue([
      makeAgent({ is_default: true }),
    ]);

    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => expect(mockedListAgents).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockedGetRuntimes).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /@frontend-agent/i })).toBeTruthy();
    expect(screen.getByText(/claude_cli · runtime available/i)).toBeTruthy();
    expect(screen.getAllByText(/runtime available/i).length).toBeGreaterThan(0);
  });

  it('creates and updates agents', async () => {
    const baseAgent = makeAgent();
    mockedListAgents
      .mockResolvedValueOnce([baseAgent])
      .mockResolvedValueOnce([baseAgent])
      .mockResolvedValue([baseAgent]);
    mockedCreateAgent.mockResolvedValue(makeAgent({ id: 'agent-2', name: 'backend-agent', slug: 'backend-agent' }));
    mockedUpdateAgent.mockResolvedValue(makeAgent({ instructions: 'Prefer Tailwind' }));

    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByRole('button', { name: /@frontend-agent/i });
    expect(
      screen.getByPlaceholderText(
        'Describe how this agent should behave, what it should focus on, and what it should avoid.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /\+ 新建 Agent|New Agent/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'backend-agent' } });
    fireEvent.click(screen.getByText('Fake Adapter (fake_adapter)'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Agent' }));
    await waitFor(() => expect(mockedCreateAgent).toHaveBeenCalled());
    expect(mockedCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'backend-agent',
      slug: 'backend-agent',
      adapterType: 'fake_adapter',
      capabilities: ['test'],
    }));

    fireEvent.click(screen.getByRole('button', { name: /@frontend-agent/i }));
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Prefer Tailwind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    await waitFor(() => expect(mockedUpdateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      instructions: 'Prefer Tailwind',
    })));
  });

  it('sets the default agent', async () => {
    const baseAgent = makeAgent();
    mockedListAgents.mockResolvedValue([baseAgent]);
    mockedUpdateAgent.mockResolvedValue(makeAgent({ is_default: true }));

    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByRole('button', { name: /@frontend-agent/i });

    fireEvent.click(screen.getByRole('button', { name: /@frontend-agent/i }));

    fireEvent.click(screen.getByRole('button', { name: /设为默认 Agent/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Agent|已保存/i }));
    await waitFor(() => expect(mockedUpdateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      isDefault: true,
    })));
  });

  it('disables and enables agents', async () => {
    const baseAgent = makeAgent();
    mockedListAgents
      .mockResolvedValueOnce([baseAgent])
      .mockResolvedValueOnce([makeAgent({ enabled: false, status: 'unavailable' })])
      .mockResolvedValueOnce([makeAgent({ enabled: true, status: 'active' })]);
    mockedUpdateAgent
      .mockResolvedValueOnce(makeAgent({ enabled: false, status: 'unavailable' }))
      .mockResolvedValueOnce(makeAgent({ enabled: true, status: 'active' }));

    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByRole('button', { name: /@frontend-agent/i });

    fireEvent.click(screen.getByRole('button', { name: /@frontend-agent/i }));

    fireEvent.click(screen.getByRole('button', { name: /已启用/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Agent|已保存/i }));
    await waitFor(() => expect(mockedUpdateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      enabled: false,
    })));

    await screen.findByRole('button', { name: /已禁用/i });
    fireEvent.click(screen.getByRole('button', { name: /已禁用/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Agent|已保存/i }));
    await waitFor(() => expect(mockedUpdateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      enabled: true,
    })));
  });

  it('shows runtime warnings for unavailable adapters', async () => {
    mockedListAgents.mockResolvedValue([
      makeAgent({ adapter_type: 'fake_adapter' }),
    ]);

    const state: AppState = {
      conversations: [],
      selectedConvId: null,
      agents: [],
      workspaces: {},
      messagesByConversation: {},
      timeline: {},
      plansByConversation: {},
      activeRunIdsByConversation: {},
      pendingClarificationConvIds: [],
      connected: true,
      loadingConvs: false,
      loadingAgents: false,
      loadingTimeline: false,
      error: null,
    };
    const dispatch = vi.fn<Dispatch<Action>>();

    render(
      <AppContext.Provider value={{ state, dispatch }}>
        <TopBar />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    await screen.findByRole('button', { name: /@frontend-agent/i });

    expect(screen.getByText(/fake_adapter · runtime unavailable/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /@frontend-agent/i }));
    expect(screen.getByText(/Runtime unavailable: fake runtime unavailable/i)).toBeTruthy();
  });
});
