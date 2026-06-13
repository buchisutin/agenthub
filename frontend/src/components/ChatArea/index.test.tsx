import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useReducer, type Dispatch } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatArea } from './index';
import { AppContext } from '../../store/AppContext';
import { reducer, type Action, type AppState } from '../../store/appState';
import type { Agent, ChatTimelineItem, RunCardSummary, Workspace } from '../../types';
import { startRun } from '../../store/runtimeActions';
import { api } from '../../services/api';

vi.mock('../../store/runtimeActions', () => ({
  startRun: vi.fn(),
}));

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createMessage: vi.fn(),
      getConversationTimeline: vi.fn(),
      getConversationTasks: vi.fn(),
      getConversationAssignments: vi.fn(),
      getTaskDetail: vi.fn(),
      updateTaskStatus: vi.fn(),
      rerunTask: vi.fn(),
      getRunFileChanges: vi.fn(),
      orchestrateConversation: vi.fn(),
      startRunPreview: vi.fn(),
      stopRunPreview: vi.fn(),
      getRunCardSummary: vi.fn().mockResolvedValue({
        workspace: { mode: 'legacy', rootPath: null, branchName: null, status: 'ready', errorMessage: null },
        changeApplication: null,
        fileChanges: [
          {
            filePath: 'src/example.ts',
            changeType: 'edit',
            oldContent: 'before\n',
            newContent: 'after\n',
            confidence: 'exact',
            source: 'tool_event',
          },
        ],
      }),
      getRunWorkspace: vi.fn().mockResolvedValue({ mode: 'legacy', rootPath: null, branchName: null, status: 'ready', errorMessage: null }),
      getRunChangeApplication: vi.fn().mockResolvedValue(null),
      checkRunApply: vi.fn(),
      applyRunChanges: vi.fn(),
      requestApplyChanges: vi.fn(),
      cleanupRunWorkspace: vi.fn(),
      cleanupConversationWorkspaces: vi.fn(),
      getConversationApprovals: vi.fn().mockResolvedValue([]),
      getApproval: vi.fn(),
      approveApproval: vi.fn(),
      rejectApproval: vi.fn(),
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
      createConversationWithWorkspace: vi.fn(),
      checkRuntime: vi.fn().mockResolvedValue({ adapterType: 'claude_cli', available: true }),
    },
  };
});

vi.mock('../../services/socket', () => ({
  socketService: {
    interruptRun: vi.fn(),
    subscribeRun: vi.fn(),
  },
}));

const mockedStartRun = vi.mocked(startRun);
const mockedGetRunFileChanges = vi.mocked(api.getRunFileChanges);
const mockedGetRunCardSummary = vi.mocked(api.getRunCardSummary);
const mockedOrchestrateConversation = vi.mocked(api.orchestrateConversation);
const mockedStartRunPreview = vi.mocked(api.startRunPreview);
const mockedStopRunPreview = vi.mocked(api.stopRunPreview);
const mockedCreateMessage = vi.mocked(api.createMessage);
const mockedGetConversationTasks = vi.mocked(api.getConversationTasks);
const mockedGetConversationAssignments = vi.mocked(api.getConversationAssignments);
const mockedGetTaskDetail = vi.mocked(api.getTaskDetail);
const mockedUpdateTaskStatus = vi.mocked(api.updateTaskStatus);
const mockedRerunTask = vi.mocked(api.rerunTask);
const inputPlaceholder = /Ask agents to build/i;
const defaultRunCardFileChanges = [
  {
    filePath: 'src/example.ts',
    changeType: 'edit' as const,
    oldContent: 'before\n',
    newContent: 'after\n',
    confidence: 'exact' as const,
    source: 'tool_event' as const,
  },
];

class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback([
      {
        isIntersecting: true,
        target,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRatio: 1,
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: Date.now(),
      } as IntersectionObserverEntry,
    ], this as unknown as IntersectionObserver);
  }

  unobserve(_target: Element) {}

  disconnect() {}
}

function makeAgent(
  id: string,
  name: string,
  adapterType = 'claude_cli',
  input: { enabled?: boolean; isDefault?: boolean; slug?: string } = {},
): Agent {
  return {
    id,
    name,
    slug:
      input.slug ??
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    platform: 'claude-cli',
    adapter_type: adapterType,
    instructions: null,
    status: 'active',
    capabilities: ['text_generation'],
    config_json: null,
    enabled: input.enabled ?? true,
    is_default: input.isDefault ?? false,
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
  };
}

function makeWorkspace(): Workspace {
  return {
    id: 'ws-1',
    conversation_id: 'conv-1',
    root_path: '/tmp/workspace',
    mode: 'direct',
    created_at: '2026-05-28T00:00:00.000Z',
    updated_at: '2026-05-28T00:00:00.000Z',
  };
}

function makeRunCardSummary(overrides: Partial<RunCardSummary> = {}): RunCardSummary {
  return {
    workspace: { mode: 'legacy', rootPath: null, branchName: null, status: 'ready', errorMessage: null },
    changeApplication: null,
    fileChanges: defaultRunCardFileChanges,
    ...overrides,
  };
}

function renderChatArea({
  agents,
  workspace = makeWorkspace(),
  timeline = {},
  messagesByConversation = {},
  plansByConversation = {},
  activeRunIdsByConversation = {},
  selectedConvId = 'conv-1',
}: {
  agents: Agent[];
  workspace?: Workspace | null;
  timeline?: Record<string, ChatTimelineItem[]>;
  messagesByConversation?: AppState['messagesByConversation'];
  plansByConversation?: AppState['plansByConversation'];
  activeRunIdsByConversation?: Record<string, string[]>;
  selectedConvId?: string | null;
}) {
  const state: AppState = {
    conversations: [],
    selectedConvId,
    agents,
    workspaces: { 'conv-1': workspace },
    messagesByConversation,
    timeline,
    plansByConversation,
    activeRunIdsByConversation,
    connected: true,
    loadingConvs: false,
    loadingAgents: false,
    loadingTimeline: false,
    error: null,
  };
  const dispatch = vi.fn<Dispatch<Action>>();

  render(
    <AppContext.Provider value={{ state, dispatch }}>
      <ChatArea />
    </AppContext.Provider>,
  );

  for (const button of screen.queryAllByRole('button', { name: '展开' })) {
    fireEvent.click(button);
  }

  return { dispatch, workspace };
}

function renderChatAreaStateful({
  agents,
  workspace = makeWorkspace(),
  timeline = {},
  messagesByConversation = {},
  plansByConversation = {},
  activeRunIdsByConversation = {},
  selectedConvId = 'conv-1',
}: {
  agents: Agent[];
  workspace?: Workspace | null;
  timeline?: Record<string, ChatTimelineItem[]>;
  messagesByConversation?: AppState['messagesByConversation'];
  plansByConversation?: AppState['plansByConversation'];
  activeRunIdsByConversation?: Record<string, string[]>;
  selectedConvId?: string | null;
}) {
  const state: AppState = {
    conversations: [],
    selectedConvId,
    agents,
    workspaces: { 'conv-1': workspace },
    messagesByConversation,
    timeline,
    plansByConversation,
    activeRunIdsByConversation,
    connected: true,
    loadingConvs: false,
    loadingAgents: false,
    loadingTimeline: false,
    error: null,
  };

  function Wrapper() {
    const [value, dispatch] = useReducer(reducer, state);
    return (
      <AppContext.Provider value={{ state: value, dispatch }}>
        <ChatArea />
      </AppContext.Provider>
    );
  }

  render(<Wrapper />);

  for (const button of screen.queryAllByRole('button', { name: '展开' })) {
    fireEvent.click(button);
  }
}

describe('ChatArea mention fan-out', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    mockedStartRun.mockReset();
    mockedStartRun.mockResolvedValue({ id: 'run-1' } as never);
    mockedCreateMessage.mockReset();
    mockedCreateMessage.mockResolvedValue({
      id: 'msg-1',
      conversation_id: 'conv-1',
      sender_type: 'user',
      sender_id: null,
      content: 'message',
      message_type: 'text',
      mentions: null,
      metadata_json: null,
      created_at: '2026-05-28T00:00:00.000Z',
    } as never);
    mockedGetRunFileChanges.mockReset();
    mockedGetRunFileChanges.mockResolvedValue(defaultRunCardFileChanges);
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(makeRunCardSummary());
    mockedOrchestrateConversation.mockReset();
    mockedGetConversationTasks.mockReset();
    mockedGetConversationTasks.mockResolvedValue([]);
    mockedGetConversationAssignments.mockReset();
    mockedGetConversationAssignments.mockResolvedValue([]);
    mockedGetTaskDetail.mockReset();
    mockedUpdateTaskStatus.mockReset();
    mockedRerunTask.mockReset();
    mockedStartRunPreview.mockReset();
    mockedStopRunPreview.mockReset();
    mockedStopRunPreview.mockResolvedValue({ ok: true });
    vi.mocked(api.getRunChangeApplication).mockReset();
    vi.mocked(api.getRunChangeApplication).mockResolvedValue(null);
    vi.mocked(api.applyRunChanges).mockReset();
    vi.mocked(api.requestApplyChanges).mockReset();
    vi.mocked(api.getConversationApprovals).mockReset();
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.approveApproval).mockReset();
    vi.mocked(api.rejectApproval).mockReset();
    vi.mocked(api.cleanupRunWorkspace).mockReset();
  });

  it('fans out one message to multiple mentioned agents with stripped prompt', async () => {
    const agents = [
      makeAgent('agent-front', 'frontend-agent'),
      makeAgent('agent-back', 'backend-agent'),
    ];
    const { workspace, dispatch } = renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '@frontend-agent @backend-agent 做一个首页' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledTimes(2));
    expect(mockedStartRun).toHaveBeenNthCalledWith(
      1,
      'conv-1',
      '做一个首页',
      'agent-front',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedStartRun).toHaveBeenNthCalledWith(
      2,
      'conv-1',
      '做一个首页',
      'agent-back',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '@frontend-agent @backend-agent 做一个首页',
      mentions: [
        { type: 'agent', targetId: 'agent-front', raw: '@frontend-agent' },
        { type: 'agent', targetId: 'agent-back', raw: '@backend-agent' },
      ],
      messageType: 'command',
    });
  });

  it('renders user and agent messages with distinct alignment and bubble styles', () => {
    const agents = [makeAgent('builder', 'builder')];
    renderChatArea({
      agents,
      messagesByConversation: {
        'conv-1': [
          {
            id: 'msg-user',
            conversation_id: 'conv-1',
            sender_type: 'user',
            sender_id: null,
            content: '你好',
            message_type: 'text',
            mentions: null,
            metadata_json: null,
            created_at: '2026-05-28T00:00:00.000Z',
          },
          {
            id: 'msg-agent',
            conversation_id: 'conv-1',
            sender_type: 'agent',
            sender_id: 'builder',
            content: '你好！',
            message_type: 'text',
            mentions: null,
            metadata_json: null,
            created_at: '2026-05-28T00:00:05.000Z',
          },
        ],
      },
    });

    const userCard = screen.getByText('你好').closest('[data-message-role="user"]');
    const agentCard = screen.getByText('你好！').closest('[data-message-role="agent"]');
    const userBubble = screen
      .getByText('你好')
      .closest('div[style*="background-color"]') as HTMLDivElement | null;
    const agentBubble = screen
      .getByText('你好！')
      .closest('div[style*="background-color"]') as HTMLDivElement | null;

    expect(userCard).not.toBeNull();
    expect(agentCard).not.toBeNull();
    expect(userCard?.getAttribute('class')).toContain('justify-end');
    expect(agentCard?.getAttribute('class')).toContain('justify-start');
    expect(userBubble).not.toBeNull();
    expect(agentBubble).not.toBeNull();
    expect(userBubble!.style.backgroundColor).toBe('rgb(239, 248, 255)');
    expect(userBubble!.style.borderTopColor).toBe('rgb(191, 219, 254)');
    expect(agentBubble!.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(agentBubble!.style.borderTopColor).toBe('rgb(232, 231, 228)');
    expect(screen.getByText('builder')).toBeTruthy();
  });

  it('uses the default claude agent when no mention is present', async () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
      makeAgent('agent-back', 'backend-agent', 'custom_adapter'),
    ];
    const { workspace, dispatch } = renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '直接做这个任务' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledTimes(1));
    expect(mockedStartRun).toHaveBeenCalledWith(
      'conv-1',
      '直接做这个任务',
      'agent-default',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '直接做这个任务',
      mentions: [],
      messageType: 'text',
    });
  });

  it('ignores unknown mentions and falls back to the default agent', async () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
      makeAgent('agent-front', 'frontend-agent'),
    ];
    const { workspace, dispatch } = renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '@unknown-agent 修一下页面' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledTimes(1));
    expect(mockedStartRun).toHaveBeenCalledWith(
      'conv-1',
      '@unknown-agent 修一下页面',
      'agent-default',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '@unknown-agent 修一下页面',
      mentions: [{ type: 'unknown', targetId: null, raw: '@unknown-agent' }],
      messageType: 'command',
    });
  });

  it('treats disabled agent mentions as unknown and does not fan out to them', async () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
      makeAgent('agent-disabled', 'frontend-agent', 'claude_cli', { enabled: false }),
    ];
    const { workspace, dispatch } = renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '@frontend-agent 修一下页面' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledTimes(1));
    expect(mockedStartRun).toHaveBeenCalledWith(
      'conv-1',
      '@frontend-agent 修一下页面',
      'agent-default',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '@frontend-agent 修一下页面',
      mentions: [{ type: 'unknown', targetId: null, raw: '@frontend-agent' }],
      messageType: 'command',
    });
  });

  it('shows runtime unavailable errors when run creation fails', async () => {
    const agents = [makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true })];
    mockedStartRun.mockRejectedValueOnce(
      new Error('Runtime adapter claude_cli is unavailable: claude CLI not found'),
    );
    renderChatAreaStateful({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '直接做这个任务' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByText('Runtime adapter claude_cli is unavailable: claude CLI not found')).toBeTruthy(),
    );
  });

  it('shows diff buttons for completed runs and only requests the selected runId', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      {
        filePath: 'src/a.ts',
        changeType: 'edit',
        oldContent: 'a\n',
        newContent: 'b\n',
        confidence: 'snapshot',
        source: 'read_tool',
      },
    ]);

    const agents = [makeAgent('agent-default', 'claude-code')];
    const completedRuns: ChatTimelineItem[] = [
      {
        id: 'run-1',
        conversationId: 'conv-1',
        runId: 'run-1',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-1',
        prompt: 'first',
        status: 'completed',
        startedAt: '2026-05-28T00:00:00.000Z',
        finishedAt: '2026-05-28T00:01:00.000Z',
        blocks: [],
        error: null,
      },
      {
        id: 'run-2',
        conversationId: 'conv-1',
        runId: 'run-2',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-2',
        prompt: 'second',
        status: 'completed',
        startedAt: '2026-05-28T00:02:00.000Z',
        finishedAt: '2026-05-28T00:03:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      timeline: { 'conv-1': completedRuns },
    });

    const buttons = await screen.findAllByRole('button', { name: '查看产物' });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[1]!);

    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledTimes(1));
    expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-2');
  });

  it('shows preview buttons only for completed runs and starts preview for the selected run', async () => {
    mockedStartRunPreview.mockResolvedValue({
      url: 'http://127.0.0.1:3100',
      port: 3100,
    });

    const agents = [makeAgent('agent-default', 'claude-code')];
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-completed',
        conversationId: 'conv-1',
        runId: 'run-completed',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-1',
        prompt: 'completed',
        status: 'completed',
        startedAt: '2026-05-28T00:00:00.000Z',
        finishedAt: '2026-05-28T00:01:00.000Z',
        blocks: [],
        error: null,
      },
      {
        id: 'run-running',
        conversationId: 'conv-1',
        runId: 'run-running',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-2',
        prompt: 'running',
        status: 'running',
        startedAt: '2026-05-28T00:02:00.000Z',
        finishedAt: null,
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      timeline: { 'conv-1': runs },
      activeRunIdsByConversation: { 'conv-1': ['run-running'] },
    });

    const artifactButtons = await screen.findAllByRole('button', { name: '查看产物' });
    expect(artifactButtons).toHaveLength(1);

    fireEvent.click(artifactButtons[0]!);
    fireEvent.click(screen.getByRole('button', { name: '网页预览' }));
    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => expect(mockedStartRunPreview).toHaveBeenCalledTimes(1));
    expect(mockedStartRunPreview).toHaveBeenCalledWith('run-completed');
    expect(screen.getByTitle('Run preview')).toBeTruthy();
  });

  it('shows preview start error on the matching run only', async () => {
    mockedStartRunPreview.mockRejectedValue(new Error('preview failed'));

    const agents = [makeAgent('agent-default', 'claude-code')];
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-a',
        conversationId: 'conv-1',
        runId: 'run-a',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-1',
        prompt: 'a',
        status: 'completed',
        startedAt: '2026-05-28T00:00:00.000Z',
        finishedAt: '2026-05-28T00:01:00.000Z',
        blocks: [],
        error: null,
      },
      {
        id: 'run-b',
        conversationId: 'conv-1',
        runId: 'run-b',
        taskId: null,
        agentId: 'agent-default',
        agentName: 'claude-code',
        agentSessionId: 'session-2',
        prompt: 'b',
        status: 'completed',
        startedAt: '2026-05-28T00:02:00.000Z',
        finishedAt: '2026-05-28T00:03:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      timeline: { 'conv-1': runs },
    });

    const artifactButtons = await screen.findAllByRole('button', { name: '查看产物' });
    fireEvent.click(artifactButtons[1]!);
    fireEvent.click(screen.getByRole('button', { name: '网页预览' }));
    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    expect(await screen.findByText('preview failed')).toBeTruthy();
    expect(mockedStartRunPreview).toHaveBeenCalledWith('run-b');
  });

  it('uses orchestrator when @orchestrator is present and removes that mention from prompt', async () => {
    mockedOrchestrateConversation.mockResolvedValue({
      plan: {
        id: 'plan-1',
        summary: '拆成两个任务',
        items: [
          {
            index: 1,
            title: '前端任务',
            description: '做前端页面',
            taskType: 'frontend',
            expectedOutput: 'Build the frontend page.',
            assignedAgentId: 'agent-front',
            assignedAgentName: 'frontend-agent',
            priority: 1,
            taskId: 'task-plan-1',
            assignmentId: 'assignment-plan-1',
            runId: 'run-plan-1',
            status: 'queued',
          },
        ],
      },
      runs: [
        {
          id: 'run-plan-1',
          conversation_id: 'conv-1',
          task_id: null,
          assignment_id: null,
          agent_id: 'agent-front',
          runtime_id: null,
          agent_session_id: null,
          source_message_id: 'msg-plan-1',
          workspace_id: 'ws-1',
          prompt: '做前端页面',
          trigger_type: 'chat',
          trigger_source_id: 'conv-1',
          requested_by: 'user',
          status: 'queued',
          pid: null,
          exit_code: null,
          error_message: null,
          started_at: '2026-05-28T00:00:00.000Z',
          finished_at: null,
          event_count: 0,
        },
      ],
    });

    const agents = [
      makeAgent('agent-default', 'claude-code'),
      makeAgent('agent-front', 'frontend-agent'),
    ];
    const { dispatch } = renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(/@orchestrator/i), {
      target: { value: '@orchestrator 做一个博客系统' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedOrchestrateConversation).toHaveBeenCalledTimes(1));
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '@orchestrator 做一个博客系统',
      mentions: [{ type: 'orchestrator', targetId: null, raw: '@orchestrator' }],
      messageType: 'command',
    });
    expect(mockedOrchestrateConversation).toHaveBeenCalledWith('conv-1', '做一个博客系统', 'msg-1');
    expect(mockedStartRun).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_MESSAGE',
        payload: expect.objectContaining({
          message: expect.objectContaining({ id: 'msg-1' }),
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADD_PLAN_CARD' }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_PLAN_CARD',
        payload: expect.objectContaining({
          plan: expect.objectContaining({
            items: [
              expect.objectContaining({
                runId: 'run-plan-1',
                taskType: 'frontend',
                expectedOutput: 'Build the frontend page.',
              }),
            ],
          }),
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPSERT_TIMELINE_ITEM',
        payload: expect.objectContaining({
          item: expect.objectContaining({ runId: 'run-plan-1' }),
        }),
      }),
    );
  });

  it('prioritizes orchestrator over normal mentions when mixed', async () => {
    mockedOrchestrateConversation.mockResolvedValue({
      plan: {
        id: 'plan-mixed',
        summary: 'mixed',
        items: [],
      },
      runs: [],
    });

    const agents = [
      makeAgent('agent-default', 'claude-code'),
      makeAgent('agent-front', 'frontend-agent'),
    ];
    renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(/@orchestrator/i), {
      target: { value: '@orchestrator @frontend-agent 做首页' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedOrchestrateConversation).toHaveBeenCalledTimes(1));
    expect(mockedOrchestrateConversation).toHaveBeenCalledWith('conv-1', '@frontend-agent 做首页', 'msg-1');
    expect(mockedStartRun).not.toHaveBeenCalled();
  });

  it('renders restored user messages together with run cards', async () => {
    const agents = [makeAgent('agent-default', 'claude-code')];
    renderChatArea({
      agents,
      messagesByConversation: {
        'conv-1': [
          {
            id: 'msg-user-1',
            conversation_id: 'conv-1',
            sender_type: 'user',
            sender_id: null,
            content: '先做一个登录页',
            message_type: 'text',
            mentions: null,
            metadata_json: null,
            created_at: '2026-05-28T00:00:00.000Z',
          },
        ],
      },
      timeline: {
        'conv-1': [
          {
            id: 'run-restored-1',
            conversationId: 'conv-1',
            runId: 'run-restored-1',
            taskId: null,
            agentId: 'agent-default',
            agentName: 'claude-code',
            agentSessionId: 'session-1',
            prompt: '先做一个登录页',
            status: 'completed',
            startedAt: '2026-05-28T00:01:00.000Z',
            finishedAt: '2026-05-28T00:02:00.000Z',
            blocks: [],
            error: null,
          },
        ],
      },
    });

    await screen.findByRole('button', { name: '查看产物' });
    expect(screen.getByText('先做一个登录页')).toBeTruthy();
  });

  it('renders PlanCard and matching RunCards together for orchestrated runs', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    const plan = {
      id: 'plan-1',
      conversationId: 'conv-1',
      prompt: '做一个博客系统',
      summary: '拆成前后端两个任务',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '前端页面',
          description: '做前端页面',
          taskType: 'frontend' as const,
          expectedOutput: 'Build the blog UI.',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-plan-1',
          assignmentId: 'assignment-plan-1',
          runId: 'run-plan-1',
          status: 'completed' as const,
        },
      ],
    };
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-plan-1',
        conversationId: 'conv-1',
        runId: 'run-plan-1',
        taskId: null,
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-1',
        prompt: '做前端页面',
        status: 'completed',
        startedAt: '2026-05-28T00:01:00.000Z',
        finishedAt: '2026-05-28T00:02:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: { 'conv-1': runs },
    });

    await screen.findByText('Task Plan');
    expect(screen.getByText('Frontend')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View Run' })).toBeTruthy();
    expect(screen.getAllByText('frontend-agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: '查看产物' }).length).toBeGreaterThan(0);
  });

  it('keeps restored ordering stable as message, plan, then runs when timestamps match', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    const timestamp = '2026-05-28T00:00:00.000Z';

    renderChatArea({
      agents,
      messagesByConversation: {
        'conv-1': [
          {
            id: 'msg-user',
            conversation_id: 'conv-1',
            sender_type: 'user',
            sender_id: null,
            content: '做一个博客系统',
            message_type: 'command',
            mentions: [{ type: 'orchestrator', targetId: null, raw: '@orchestrator' }],
            metadata_json: null,
            created_at: timestamp,
          },
        ],
      },
      plansByConversation: {
        'conv-1': [
          {
            id: 'plan-1',
            conversationId: 'conv-1',
            prompt: '做一个博客系统',
            summary: '拆成一个任务',
            createdAt: timestamp,
            items: [
              {
                index: 1,
                title: '前端页面',
                description: '实现前端页面',
                assignedAgentId: 'agent-front',
                assignedAgentName: 'frontend-agent',
                taskId: 'task-1',
                assignmentId: 'assignment-1',
                runId: 'run-b',
                status: 'running',
              },
            ],
          },
        ],
      },
      timeline: {
        'conv-1': [
          {
            id: 'run-a',
            conversationId: 'conv-1',
            runId: 'run-a',
            taskId: 'task-1',
            assignmentId: 'assignment-1',
            agentId: 'agent-front',
            agentName: 'frontend-agent',
            agentSessionId: 'session-old',
            prompt: '旧执行',
            status: 'completed',
            startedAt: timestamp,
            finishedAt: '2026-05-28T00:01:00.000Z',
            blocks: [],
            error: null,
          },
          {
            id: 'run-b',
            conversationId: 'conv-1',
            runId: 'run-b',
            taskId: 'task-1',
            assignmentId: 'assignment-1',
            agentId: 'agent-front',
            agentName: 'frontend-agent',
            agentSessionId: 'session-new',
            prompt: '最新执行',
            status: 'running',
            startedAt: timestamp,
            finishedAt: null,
            blocks: [],
            error: null,
          },
        ],
      },
      activeRunIdsByConversation: { 'conv-1': ['run-b'] },
    });

    await screen.findByText('Task Plan');

    const userMessageNode = screen.getByText('做一个博客系统');
    const planNode = screen.getByText('Task Plan');
    const oldRunNode = document.getElementById('run-card-run-a');
    const latestRunNode = document.getElementById('run-card-run-b');

    expect(oldRunNode).toBeTruthy();
    expect(latestRunNode).toBeTruthy();

    const order = [userMessageNode, planNode, oldRunNode!, latestRunNode!].map((node) =>
      Number(node.compareDocumentPosition(node)),
    );
    expect(order).toHaveLength(4);
    expect(
      userMessageNode.compareDocumentPosition(planNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      planNode.compareDocumentPosition(oldRunNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      oldRunNode!.compareDocumentPosition(latestRunNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps PlanCard stable while DiffCard opens for the selected orchestrated run', async () => {
    mockedGetRunFileChanges.mockResolvedValue([
      {
        filePath: 'src/login.tsx',
        changeType: 'edit',
        oldContent: 'old\n',
        newContent: 'new\n',
        confidence: 'best_effort',
        source: 'filesystem',
      },
    ]);

    const agents = [makeAgent('agent-front', 'frontend-agent')];
    const plan = {
      id: 'plan-diff',
      conversationId: 'conv-1',
      prompt: '做登录页',
      summary: '单任务执行',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '登录页',
          description: '实现登录页',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-diff',
          assignmentId: 'assignment-diff',
          runId: 'run-diff',
          status: 'completed' as const,
        },
      ],
    };
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-diff',
        conversationId: 'conv-1',
        runId: 'run-diff',
        taskId: null,
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-1',
        prompt: '实现登录页',
        status: 'completed',
        startedAt: '2026-05-28T00:01:00.000Z',
        finishedAt: '2026-05-28T00:02:00.000Z',
        blocks: [],
        error: null,
      },
      {
        id: 'run-other',
        conversationId: 'conv-1',
        runId: 'run-other',
        taskId: null,
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-2',
        prompt: '其他任务',
        status: 'completed',
        startedAt: '2026-05-28T00:03:00.000Z',
        finishedAt: '2026-05-28T00:04:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: { 'conv-1': runs },
    });

    fireEvent.click((await screen.findAllByRole('button', { name: '查看产物' }))[0]!);

    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-diff'));
    expect(mockedGetRunFileChanges).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('单任务执行').length).toBeGreaterThan(0);
    expect(screen.getByText('src/login.tsx')).toBeTruthy();
  });

  it('keeps preview state scoped to the selected run and clears iframe after stop', async () => {
    mockedStartRunPreview.mockResolvedValue({
      url: 'http://127.0.0.1:3100',
      port: 3100,
    });
    mockedGetRunFileChanges.mockResolvedValue([
      {
        filePath: 'src/page.tsx',
        changeType: 'create',
        oldContent: '',
        newContent: 'export default function Page() {}\n',
        confidence: 'exact',
        source: 'tool_event',
      },
    ]);

    const agents = [makeAgent('agent-front', 'frontend-agent')];
    const plan = {
      id: 'plan-preview',
      conversationId: 'conv-1',
      prompt: '做一个页面',
      summary: '预览验收',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '页面任务',
          description: '实现页面',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-preview-a',
          assignmentId: 'assignment-preview-a',
          runId: 'run-preview-a',
          status: 'completed' as const,
        },
      ],
    };
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-preview-a',
        conversationId: 'conv-1',
        runId: 'run-preview-a',
        taskId: null,
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-1',
        prompt: '实现页面',
        status: 'completed',
        startedAt: '2026-05-28T00:01:00.000Z',
        finishedAt: '2026-05-28T00:02:00.000Z',
        blocks: [],
        error: null,
      },
      {
        id: 'run-preview-b',
        conversationId: 'conv-1',
        runId: 'run-preview-b',
        taskId: null,
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-2',
        prompt: '实现另一个页面',
        status: 'completed',
        startedAt: '2026-05-28T00:03:00.000Z',
        finishedAt: '2026-05-28T00:04:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatArea({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: { 'conv-1': runs },
    });

    fireEvent.click((await screen.findAllByRole('button', { name: '查看产物' }))[0]!);
    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-preview-a'));
    expect(screen.getByText('src/page.tsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '网页预览' }));
    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => expect(mockedStartRunPreview).toHaveBeenCalledWith('run-preview-a'));
    expect(screen.getByTitle('Run preview')).toBeTruthy();
    expect(screen.getAllByText('预览验收').length).toBeGreaterThan(0);
  });

  it('shows conversation tasks and opens task detail from a plan item', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    mockedGetConversationTasks.mockResolvedValue([
      {
        id: 'task-1',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '前端页面',
        description: '做前端页面',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
    ]);
    mockedGetConversationAssignments.mockResolvedValue([
      {
        id: 'assignment-1',
        task_id: 'task-1',
        conversation_id: 'conv-1',
        agent_id: 'agent-front',
        status: 'completed',
        latest_run_id: 'run-1',
        assigned_at: '2026-05-28T00:00:00.000Z',
        started_at: '2026-05-28T00:01:00.000Z',
        completed_at: '2026-05-28T00:02:00.000Z',
      },
    ] as never);
    mockedGetTaskDetail.mockResolvedValue({
      task: {
        id: 'task-1',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '前端页面',
        description: '做前端页面',
        task_type: 'frontend',
        expected_output: 'Build the frontend page.',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
      assignments: [
        {
          id: 'assignment-1',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          agent_id: 'agent-front',
          status: 'completed',
          latest_run_id: 'run-1',
          assigned_at: '2026-05-28T00:00:00.000Z',
          started_at: '2026-05-28T00:01:00.000Z',
          completed_at: '2026-05-28T00:02:00.000Z',
        },
      ],
      latestRun: {
        id: 'run-1',
        conversation_id: 'conv-1',
        task_id: 'task-1',
        assignment_id: 'assignment-1',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'plan-msg-1',
        workspace_id: 'ws-1',
        prompt: '做前端页面',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'completed',
        pid: null,
        exit_code: 0,
        error_message: null,
        started_at: '2026-05-28T00:01:00.000Z',
        finished_at: '2026-05-28T00:02:00.000Z',
        event_count: 0,
      },
    } as never);

    const plan = {
      id: 'plan-1',
      conversationId: 'conv-1',
      prompt: '做一个博客系统',
      summary: '拆成一个任务',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '前端页面',
          description: '做前端页面',
          taskType: 'frontend' as const,
          expectedOutput: 'Build the frontend page.',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          runId: 'run-1',
          status: 'completed' as const,
        },
      ],
    };
    const runs: ChatTimelineItem[] = [
      {
        id: 'run-1',
        conversationId: 'conv-1',
        runId: 'run-1',
        taskId: 'task-1',
        assignmentId: 'assignment-1',
        agentId: 'agent-front',
        agentName: 'frontend-agent',
        agentSessionId: 'session-1',
        prompt: '做前端页面',
        status: 'completed',
        startedAt: '2026-05-28T00:01:00.000Z',
        finishedAt: '2026-05-28T00:02:00.000Z',
        blocks: [],
        error: null,
      },
    ];

    renderChatAreaStateful({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: { 'conv-1': runs },
    });

    fireEvent.click(screen.getByRole('button', { name: '成果' }));
    await waitFor(() => expect(screen.getByText('成果面板')).toBeTruthy());
    expect(screen.getAllByText('前端页面').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'View Task' }));
    await waitFor(() => expect(mockedGetTaskDetail).toHaveBeenCalledWith('task-1'));
    expect(screen.getAllByText('前端页面').length).toBeGreaterThan(0);
    expect(screen.getByText('最新 Run')).toBeTruthy();
    expect(screen.getByText('任务类型')).toBeTruthy();
    expect(screen.getByText('frontend')).toBeTruthy();
    expect(screen.getByText('预期输出')).toBeTruthy();
    expect(screen.getByText('Build the frontend page.')).toBeTruthy();
    expect(screen.getAllByText('run-1').length).toBeGreaterThan(0);
  });

  it('cancels a task and updates the plan item status', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    mockedGetConversationTasks.mockResolvedValue([
      {
        id: 'task-cancel',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '可取消任务',
        description: '做前端页面',
        status: 'failed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
    ]);
    mockedGetConversationAssignments.mockResolvedValue([
      {
        id: 'assignment-cancel',
        task_id: 'task-cancel',
        conversation_id: 'conv-1',
        agent_id: 'agent-front',
        status: 'failed',
        latest_run_id: 'run-cancel',
        assigned_at: '2026-05-28T00:00:00.000Z',
        started_at: '2026-05-28T00:01:00.000Z',
        completed_at: '2026-05-28T00:02:00.000Z',
      },
    ] as never);
    mockedGetTaskDetail.mockResolvedValue({
      task: {
        id: 'task-cancel',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '可取消任务',
        description: '做前端页面',
        status: 'failed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
      assignments: [
        {
          id: 'assignment-cancel',
          task_id: 'task-cancel',
          conversation_id: 'conv-1',
          agent_id: 'agent-front',
          status: 'failed',
          latest_run_id: 'run-cancel',
          assigned_at: '2026-05-28T00:00:00.000Z',
          started_at: '2026-05-28T00:01:00.000Z',
          completed_at: '2026-05-28T00:02:00.000Z',
        },
      ],
      latestRun: {
        id: 'run-cancel',
        conversation_id: 'conv-1',
        task_id: 'task-cancel',
        assignment_id: 'assignment-cancel',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'plan-msg-1',
        workspace_id: 'ws-1',
        prompt: '做前端页面',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'failed',
        pid: null,
        exit_code: 1,
        error_message: 'boom',
        started_at: '2026-05-28T00:01:00.000Z',
        finished_at: '2026-05-28T00:02:00.000Z',
        event_count: 0,
      },
    } as never);
    mockedUpdateTaskStatus.mockResolvedValue({
      id: 'task-cancel',
      conversation_id: 'conv-1',
      source_message_id: 'msg-1',
      plan_message_id: 'plan-msg-1',
      title: '可取消任务',
      description: '做前端页面',
      status: 'cancelled',
      priority: 1,
      created_at: '2026-05-28T00:00:00.000Z',
      updated_at: '2026-05-28T00:03:00.000Z',
    } as never);

    const plan = {
      id: 'plan-cancel',
      conversationId: 'conv-1',
      prompt: '做任务',
      summary: '取消测试',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '可取消任务',
          description: '做前端页面',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-cancel',
          assignmentId: 'assignment-cancel',
          runId: 'run-cancel',
          status: 'failed' as const,
        },
      ],
    };

    renderChatAreaStateful({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: {
        'conv-1': [
          {
            id: 'run-cancel',
            conversationId: 'conv-1',
            runId: 'run-cancel',
            taskId: 'task-cancel',
            assignmentId: 'assignment-cancel',
            agentId: 'agent-front',
            agentName: 'frontend-agent',
            agentSessionId: 'session-1',
            prompt: '做前端页面',
            status: 'failed',
            startedAt: '2026-05-28T00:01:00.000Z',
            finishedAt: '2026-05-28T00:02:00.000Z',
            blocks: [],
            error: 'boom',
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'View Task' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel Task' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Task' }));

    await waitFor(() => expect(mockedUpdateTaskStatus).toHaveBeenCalledWith('task-cancel', 'cancelled'));
    expect(screen.getAllByText('cancelled').length).toBeGreaterThan(0);
  });

  it('reruns a task, inserts a new run card, and updates the plan item to the latest run', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    mockedGetConversationTasks.mockResolvedValue([
      {
        id: 'task-rerun',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '可重跑任务',
        description: '重新执行页面任务',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
    ]);
    mockedGetConversationAssignments.mockResolvedValue([
      {
        id: 'assignment-rerun',
        task_id: 'task-rerun',
        conversation_id: 'conv-1',
        agent_id: 'agent-front',
        status: 'completed',
        latest_run_id: 'run-old',
        assigned_at: '2026-05-28T00:00:00.000Z',
        started_at: '2026-05-28T00:01:00.000Z',
        completed_at: '2026-05-28T00:02:00.000Z',
      },
    ] as never);
    mockedGetTaskDetail.mockResolvedValue({
      task: {
        id: 'task-rerun',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '可重跑任务',
        description: '重新执行页面任务',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
      assignments: [
        {
          id: 'assignment-rerun',
          task_id: 'task-rerun',
          conversation_id: 'conv-1',
          agent_id: 'agent-front',
          status: 'completed',
          latest_run_id: 'run-old',
          assigned_at: '2026-05-28T00:00:00.000Z',
          started_at: '2026-05-28T00:01:00.000Z',
          completed_at: '2026-05-28T00:02:00.000Z',
        },
      ],
      latestRun: {
        id: 'run-old',
        conversation_id: 'conv-1',
        task_id: 'task-rerun',
        assignment_id: 'assignment-rerun',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'plan-msg-1',
        workspace_id: 'ws-1',
        prompt: '旧任务',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'completed',
        pid: null,
        exit_code: 0,
        error_message: null,
        started_at: '2026-05-28T00:01:00.000Z',
        finished_at: '2026-05-28T00:02:00.000Z',
        event_count: 0,
      },
    } as never);
    mockedRerunTask.mockResolvedValue({
      task: {
        id: 'task-rerun',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '可重跑任务',
        description: '重新执行页面任务',
        status: 'assigned',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:03:00.000Z',
      },
      assignment: {
        id: 'assignment-rerun',
        task_id: 'task-rerun',
        conversation_id: 'conv-1',
        agent_id: 'agent-front',
        status: 'pending',
        latest_run_id: 'run-new',
        assigned_at: '2026-05-28T00:00:00.000Z',
        started_at: null,
        completed_at: null,
      },
      run: {
        id: 'run-new',
        conversation_id: 'conv-1',
        task_id: 'task-rerun',
        assignment_id: 'assignment-rerun',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: 'session-new',
        source_message_id: 'plan-msg-1',
        workspace_id: 'ws-1',
        prompt: '重新执行页面任务',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'queued',
        pid: null,
        exit_code: null,
        error_message: null,
        started_at: '2026-05-28T00:03:00.000Z',
        finished_at: null,
        events: [],
      },
    } as never);

    const plan = {
      id: 'plan-rerun',
      conversationId: 'conv-1',
      prompt: '做任务',
      summary: '重跑测试',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '可重跑任务',
          description: '重新执行页面任务',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-rerun',
          assignmentId: 'assignment-rerun',
          runId: 'run-old',
          status: 'completed' as const,
        },
      ],
    };

    renderChatAreaStateful({
      agents,
      plansByConversation: { 'conv-1': [plan] },
      timeline: {
        'conv-1': [
          {
            id: 'run-old',
            conversationId: 'conv-1',
            runId: 'run-old',
            taskId: 'task-rerun',
            assignmentId: 'assignment-rerun',
            agentId: 'agent-front',
            agentName: 'frontend-agent',
            agentSessionId: 'session-old',
            prompt: '旧任务',
            status: 'completed',
            startedAt: '2026-05-28T00:01:00.000Z',
            finishedAt: '2026-05-28T00:02:00.000Z',
            blocks: [],
            error: null,
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'View Task' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rerun Task' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Rerun Task' }));

    await waitFor(() => expect(mockedRerunTask).toHaveBeenCalledWith('task-rerun'));
    expect(screen.getAllByText('重新执行页面任务').length).toBeGreaterThan(0);
    expect(screen.getAllByText('queued').length).toBeGreaterThan(0);
  });

  it('clears task selection UI when switching conversations', async () => {
    const agents = [makeAgent('agent-front', 'frontend-agent')];
    mockedGetConversationTasks.mockResolvedValue([
      {
        id: 'task-1',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '前端页面',
        description: '做前端页面',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
    ]);
    mockedGetConversationAssignments.mockResolvedValue([
      {
        id: 'assignment-1',
        task_id: 'task-1',
        conversation_id: 'conv-1',
        agent_id: 'agent-front',
        status: 'completed',
        latest_run_id: 'run-1',
        assigned_at: '2026-05-28T00:00:00.000Z',
        started_at: '2026-05-28T00:01:00.000Z',
        completed_at: '2026-05-28T00:02:00.000Z',
      },
    ] as never);
    mockedGetTaskDetail.mockResolvedValue({
      task: {
        id: 'task-1',
        conversation_id: 'conv-1',
        source_message_id: 'msg-1',
        plan_message_id: 'plan-msg-1',
        title: '前端页面',
        description: '做前端页面',
        status: 'completed',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:00:00.000Z',
      },
      assignments: [
        {
          id: 'assignment-1',
          task_id: 'task-1',
          conversation_id: 'conv-1',
          agent_id: 'agent-front',
          status: 'completed',
          latest_run_id: 'run-1',
          assigned_at: '2026-05-28T00:00:00.000Z',
          started_at: '2026-05-28T00:01:00.000Z',
          completed_at: '2026-05-28T00:02:00.000Z',
        },
      ],
      latestRun: {
        id: 'run-1',
        conversation_id: 'conv-1',
        task_id: 'task-1',
        assignment_id: 'assignment-1',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'plan-msg-1',
        workspace_id: 'ws-1',
        prompt: '做前端页面',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'completed',
        pid: null,
        exit_code: 0,
        error_message: null,
        started_at: '2026-05-28T00:01:00.000Z',
        finished_at: '2026-05-28T00:02:00.000Z',
        event_count: 0,
      },
    } as never);

    const plansByConversation = {
      'conv-1': [
        {
          id: 'plan-1',
          conversationId: 'conv-1',
          prompt: '做一个博客系统',
          summary: '拆成一个任务',
          createdAt: '2026-05-28T00:00:00.000Z',
          items: [
            {
              index: 1,
              title: '前端页面',
              description: '做前端页面',
              assignedAgentId: 'agent-front',
              assignedAgentName: 'frontend-agent',
              taskId: 'task-1',
              assignmentId: 'assignment-1',
              runId: 'run-1',
              status: 'completed' as const,
            },
          ],
        },
      ],
      'conv-2': [],
    };

    const timeline = {
      'conv-1': [
        {
          id: 'run-1',
          conversationId: 'conv-1',
          runId: 'run-1',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          agentId: 'agent-front',
          agentName: 'frontend-agent',
          agentSessionId: 'session-1',
          prompt: '做前端页面',
          status: 'completed' as const,
          startedAt: '2026-05-28T00:01:00.000Z',
          finishedAt: '2026-05-28T00:02:00.000Z',
          blocks: [],
          error: null,
        },
      ],
      'conv-2': [],
    };

    const { rerender } = render(
      <AppContext.Provider
        value={{
          state: {
            conversations: [],
            selectedConvId: 'conv-1',
            agents,
            workspaces: { 'conv-1': makeWorkspace(), 'conv-2': makeWorkspace() },
            messagesByConversation: {},
            timeline,
            plansByConversation,
            activeRunIdsByConversation: {},
            connected: true,
            loadingConvs: false,
            loadingAgents: false,
            loadingTimeline: false,
            error: null,
          },
          dispatch: vi.fn<Dispatch<Action>>(),
        }}
      >
        <ChatArea />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '成果' }));
    await waitFor(() => expect(screen.getByText('成果面板')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'View Task' }));
    await waitFor(() => expect(screen.getByText('最新 Run')).toBeTruthy());

    rerender(
      <AppContext.Provider
        value={{
          state: {
            conversations: [],
            selectedConvId: 'conv-2',
            agents,
            workspaces: { 'conv-1': makeWorkspace(), 'conv-2': makeWorkspace() },
            messagesByConversation: {},
            timeline,
            plansByConversation,
            activeRunIdsByConversation: {},
            connected: true,
            loadingConvs: false,
            loadingAgents: false,
            loadingTimeline: false,
            error: null,
          },
          dispatch: vi.fn<Dispatch<Action>>(),
        }}
      >
        <ChatArea />
      </AppContext.Provider>,
    );

    await waitFor(() => expect(screen.queryByText('最新 Run')).toBeNull());
    expect(screen.queryByText('任务')).toBeNull();
  });
});

describe('RunCard workspace mode badge', () => {
  const agents = [makeAgent('agent-default', 'claude-code')];

  function makeRunItem(runId: string, status: ChatTimelineItem['status'] = 'completed'): ChatTimelineItem {
    return {
      id: runId,
      conversationId: 'conv-1',
      runId,
      taskId: null,
      agentId: 'agent-default',
      agentName: 'claude-code',
      agentSessionId: null,
      prompt: 'test',
      status,
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: status === 'completed' ? '2026-05-28T00:01:00.000Z' : null,
      blocks: [],
      error: null,
    };
  }

  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(makeRunCardSummary({ fileChanges: [] }));
  });

  it('shows worktree badge when workspace mode is git_worktree', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_worktree',
          rootPath: '/tmp/repo/.agenthub/worktrees/run-abc123',
          branchName: 'agenthub/run-abc1',
          status: 'ready',
          errorMessage: null,
        },
        fileChanges: [],
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-abc123')] },
    });

    await screen.findByText(/worktree/);
    expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-abc123');
  });

  it('shows clone badge when workspace mode is git_clone', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/workspace/.agenthub/clones/run-def456',
          branchName: 'agenthub/run-def456',
          status: 'ready',
          errorMessage: null,
        },
        fileChanges: [],
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-def456')] },
    });

    await screen.findByText('clone');
  });

  it('shows legacy badge when workspace mode is legacy', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'legacy',
          rootPath: null,
          branchName: null,
          status: 'ready',
          errorMessage: null,
        },
        fileChanges: [],
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-legacy')] },
    });

    await screen.findByText('legacy');
  });

  it('does not crash when getRunWorkspace fails', async () => {
    mockedGetRunCardSummary.mockRejectedValue(new Error('network error'));

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-error')] },
    });

    await waitFor(() => {
      expect(screen.getByText('run-erro')).toBeTruthy();
    });
    expect(screen.queryByText('worktree')).toBeNull();
    expect(screen.queryByText('clone')).toBeNull();
  });

  it('loads run metadata for each run independently', async () => {
    mockedGetRunCardSummary.mockImplementation(async (runId) =>
      makeRunCardSummary({
        workspace: {
          mode: runId === 'run-1' ? 'git_worktree' : 'git_clone',
          rootPath: `/tmp/.agenthub/${runId}`,
          branchName: `agenthub/${runId}`,
          status: 'ready',
          errorMessage: null,
        },
        fileChanges: [],
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-1'), makeRunItem('run-2')] },
    });

    await waitFor(() => {
      expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-1');
      expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-2');
    });
  });
});

describe('RunCard apply changes UI', () => {
  const agents = [makeAgent('agent-default', 'claude-code')];

  function makeRunItem(runId: string, status: ChatTimelineItem['status'] = 'completed'): ChatTimelineItem {
    return {
      id: runId,
      conversationId: 'conv-1',
      runId,
      taskId: null,
      agentId: 'agent-default',
      agentName: 'claude-code',
      agentSessionId: null,
      prompt: 'test',
      status,
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: status === 'completed' ? '2026-05-28T00:01:00.000Z' : null,
      blocks: [],
      error: null,
    };
  }

  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-1',
          branchName: null,
          status: 'ready',
          errorMessage: null,
        },
      }),
    );
    vi.mocked(api.getRunChangeApplication).mockReset();
    vi.mocked(api.getRunChangeApplication).mockResolvedValue(null);
    vi.mocked(api.checkRunApply).mockReset();
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: '',
      canApply: true,
      files: [],
      summary: { safe: 0, conflict: 0, skipped: 0 },
    });
    vi.mocked(api.applyRunChanges).mockReset();
    vi.mocked(api.requestApplyChanges).mockReset();
    vi.mocked(api.getConversationApprovals).mockReset();
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.approveApproval).mockReset();
    vi.mocked(api.rejectApproval).mockReset();
    vi.mocked(api.startRunPreview).mockReset();
    mockedStopRunPreview.mockReset();
  });

  it('shows Apply Changes button for completed run with ready workspace', async () => {
    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-1')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });
  });

  it('does not show Apply Changes for cleaned workspace', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-2',
          branchName: null,
          status: 'cleaned',
          errorMessage: null,
        },
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-2')] },
    });

    await waitFor(() => {
      expect(screen.getByText('临时工作区已清理，Diff 和 Preview 已收起')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('clicking Apply Changes calls requestApplyChanges and shows ApprovalCard', async () => {
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-1',
      conversationId: 'conv-1',
      runId: 'run-3',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'pending',
      title: 'Apply Changes',
      description: '1 file(s) ready to apply.',
      payload: { runId: 'run-3' },
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-3')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-3');
      expect(screen.getByText('Needs confirmation')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
  });

  it('shows Applied badge after approve + execute', async () => {
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-2',
      conversationId: 'conv-1',
      runId: 'run-4',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'pending',
      title: 'Apply Changes',
      description: '2 file(s) ready to apply.',
      payload: { runId: 'run-4' },
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });
    vi.mocked(api.approveApproval).mockResolvedValue({
      id: 'approval-2',
      conversationId: 'conv-1',
      runId: 'run-4',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'executed',
      title: 'Apply Changes',
      description: '2 file(s) ready to apply.',
      payload: { runId: 'run-4' },
      result: { status: 'applied' },
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: '2026-05-28T00:00:01.000Z',
      executedAt: '2026-05-28T00:00:02.000Z',
    });
    vi.mocked(api.getRunChangeApplication).mockResolvedValue({
        id: 'ca-2',
        runId: 'run-4',
        conversationId: 'conv-1',
        runWorkspaceId: 'rws-2',
        status: 'applied',
        appliedFiles: ['src/index.ts', 'src/utils.ts'],
        skippedFiles: [{ filePath: 'src/old.ts', reason: 'Delete not supported' }],
        errorMessage: null,
        appliedAt: '2026-05-28T00:00:00.000Z',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-4')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    // Approval card should appear
    await waitFor(() => {
      expect(screen.getByText('Needs confirmation')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeTruthy();
      expect(screen.getAllByText(/2 files/).length).toBeGreaterThan(0);
      expect(screen.getByText(/1 skipped/)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('does not show Apply Changes when already applied', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        changeApplication: {
          id: 'ca-3',
          runId: 'run-5',
          conversationId: 'conv-1',
          runWorkspaceId: 'rws-3',
          status: 'applied',
          appliedFiles: ['src/main.ts'],
          skippedFiles: [],
          errorMessage: null,
          appliedAt: '2026-05-28T00:00:00.000Z',
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-5')] },
    });

    await screen.findByText('Applied');
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('shows No changes badge when application status is skipped', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        fileChanges: [],
        changeApplication: {
          id: 'ca-4',
          runId: 'run-6',
          conversationId: 'conv-1',
          runWorkspaceId: 'rws-4',
          status: 'skipped',
          appliedFiles: [],
          skippedFiles: [{ filePath: '-', reason: 'No file changes to apply' }],
          errorMessage: null,
          appliedAt: null,
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-6')] },
    });

    await screen.findByText('No changes');
  });

  it('shows error when apply fails with a message', async () => {
    vi.mocked(api.requestApplyChanges).mockRejectedValue(new Error('Run workspace has been cleaned'));

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-7')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText('Run workspace has been cleaned')).toBeTruthy();
    });
  });

  it('does not show Apply Changes for non-completed runs', async () => {
    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-8', 'running')] },
    });

    await waitFor(() => {
      expect(screen.getByText('run-8')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('allows multiple completed runs to have independent Apply buttons', async () => {
    const runs: ChatTimelineItem[] = [
      makeRunItem('run-a'),
      makeRunItem('run-b'),
    ];

    renderChatArea({
      agents,
      timeline: { 'conv-1': runs },
    });

    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: 'Apply Changes' });
      expect(buttons).toHaveLength(2);
    });
  });
});

describe('RunCard apply conflict guard', () => {
  const agents = [makeAgent('agent-default', 'claude-code')];

  function makeRunItem(runId: string): ChatTimelineItem {
    return {
      id: runId,
      conversationId: 'conv-1',
      runId,
      taskId: null,
      agentId: 'agent-default',
      agentName: 'claude-code',
      agentSessionId: null,
      prompt: 'test',
      status: 'completed',
      startedAt: '2026-05-28T00:00:00.000Z',
      finishedAt: '2026-05-28T00:01:00.000Z',
      blocks: [],
      error: null,
    };
  }

  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-1',
          branchName: null,
          status: 'ready',
          errorMessage: null,
        },
      }),
    );
    vi.mocked(api.getRunChangeApplication).mockReset();
    vi.mocked(api.getRunChangeApplication).mockResolvedValue(null);
    vi.mocked(api.checkRunApply).mockReset();
    vi.mocked(api.applyRunChanges).mockReset();
    vi.mocked(api.requestApplyChanges).mockReset();
    vi.mocked(api.getConversationApprovals).mockReset();
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.approveApproval).mockReset();
    vi.mocked(api.startRunPreview).mockReset();
    mockedStopRunPreview.mockReset();
  });

  it('calls checkRunApply before requestApplyChanges', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-1',
      canApply: true,
      files: [{ filePath: 'src/a.ts', changeType: 'create', status: 'safe' }],
      summary: { safe: 1, conflict: 0, skipped: 0 },
    });
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-cg-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'pending',
      title: 'Apply Changes',
      description: null,
      payload: { runId: 'run-1' },
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-1')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-1');
    });
    expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-1');
  });

  it('does not call applyRunChanges when checkRunApply returns conflicts', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-2',
      canApply: false,
      files: [
        { filePath: 'src/a.ts', changeType: 'create', status: 'conflict', reason: 'Target already exists' },
        { filePath: 'src/b.ts', changeType: 'edit', status: 'safe' },
        { filePath: 'src/c.ts', changeType: 'delete', status: 'skipped', reason: 'Delete not supported' },
      ],
      summary: { safe: 1, conflict: 1, skipped: 1 },
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-2')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/Apply disabled due to conflicts/)).toBeTruthy();
    });
    expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-2');
    expect(vi.mocked(api.applyRunChanges)).not.toHaveBeenCalled();
  });

  it('shows conflict file list with reasons', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-3',
      canApply: false,
      files: [
        { filePath: 'src/conflict.ts', changeType: 'edit', status: 'conflict', reason: 'Base file changed since run' },
      ],
      summary: { safe: 0, conflict: 1, skipped: 0 },
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-3')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/Base file changed since run/)).toBeTruthy();
      expect(screen.getByText(/0 safe/)).toBeTruthy();
      expect(screen.getByText(/1 conflict/)).toBeTruthy();
    });
  });

  it('shows skipped files in conflict summary', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-4',
      canApply: false,
      files: [
        { filePath: 'src/safe.ts', changeType: 'create', status: 'safe' },
        { filePath: 'src/old.ts', changeType: 'delete', status: 'skipped', reason: 'Delete not supported' },
        { filePath: 'src/conflict.ts', changeType: 'edit', status: 'conflict', reason: 'Base file changed since run' },
      ],
      summary: { safe: 1, conflict: 1, skipped: 1 },
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-4')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/1 skipped/)).toBeTruthy();
      expect(screen.getByText(/Delete not supported/)).toBeTruthy();
    });
  });

  it('displays Applied badge after conflict-free approve + execute', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-5',
      canApply: true,
      files: [
        { filePath: 'src/x.ts', changeType: 'create', status: 'safe' },
        { filePath: 'src/y.ts', changeType: 'edit', status: 'safe' },
      ],
      summary: { safe: 2, conflict: 0, skipped: 0 },
    });
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-cg-5',
      conversationId: 'conv-1',
      runId: 'run-5',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'pending',
      title: 'Apply Changes',
      description: null,
      payload: { runId: 'run-5' },
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });
    vi.mocked(api.approveApproval).mockResolvedValue({
      id: 'approval-cg-5',
      conversationId: 'conv-1',
      runId: 'run-5',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'executed',
      title: 'Apply Changes',
      description: null,
      payload: { runId: 'run-5' },
      result: { status: 'applied' },
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: '2026-05-28T00:00:01.000Z',
      executedAt: '2026-05-28T00:00:02.000Z',
    });
    vi.mocked(api.getRunChangeApplication).mockResolvedValue({
      id: 'ca-5',
      runId: 'run-5',
      conversationId: 'conv-1',
      runWorkspaceId: 'rws-5',
      status: 'applied',
      appliedFiles: ['src/x.ts', 'src/y.ts'],
      skippedFiles: [],
      errorMessage: null,
      appliedAt: '2026-05-28T00:00:00.000Z',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-5')] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    // Approval card should appear
    await waitFor(() => {
      expect(screen.getByText('Needs confirmation')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeTruthy();
      expect(screen.getAllByText(/2 files/).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('cleaned workspace still does not show Apply Changes', async () => {
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-6',
          branchName: null,
          status: 'cleaned',
          errorMessage: null,
        },
      }),
    );

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-6')] },
    });

    await waitFor(() => {
      expect(screen.getByText('临时工作区已清理，Diff 和 Preview 已收起')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('each RunCard has independent apply check state', async () => {
    vi.mocked(api.checkRunApply).mockImplementation(async (runId) => {
      if (runId === 'run-a') {
        return {
          runId: 'run-a',
          canApply: true,
          files: [{ filePath: 'a.ts', changeType: 'create', status: 'safe' }],
          summary: { safe: 1, conflict: 0, skipped: 0 },
        };
      }
      return {
        runId: 'run-b',
        canApply: false,
        files: [{ filePath: 'b.ts', changeType: 'edit', status: 'conflict', reason: 'Base file changed since run' }],
        summary: { safe: 0, conflict: 1, skipped: 0 },
      };
    });

    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-multi',
      conversationId: 'conv-1',
      runId: 'run-a',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_changes',
      status: 'pending',
      title: 'Apply Changes',
      description: null,
      payload: { runId: 'run-a' },
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });

    const runs: ChatTimelineItem[] = [makeRunItem('run-a'), makeRunItem('run-b')];

    renderChatArea({
      agents,
      timeline: { 'conv-1': runs },
    });

    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: 'Apply Changes' });
      expect(buttons).toHaveLength(2);
    });

    // Click Apply for run-b (has conflicts)
    const buttons = screen.getAllByRole('button', { name: 'Apply Changes' });
    fireEvent.click(buttons[1]!);

    await waitFor(() => {
      expect(screen.getByText(/Apply disabled due to conflicts/)).toBeTruthy();
    });

    // Both run cards still show Apply Changes (run-b button stays visible during conflict)
    expect(screen.getAllByRole('button', { name: 'Apply Changes' })).toHaveLength(2);
  });
});

describe('Acceptance — WorkspaceSetup & empty state', () => {
  const agents = [makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true })];

  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(makeRunCardSummary());
    vi.mocked(api.getConversationApprovals).mockReset();
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.checkRuntime).mockReset();
    vi.mocked(api.checkRuntime).mockResolvedValue({ adapterType: 'claude_cli', available: true });
  });

  it('shows WorkspaceSetup with title and placeholder when no conversation is selected', () => {
    renderChatArea({ agents, selectedConvId: null });
    expect(screen.getByText('开始协作')).toBeTruthy();
    expect(screen.getByPlaceholderText('/Users/me/myproject')).toBeTruthy();
    expect(screen.getByText(/Web 版本需手动粘贴绝对路径/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建协作会话' })).toBeTruthy();
  });

  it('shows Chinese guidance and demo prompts when conversation has no content', () => {
    renderChatArea({ agents, selectedConvId: 'conv-1' });
    expect(screen.getByPlaceholderText(/default @claude-code, @orchestrator/i)).toBeTruthy();
    expect(screen.getByText('让 Orchestrator 检查项目结构')).toBeTruthy();
    expect(screen.getByText('创建一个前端任务')).toBeTruthy();
    expect(screen.getByText('为最近改动补充测试')).toBeTruthy();
  });

  it('clicking a demo prompt fills the input text', async () => {
    renderChatArea({ agents, selectedConvId: 'conv-1' });
    const promptBtn = await screen.findByText('让 Orchestrator 检查项目结构');
    fireEvent.click(promptBtn);
    const textarea = screen.getByPlaceholderText(/@orchestrator/);
    expect((textarea as HTMLTextAreaElement).value).toContain('@orchestrator');
  });

  it('auto-validates on input with debounce and shows badges + create button', async () => {
    renderChatArea({ agents, selectedConvId: null });
    const input = screen.getByPlaceholderText('/Users/me/myproject');
    fireEvent.change(input, { target: { value: '/Users/test/project' } });

    await screen.findByText('✓ git');
    expect(screen.getByText('✓ 预览')).toBeTruthy();
    expect(screen.getByText('✓ runtime')).toBeTruthy();
    const btn = screen.getByRole('button', { name: '创建协作会话' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('create button is disabled until validation passes', () => {
    renderChatArea({ agents, selectedConvId: null });
    const btn = screen.getByRole('button', { name: '创建协作会话' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('Acceptance — ConfirmationCard', () => {
  const agents = [makeAgent('agent-default', 'claude-code')];

  function makeRunItem(runId: string): ChatTimelineItem {
    return {
      id: runId, conversationId: 'conv-1', runId, taskId: null,
      agentId: 'agent-default', agentName: 'claude-code', agentSessionId: null,
      prompt: 'test', status: 'completed',
      startedAt: '2026-05-28T00:00:00.000Z', finishedAt: '2026-05-28T00:01:00.000Z',
      blocks: [], error: null,
    };
  }

  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue(
      makeRunCardSummary({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-1',
          branchName: null,
          status: 'ready',
          errorMessage: null,
        },
      }),
    );
    vi.mocked(api.getRunChangeApplication).mockReset();
    vi.mocked(api.getRunChangeApplication).mockResolvedValue(null);
    vi.mocked(api.getConversationApprovals).mockReset();
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.checkRunApply).mockReset();
    vi.mocked(api.checkRunApply).mockResolvedValue({ runId: '', canApply: true, files: [], summary: { safe: 0, conflict: 0, skipped: 0 } });
    vi.mocked(api.requestApplyChanges).mockReset();
    vi.mocked(api.approveApproval).mockReset();
    vi.mocked(api.rejectApproval).mockReset();
    vi.mocked(api.cleanupRunWorkspace).mockReset();
    mockedStartRunPreview.mockReset();
    vi.mocked(api.applyRunChanges).mockReset();
    vi.mocked(api.getRunFileChanges).mockReset();
    vi.mocked(api.getRunFileChanges).mockResolvedValue([
      {
        filePath: 'src/confirmation.ts',
        changeType: 'edit',
        oldContent: 'before',
        newContent: 'after',
        confidence: 'exact',
        source: 'tool_event',
      },
    ]);
  });

  it('shows ConfirmationCard with Confirm and Cancel buttons when apply is safe', async () => {
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-acc-1', conversationId: 'conv-1', runId: 'run-1',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'pending',
      title: 'Apply Changes', description: null, payload: null, result: null,
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z', decidedAt: null, executedAt: null,
    });

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-1')] } });
    await screen.findByRole('button', { name: 'Apply Changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await screen.findByRole('button', { name: 'Confirm' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByText('Needs confirmation')).toBeTruthy();
  });

  it('shows Executed after confirm', async () => {
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-acc-2', conversationId: 'conv-1', runId: 'run-2',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'pending',
      title: 'Apply Changes', description: null, payload: null, result: null,
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z', decidedAt: null, executedAt: null,
    });
    vi.mocked(api.approveApproval).mockResolvedValue({
      id: 'approval-acc-2', conversationId: 'conv-1', runId: 'run-2',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'executed',
      title: 'Apply Changes', description: null, payload: null, result: { status: 'applied' },
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: '2026-05-28T00:00:01.000Z', executedAt: '2026-05-28T00:00:02.000Z',
    });
    vi.mocked(api.getRunChangeApplication).mockResolvedValue({
        id: 'ca-acc', runId: 'run-2', conversationId: 'conv-1', runWorkspaceId: 'rws-1',
        status: 'applied', appliedFiles: ['a.ts'], skippedFiles: [],
        errorMessage: null, appliedAt: '2026-05-28T00:00:00.000Z',
        createdAt: '2026-05-28T00:00:00.000Z', updatedAt: '2026-05-28T00:00:00.000Z',
      });

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-2')] } });
    await screen.findByRole('button', { name: 'Apply Changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
    await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('Executed');
    expect(screen.getByText('Applied')).toBeTruthy();
  });

  it('shows Cancelled after cancel', async () => {
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-acc-3', conversationId: 'conv-1', runId: 'run-3',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'pending',
      title: 'Apply Changes', description: null, payload: null, result: null,
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z', decidedAt: null, executedAt: null,
    });
    vi.mocked(api.rejectApproval).mockResolvedValue({
      id: 'approval-acc-3', conversationId: 'conv-1', runId: 'run-3',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'rejected',
      title: 'Apply Changes', description: null, payload: null, result: null,
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: '2026-05-28T00:00:01.000Z', executedAt: null,
    });

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-3')] } });
    await screen.findByRole('button', { name: 'Apply Changes' });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
    await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await screen.findByText('Cancelled');
  });
});
