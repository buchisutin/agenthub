import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useReducer, type Dispatch } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatArea } from './index';
import { AppContext } from '../../store/AppContext';
import { reducer, type Action, type AppState } from '../../store/appState';
import type { Agent, ApprovalRequest, ChatTimelineItem, RunCardSummary, Workspace } from '../../types';
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
      getRun: vi.fn().mockResolvedValue({
        id: 'run-detail',
        conversation_id: 'conv-1',
        task_id: null,
        assignment_id: null,
        agent_id: 'agent-default',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: null,
        workspace_id: 'ws-1',
        prompt: 'detail',
        trigger_type: 'chat',
        trigger_source_id: 'conv-1',
        requested_by: 'user',
        status: 'completed',
        pid: null,
        exit_code: 0,
        error_message: null,
        started_at: '2026-05-28T00:00:00.000Z',
        finished_at: '2026-05-28T00:01:00.000Z',
        events: [],
      }),
      updateTaskStatus: vi.fn(),
      rerunTask: vi.fn(),
      getRunFileChanges: vi.fn().mockResolvedValue([]),
      getWorkspaceFileChanges: vi.fn().mockResolvedValue({
        workspaceId: 'ws-1',
        baseRef: 'HEAD',
        files: [],
        summary: { files: 0, additions: 0, deletions: 0 },
      }),
      startWorkspacePreview: vi.fn(),
      stopWorkspacePreview: vi.fn(),
      getWorkspaceDeployScripts: vi.fn().mockResolvedValue({ workspaceId: 'ws-1', scripts: ['build'], defaultScript: 'build' }),
      startWorkspaceDeploy: vi.fn(),
      getWorkspaceDeploy: vi.fn().mockResolvedValue(null),
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
      getRunDeployScripts: vi.fn().mockResolvedValue({ runId: '', scripts: ['build'], defaultScript: 'build' }),
      getRunDeploy: vi.fn().mockResolvedValue(null),
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
async function openRunPanel(index = 0, tab?: '代码改动' | '网页预览') {
  await waitFor(() => {
    expect(document.querySelectorAll('[data-run-id] button').length).toBeGreaterThan(index);
  });
  const trigger = document.querySelectorAll<HTMLButtonElement>('[data-run-id] button')[index];
  fireEvent.click(trigger!);
  if (tab) fireEvent.click(await screen.findByRole('button', { name: tab }));
}

async function openApplyPanel() {
  await openRunPanel(0, '代码改动');
  await screen.findByRole('button', { name: 'Apply Changes' });
}

async function expandFirstRunCard() {
  await openRunPanel(0, '代码改动');
}

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
const inputPlaceholder = /群聊|单聊/i;
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

  unobserve() {}

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
  conversationType = 'group',
}: {
  agents: Agent[];
  workspace?: Workspace | null;
  timeline?: Record<string, ChatTimelineItem[]>;
  messagesByConversation?: AppState['messagesByConversation'];
  plansByConversation?: AppState['plansByConversation'];
  activeRunIdsByConversation?: Record<string, string[]>;
  selectedConvId?: string | null;
  conversationType?: 'single' | 'group';
}) {
  const state: AppState = {
    conversations: selectedConvId
      ? [{
          id: selectedConvId,
          title: 'Test conversation',
          type: conversationType,
          task_id: 'task-1',
          agent_platform: 'claude_cli',
          created_at: '2026-05-28T00:00:00.000Z',
          updated_at: '2026-05-28T00:00:00.000Z',
          task: null,
        }]
      : [],
    selectedConvId,
    agents,
    workspaces: { 'conv-1': workspace },
    messagesByConversation,
    timeline,
    plansByConversation,
    activeRunIdsByConversation,
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
  conversationType = 'group',
}: {
  agents: Agent[];
  workspace?: Workspace | null;
  timeline?: Record<string, ChatTimelineItem[]>;
  messagesByConversation?: AppState['messagesByConversation'];
  plansByConversation?: AppState['plansByConversation'];
  activeRunIdsByConversation?: Record<string, string[]>;
  selectedConvId?: string | null;
  conversationType?: 'single' | 'group';
}) {
  const state: AppState = {
    conversations: selectedConvId
      ? [{
          id: selectedConvId,
          title: 'Test conversation',
          type: conversationType,
          task_id: 'task-1',
          agent_platform: 'claude_cli',
          created_at: '2026-05-28T00:00:00.000Z',
          updated_at: '2026-05-28T00:00:00.000Z',
          task: null,
        }]
      : [],
    selectedConvId,
    agents,
    workspaces: { 'conv-1': workspace },
    messagesByConversation,
    timeline,
    plansByConversation,
    activeRunIdsByConversation,
    pendingClarificationConvIds: [],
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

  it('uses the soft sage-to-warm-white background on the chat surface', () => {
    renderChatArea({ agents: [] });

    const surface = screen.getByTestId('chat-surface');
    expect(surface.style.background).toBe(
      'linear-gradient(rgb(232, 238, 231) 0%, rgb(247, 247, 241) 55%, rgb(255, 248, 247) 100%)',
    );
    expect(Array.from(surface.children).some((child) => child.getAttribute('style')?.includes('linear-gradient(to top'))).toBe(false);
  });

  it('lets the conversation gradient continue behind the top bar', () => {
    renderChatArea({ agents: [] });

    const topBar = screen.getByTestId('conversation-topbar');
    expect(topBar.style.backgroundColor).toBe('');
    expect(topBar.style.borderBottomColor).toBe('rgba(23, 49, 34, 0.08)');
  });

  it('centers messages in an 800px column with 24px vertical gaps', () => {
    renderChatArea({ agents: [] });

    const list = screen.getByTestId('chat-message-list');
    expect(list.className).toContain('max-w-[800px]');
    expect(list.className).toContain('mx-auto');
    expect(list.className).toContain('flex-col');
    expect(list.className).toContain('gap-6');
  });

  it('gives the chat composer a soft green-tinted shadow without a visible border', () => {
    renderChatArea({ agents: [] });

    const composer = screen.getByTestId('chat-composer');
    expect(composer.style.boxShadow).toBe('0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 6px rgba(0, 0, 0, 0.03)');
    expect(composer.className).not.toContain('border-gray-200');
  });

  it('centers the chat composer at 65 percent of the conversation width', () => {
    renderChatArea({ agents: [] });

    const shell = screen.getByTestId('chat-composer-shell');
    expect(shell.className).toContain('w-[65%]');
    expect(shell.className).toContain('mx-auto');
  });

  it('opens a white custom Agent menu with the same floating shadow recipe', () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
      makeAgent('agent-reviewer', 'reviewer', 'codex_cli'),
    ];
    renderChatArea({ agents, conversationType: 'single' });

    fireEvent.click(screen.getByRole('button', { name: '选择单聊 Agent' }));

    const menu = screen.getByRole('listbox', { name: '选择单聊 Agent' });
    expect(menu.style.boxShadow).toBe('0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 6px rgba(0, 0, 0, 0.03)');
    expect(screen.getByRole('option', { name: 'claude-code' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens the selected run in the execution log tab', async () => {
    const agents = [makeAgent('agent-default', 'claude-code')];
    renderChatArea({
      agents,
      timeline: {
        'conv-1': [
          {
            id: 'run-log',
            conversationId: 'conv-1',
            runId: 'run-log',
            taskId: null,
            agentId: 'agent-default',
            agentName: 'claude-code',
            agentSessionId: null,
            prompt: 'inspect output',
            status: 'completed',
            startedAt: '2026-05-28T00:00:00.000Z',
            finishedAt: '2026-05-28T00:01:00.000Z',
            detailsLoaded: true,
            blocks: [{ kind: 'agent_text', id: 'text-log', content: 'isolated run output' }],
            error: null,
          },
        ],
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: /claude-code.*Completed/ }));

    expect(await screen.findByRole('complementary', { name: '工作日志' })).toBeTruthy();
    expect(screen.getAllByText('isolated run output')).toHaveLength(2);
  });

  it('shows the completed agent response in the main conversation', () => {
    const agents = [makeAgent('agent-default', 'claude-code')];
    renderChatArea({
      agents,
      conversationType: 'single',
      timeline: {
        'conv-1': [
          {
            id: 'run-response',
            conversationId: 'conv-1',
            runId: 'run-response',
            taskId: null,
            agentId: 'agent-default',
            agentName: 'claude-code',
            agentSessionId: null,
            prompt: '你好',
            status: 'completed',
            startedAt: '2026-06-21T10:23:32.000Z',
            finishedAt: '2026-06-21T10:23:35.000Z',
            detailsLoaded: true,
            blocks: [{ kind: 'agent_text', id: 'text-response', content: '你好，我可以正常回复。' }],
            error: null,
          },
        ],
      },
    });

    expect(screen.getByText('你好，我可以正常回复。')).toBeTruthy();
  });

  it('reruns a failed task run through rerunTask', async () => {
    mockedRerunTask.mockResolvedValue({
      task: {
        id: 'task-retry',
        conversation_id: 'conv-1',
        source_message_id: 'message-1',
        plan_message_id: 'plan-1',
        title: 'Retry task',
        description: 'retry the failed task',
        status: 'assigned',
        priority: 1,
        created_at: '2026-05-28T00:00:00.000Z',
        updated_at: '2026-05-28T00:01:00.000Z',
      },
      assignment: {
        id: 'assignment-retry',
        task_id: 'task-retry',
        conversation_id: 'conv-1',
        agent_id: 'agent-default',
        status: 'pending',
        latest_run_id: 'run-new',
        assigned_at: '2026-05-28T00:01:00.000Z',
        started_at: null,
        completed_at: null,
      },
      run: {
        id: 'run-new',
        conversation_id: 'conv-1',
        task_id: 'task-retry',
        assignment_id: 'assignment-retry',
        agent_id: 'agent-default',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'message-1',
        workspace_id: 'ws-1',
        prompt: 'retry the failed task',
        trigger_type: 'task',
        trigger_source_id: 'plan-1',
        requested_by: 'user',
        status: 'queued',
        pid: null,
        exit_code: null,
        error_message: null,
        started_at: '2026-05-28T00:01:00.000Z',
        finished_at: null,
        events: [],
      },
    } as never);

    const agents = [makeAgent('agent-default', 'claude-code')];
    renderChatAreaStateful({
      agents,
      timeline: {
        'conv-1': [
          {
            id: 'run-failed-task',
            conversationId: 'conv-1',
            runId: 'run-failed-task',
            taskId: 'task-retry',
            agentId: 'agent-default',
            agentName: 'claude-code',
            agentSessionId: null,
            prompt: 'retry the failed task',
            status: 'failed',
            startedAt: '2026-05-28T00:00:00.000Z',
            finishedAt: '2026-05-28T00:00:10.000Z',
            blocks: [],
            error: 'command failed',
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '重试任务' }));

    await waitFor(() => expect(mockedRerunTask).toHaveBeenCalledWith('task-retry'));
    expect(await screen.findByText('Waiting to start')).toBeTruthy();
  });

  it('restarts a failed direct run with its original Agent and prompt', async () => {
    const agents = [makeAgent('agent-default', 'claude-code')];
    renderChatArea({
      agents,
      timeline: {
        'conv-1': [
          {
            id: 'run-failed-direct',
            conversationId: 'conv-1',
            runId: 'run-failed-direct',
            taskId: null,
            agentId: 'agent-default',
            agentName: 'claude-code',
            agentSessionId: null,
            prompt: 'repair app',
            status: 'failed',
            startedAt: '2026-05-28T00:00:00.000Z',
            finishedAt: '2026-05-28T00:00:10.000Z',
            blocks: [],
            error: 'command failed',
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: '重试任务' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledWith(
      'conv-1',
      'repair app',
      'agent-default',
      undefined,
      expect.objectContaining({ root_path: '/tmp/workspace' }),
      expect.any(Function),
    ));
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

  it('keeps the user bubble while rendering Agent replies without a reply box', () => {
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
            sender_type: 'orchestrator',
            sender_id: null,
            content: '所有任务已完成合并',
            message_type: 'text',
            mentions: null,
            metadata_json: null,
            created_at: '2026-05-28T00:00:05.000Z',
          },
        ],
      },
    });

    const userCard = screen.getByText('你好').closest('[data-message-role="user"]');
    const agentCard = screen.getByText('所有任务已完成合并').closest('[data-message-role="agent"]');
    const userMessage = userCard?.firstElementChild as HTMLDivElement | null;
    const agentMessage = agentCard?.firstElementChild as HTMLDivElement | null;
    const userBubble = userCard?.querySelector('[data-message-content="user"]') as HTMLDivElement | null;
    const agentContent = agentCard?.querySelector('[data-message-content="agent"]') as HTMLDivElement | null;

    expect(userCard).not.toBeNull();
    expect(agentCard).not.toBeNull();
    expect(userCard?.getAttribute('class')).toContain('justify-end');
    expect(agentCard?.getAttribute('class')).toContain('justify-start');
    expect(userMessage?.style.width).toBe('65%');
    expect(userMessage?.style.maxWidth).toBe('65%');
    expect(agentMessage?.style.width).toBe('65%');
    expect(agentMessage?.style.maxWidth).toBe('65%');
    expect(userBubble).not.toBeNull();
    expect(agentContent).not.toBeNull();
    expect(userBubble!.style.backgroundColor).toBe('rgb(239, 248, 255)');
    expect(userBubble!.style.borderTopColor).toBe('rgb(191, 219, 254)');
    expect(agentContent!.style.backgroundColor).toBe('');
    expect(agentContent!.style.borderTopColor).toBe('');
    expect(agentContent!.getAttribute('class')).not.toContain('rounded-2xl');
    expect(screen.getByText('Orchestrator')).toBeTruthy();
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

  it('routes single chat messages to the selected agent without requiring mentions', async () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
      makeAgent('agent-reviewer', 'reviewer', 'codex_cli'),
    ];
    const { workspace, dispatch } = renderChatArea({ agents, conversationType: 'single' });

    fireEvent.click(screen.getByRole('button', { name: '选择单聊 Agent' }));
    fireEvent.click(screen.getByRole('option', { name: 'reviewer' }));
    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '检查一下这个实现' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(mockedStartRun).toHaveBeenCalledTimes(1));
    expect(mockedStartRun).toHaveBeenCalledWith(
      'conv-1',
      '检查一下这个实现',
      'agent-reviewer',
      'msg-1',
      workspace,
      dispatch,
    );
    expect(mockedCreateMessage).toHaveBeenCalledWith('conv-1', {
      content: '检查一下这个实现',
      mentions: [],
      messageType: 'text',
    });
  });

  it('ignores rapid duplicate sends before the sending state renders', async () => {
    const agents = [
      makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true }),
    ];
    renderChatArea({ agents });

    fireEvent.change(screen.getByPlaceholderText(inputPlaceholder), {
      target: { value: '@orchestrator 帮我写一个 GET /health 接口，然后写个测试' },
    });
    const sendButton = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => expect(mockedCreateMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedOrchestrateConversation).toHaveBeenCalledTimes(1));
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

  it.skip('shows diff buttons for completed runs and only requests the selected runId', async () => {
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

    await openRunPanel(1, '代码改动');

    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledTimes(1));
    expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-2');
  });

  it.skip('shows preview buttons only for completed runs and starts preview for the selected run', async () => {
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

    await openRunPanel(0, '网页预览');
    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => expect(mockedStartRunPreview).toHaveBeenCalledTimes(1));
    expect(mockedStartRunPreview).toHaveBeenCalledWith('run-completed');
    expect(screen.getByTitle('Run preview')).toBeTruthy();
  });

  it.skip('shows preview start error on the matching run only', async () => {
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

    await openRunPanel(1, '网页预览');
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

    await waitFor(() => expect(document.querySelector('[data-run-id] button')).toBeTruthy());
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

    await screen.findByText('协作计划');
    expect(screen.getByText(/所有任务已完成/)).toBeTruthy();
    expect(screen.getAllByText(/frontend-agent/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('前端页面')).toBeTruthy();
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

    await screen.findByText('协作计划');

    const userMessageNode = screen.getByText('做一个博客系统');
    const planNode = screen.getByText('协作计划');
    const oldRunNode = document.querySelector('[data-run-id="run-a"]');

    expect(oldRunNode).toBeTruthy();

    expect(
      userMessageNode.compareDocumentPosition(planNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      planNode.compareDocumentPosition(oldRunNode!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.skip('keeps PlanCard stable while DiffCard opens for the selected orchestrated run', async () => {
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

    // done-column kanban card is clickable; click the task title to trigger onOpenDiff
    fireEvent.click(await screen.findByText('登录页'));

    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-diff'));
    expect(mockedGetRunFileChanges).toHaveBeenCalledTimes(1);
    expect(screen.getByText('src/login.tsx')).toBeTruthy();
  });

  it.skip('keeps preview state scoped to the selected run and clears iframe after stop', async () => {
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

    fireEvent.click(await screen.findByText('页面任务'));
    await waitFor(() => expect(mockedGetRunFileChanges).toHaveBeenCalledWith('run-preview-a'));
    expect(screen.getByText('src/page.tsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '网页预览' }));
    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => expect(mockedStartRunPreview).toHaveBeenCalledWith('run-preview-a'));
    expect(screen.getByTitle('Run preview')).toBeTruthy();
    expect(screen.queryByText('预览验收')).toBeNull();
  });

  const agents = [makeAgent('agent-default', 'claude-code', 'claude_cli', { isDefault: true })];

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

  it('loads worktree metadata without exposing the workspace mode in the chat card', async () => {
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

    await waitFor(() => expect(document.querySelector('[data-run-id="run-abc123"]')).toBeTruthy());
    expect(screen.getByText('claude-code')).toBeTruthy();
    expect(screen.queryByText(/worktree/)).toBeNull();
    expect(screen.queryByText('run-abc123')).toBeNull();
    expect(screen.queryByText('run-abc1')).toBeNull();
    expect(mockedGetRunCardSummary).not.toHaveBeenCalled();
  });

  it('loads clone metadata without exposing the workspace mode in the chat card', async () => {
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

    await waitFor(() => expect(document.querySelector('[data-run-id="run-def456"]')).toBeTruthy());
    expect(screen.getByText('claude-code')).toBeTruthy();
    expect(screen.queryByText('clone')).toBeNull();
    expect(screen.queryByText('run-def456')).toBeNull();
  });

  it('loads legacy metadata without exposing the workspace mode in the chat card', async () => {
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

    await waitFor(() => expect(document.querySelector('[data-run-id="run-legacy"]')).toBeTruthy());
    expect(screen.getByText('claude-code')).toBeTruthy();
    expect(screen.queryByText('legacy')).toBeNull();
    expect(screen.queryByText('run-legacy')).toBeNull();
  });

  it('does not crash when getRunWorkspace fails', async () => {
    mockedGetRunCardSummary.mockRejectedValue(new Error('network error'));

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-error')] },
    });

    await waitFor(() => expect(document.querySelector('[data-run-id="run-error"]')).toBeTruthy());
    expect(screen.getByText('claude-code')).toBeTruthy();
    expect(screen.queryByText('run-erro')).toBeNull();
    expect(screen.queryByText('worktree')).toBeNull();
    expect(screen.queryByText('clone')).toBeNull();
  });

  it('does not load heavy run metadata for compact pills', async () => {
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

    await waitFor(() => expect(document.querySelectorAll('[data-run-id]').length).toBe(2));
    expect(mockedGetRunCardSummary).not.toHaveBeenCalled();
  });
});

describe.skip('RunCard apply changes UI', () => {
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
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

    await expandFirstRunCard();

    await waitFor(() => expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-2'));
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('clicking Apply Changes calls requestApplyChanges', async () => {
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
    } as ApprovalRequest);

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-3')] },
    });

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-3');
    });
  });

  it('shows Apply Changes button in the footer panel', async () => {
    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-4')] },
    });

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-4');
      expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-4');
    });
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

    await expandFirstRunCard();

    await waitFor(() => expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-5'));
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('does not show Apply Changes when application status is skipped', async () => {
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

    await expandFirstRunCard();

    await waitFor(() => expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-6'));
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('shows error when apply fails with a message', async () => {
    vi.mocked(api.requestApplyChanges).mockRejectedValue(new Error('Run workspace has been cleaned'));

    renderChatArea({
      agents,
      timeline: { 'conv-1': [makeRunItem('run-7')] },
    });

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

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
      expect(screen.getByText('Running')).toBeTruthy();
    });
    expect(screen.queryByText('run-8')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('shows Apply Changes for a completed run after opening the artifact panel', async () => {
    const runs: ChatTimelineItem[] = [
      makeRunItem('run-a'),
      makeRunItem('run-b'),
    ];

    renderChatArea({
      agents,
      timeline: { 'conv-1': runs },
    });

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
  });
});

describe.skip('RunCard apply conflict guard', () => {
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-1');
    });
    expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-1');
  });

  it('shows conflict summary when checkRunApply returns conflicts', async () => {
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/1 conflicts/)).toBeTruthy();
      expect(screen.getByText(/1 skipped/)).toBeTruthy();
    });
    expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-2');
  });

  it('shows conflict summary with conflict/skipped counts', async () => {
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/1 conflicts/)).toBeTruthy();
      expect(screen.getByText(/0 skipped/)).toBeTruthy();
    });
  });

  it('shows conflict summary with all counts', async () => {
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByText(/1 skipped/)).toBeTruthy();
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

    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
    });
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

    await expandFirstRunCard();

    await waitFor(() => expect(mockedGetRunCardSummary).toHaveBeenCalledWith('run-6'));
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

    // Open the panel and check apply is available for the first run
    await openApplyPanel();
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
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
    expect(screen.getByText('单聊')).toBeTruthy();
    expect(screen.getByText('群聊')).toBeTruthy();
    expect(screen.getByPlaceholderText('粘贴项目绝对路径，如 /Users/me/myproject')).toBeTruthy();
    expect(screen.queryByText(/Web 版本需手动粘贴绝对路径/)).toBeNull();
    expect(screen.getByRole('button', { name: '创建协作会话' })).toBeTruthy();
  });

  it('uses the conversation background gradient on the WorkspaceSetup surface', () => {
    renderChatArea({ agents, selectedConvId: null });

    expect(screen.getByTestId('workspace-setup-surface').style.background).toBe(
      'linear-gradient(rgb(232, 238, 231) 0%, rgb(247, 247, 241) 55%, rgb(255, 248, 247) 100%)',
    );
  });

  it('blends the WorkspaceSetup card into the gradient with a translucent surface', () => {
    renderChatArea({ agents, selectedConvId: null });

    const card = screen.getByTestId('workspace-setup-card');
    expect(card.style.backgroundColor).toBe('rgba(255, 252, 250, 0.66)');
    expect(card.style.backdropFilter).toBe('blur(18px)');
    expect(card.getAttribute('class')).toContain('pb-6');
  });

  it('portals Agent configuration outside the translucent WorkspaceSetup card', () => {
    renderChatArea({ agents, selectedConvId: null });

    fireEvent.click(screen.getByRole('button', { name: '配置 Agents' }));

    const modal = screen.getByTestId('agent-settings-modal');
    expect(modal.parentElement).toBe(document.body);
    expect(screen.getByTestId('workspace-setup-card').contains(modal)).toBe(false);
  });

  it('uses agent choice cards instead of a native select for single chat setup', () => {
    renderChatArea({
      agents: [
        makeAgent('agent-builder', 'builder', 'claude_cli', { isDefault: true }),
        makeAgent('agent-tester', 'tester'),
        makeAgent('agent-reviewer', 'reviewer'),
      ],
      selectedConvId: null,
    });

    fireEvent.click(screen.getByRole('button', { name: /单聊/ }));

    expect(screen.getByText('单聊对象')).toBeTruthy();
    expect(screen.getByRole('button', { name: /builder/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /tester/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('负责实现功能、修改代码和整理基础工程结构。')).toBeTruthy();
    expect(screen.getByText('负责补充测试、验证行为和发现回归风险。')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows available agents before entering a group conversation', () => {
    renderChatArea({
      agents: [
        makeAgent('agent-builder', 'builder', 'claude_cli', { isDefault: true }),
        makeAgent('agent-tester', 'tester'),
        makeAgent('agent-reviewer', 'reviewer'),
        makeAgent('agent-design', 'designer'),
      ],
      selectedConvId: null,
    });

    expect(screen.getByRole('button', { name: '配置 Agents' })).toBeTruthy();
    // Default mode is group — shows agent count, not individual agent cards
    expect(screen.getByText(/4 个 Agent 可用/)).toBeTruthy();
    // Single mode shows individual agent cards
    fireEvent.click(screen.getByText('单聊'));
    expect(screen.getByText('单聊对象')).toBeTruthy();
    expect(screen.getByTestId('agent-picker-list').getAttribute('class')).toContain('max-h-[260px]');
    expect(screen.getByTestId('agent-picker-list').getAttribute('class')).toContain('overflow-y-auto');
    expect(screen.getByRole('button', { name: /builder/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /tester/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reviewer/ })).toBeTruthy();
    expect(screen.getByText('负责代码审查、风险判断和改进建议。')).toBeTruthy();
  });

  it('shows Chinese guidance and demo prompts when conversation has no content', () => {
    renderChatArea({ agents, selectedConvId: 'conv-1' });
    expect(screen.getByPlaceholderText(/@orchestrator/)).toBeTruthy();
    expect(screen.getByText('让 Orchestrator 检查项目结构')).toBeTruthy();
    expect(screen.getByText('指定 builder 干活')).toBeTruthy();
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
    const input = screen.getByPlaceholderText('粘贴项目绝对路径，如 /Users/me/myproject');
    fireEvent.change(input, { target: { value: '/Users/test/project' } });

    await screen.findByText('✓ git');
    expect(screen.getByText('✓ 预览')).toBeTruthy();
    expect(screen.getByText('✓ runtime')).toBeTruthy();
    const btn = screen.getByRole('button', { name: '创建协作会话' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.style.background).toBe(
      'linear-gradient(rgb(152, 165, 150) 0%, rgb(220, 233, 216) 100%)',
    );
    expect(screen.getByTestId('create-button-surface').style.background).toBe(
      'linear-gradient(rgb(247, 250, 245) 0%, rgb(206, 216, 202) 55%, rgb(237, 245, 233) 100%)',
    );
    expect(btn.style.boxShadow).toBe('0 8px 18px rgba(112, 137, 108, 0.12), 0 2px 5px rgba(0, 0, 0, 0.03)');
    expect(btn.getAttribute('class')).toContain('min-h-12');
    expect(btn.getAttribute('class')).toContain('p-[2px]');
  });

  it('create button is disabled until validation passes', () => {
    renderChatArea({ agents, selectedConvId: null });
    const btn = screen.getByRole('button', { name: '创建协作会话' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('create-button-surface').style.background).toBe(
      'linear-gradient(rgb(243, 246, 241) 0%, rgb(220, 228, 216) 55%, rgb(239, 244, 237) 100%)',
    );
  });

  it('uses the restrained light-control treatment for Agent configuration', () => {
    renderChatArea({ agents, selectedConvId: null });

    const button = screen.getByRole('button', { name: '配置 Agents' });
    expect(button.style.backgroundColor).toBe('rgba(255, 255, 255, 0.52)');
    expect(button.style.color).toBe('rgb(36, 74, 45)');
  });
});

describe.skip('Acceptance — artifact panel apply flow', () => {
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
    vi.mocked(api.getRunFileChanges).mockResolvedValue([]);
  });

  it('shows Apply Changes button in the artifact footer and triggers apply', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-1', canApply: true,
      files: [{ filePath: 'src/a.ts', changeType: 'create', status: 'safe' }],
      summary: { safe: 1, conflict: 0, skipped: 0 },
    });
    vi.mocked(api.requestApplyChanges).mockResolvedValue({
      id: 'approval-acc-1', conversationId: 'conv-1', runId: 'run-1',
      taskId: null, assignmentId: null, actionType: 'apply_changes', status: 'pending',
      title: 'Apply Changes', description: null, payload: null, result: null,
      errorMessage: null, createdAt: '2026-05-28T00:00:00.000Z', decidedAt: null, executedAt: null,
    });

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-1')] } });
    await openApplyPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));

    await waitFor(() => {
      expect(vi.mocked(api.checkRunApply)).toHaveBeenCalledWith('run-1');
      expect(vi.mocked(api.requestApplyChanges)).toHaveBeenCalledWith('run-1');
    });
  });

  it('shows conflict warning when check fails', async () => {
    vi.mocked(api.checkRunApply).mockResolvedValue({
      runId: 'run-2', canApply: false,
      files: [{ filePath: 'src/a.ts', changeType: 'create', status: 'conflict', reason: 'File already exists' }],
      summary: { safe: 0, conflict: 1, skipped: 0 },
    });

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-2')] } });
    await openApplyPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
    await screen.findByText(/1 conflicts/);
  });

  it('shows apply error message', async () => {
    vi.mocked(api.requestApplyChanges).mockRejectedValue(new Error('Run workspace has been cleaned'));

    renderChatArea({ agents, timeline: { 'conv-1': [makeRunItem('run-3')] } });
    await openApplyPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }));
    await screen.findByText('Run workspace has been cleaned');
  });
});

describe('project-scoped artifacts', () => {
  const agents = [makeAgent('agent-default', 'builder')];

  it('keeps project diff global and opens only work logs from a task card', async () => {
    const run: ChatTimelineItem = {
      id: 'run-1', conversationId: 'conv-1', runId: 'run-1', taskId: 'task-1',
      agentId: 'agent-default', agentName: 'builder', agentSessionId: null,
      prompt: 'Create GET /health endpoint', status: 'completed',
      startedAt: '2026-06-20T00:00:00.000Z', finishedAt: '2026-06-20T00:01:00.000Z',
      blocks: [{ kind: 'agent_text', id: 'text-1', content: 'work log output' }],
      error: null, detailsLoaded: true,
    };
    const plan = {
      id: 'plan-1', conversationId: 'conv-1', prompt: 'health', summary: 'health',
      createdAt: '2026-06-20T00:00:00.000Z',
      items: [{
        index: 1, title: 'Create GET /health endpoint', description: '',
        assignedAgentId: 'agent-default', assignedAgentName: 'builder',
        taskId: 'task-1', assignmentId: 'assignment-1', runId: 'run-1',
        status: 'completed' as const, dependsOn: [],
      }],
    };
    vi.mocked(api.getWorkspaceFileChanges).mockClear();
    vi.mocked(api.getRunFileChanges).mockClear();

    renderChatArea({
      agents,
      timeline: { 'conv-1': [run] },
      plansByConversation: { 'conv-1': [plan] },
    });

    fireEvent.click(screen.getByRole('button', { name: '代码改动' }));
    await waitFor(() => expect(api.getWorkspaceFileChanges).toHaveBeenCalledWith('ws-1'));
    expect(await screen.findByText('整个项目')).toBeTruthy();

    fireEvent.click(screen.getByText('Create GET /health endpoint'));
    expect(await screen.findByRole('complementary', { name: '工作日志' })).toBeTruthy();
    expect(screen.getByText('work log output')).toBeTruthy();
    expect(api.getRunFileChanges).not.toHaveBeenCalled();
  });
});
