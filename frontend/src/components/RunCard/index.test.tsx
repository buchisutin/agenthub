import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunCard } from './index';
import { api } from '../../services/api';
import { AppContext } from '../../store/AppContext';
import { initialState } from '../../store/appState';
import type { ChatTimelineItem, FileChange } from '../../types';

vi.mock('../../services/api', () => ({
  api: {
    getRunCardSummary: vi.fn(),
    getRun: vi.fn(),
    getConversationApprovals: vi.fn(),
    checkRunApply: vi.fn(),
    requestApplyChanges: vi.fn(),
    requestApplyAndCommit: vi.fn(),
    startRunPreview: vi.fn(),
    getRunDeployScripts: vi.fn(),
    startRunDeploy: vi.fn(),
    getRunDeploy: vi.fn(),
    approveApproval: vi.fn(),
    rejectApproval: vi.fn(),
  },
}));

const mockedGetRunCardSummary = vi.mocked(api.getRunCardSummary);
const mockedGetRun = vi.mocked(api.getRun);
const mockedGetConversationApprovals = vi.mocked(api.getConversationApprovals);
const mockedCheckRunApply = vi.mocked(api.checkRunApply);
const mockedRequestApplyAndCommit = vi.mocked(api.requestApplyAndCommit);
const mockedGetRunDeployScripts = vi.mocked(api.getRunDeployScripts);
const mockedStartRunDeploy = vi.mocked(api.startRunDeploy);
const mockedGetRunDeploy = vi.mocked(api.getRunDeploy);

function makeRun(runId: string): ChatTimelineItem {
  return {
    id: runId,
    conversationId: 'conv-1',
    runId,
    taskId: null,
    agentId: 'agent-1',
    agentName: 'frontend-agent',
    agentSessionId: null,
    prompt: 'test prompt',
    status: 'completed',
    startedAt: '2026-05-28T00:00:00.000Z',
    finishedAt: '2026-05-28T00:01:00.000Z',
    blocks: [],
    error: null,
  };
}

function makeRunDetail(runId: string) {
  return {
    id: runId,
    conversation_id: 'conv-1',
    task_id: null,
    assignment_id: null,
    agent_id: 'agent-1',
    runtime_id: null,
    agent_session_id: null,
    source_message_id: null,
    workspace_id: 'ws-1',
    prompt: 'test prompt',
    trigger_type: 'chat' as const,
    trigger_source_id: 'conv-1',
    requested_by: 'user',
    status: 'completed' as const,
    pid: null,
    exit_code: 0,
    error_message: null,
    started_at: '2026-05-28T00:00:00.000Z',
    finished_at: '2026-05-28T00:01:00.000Z',
    events: [],
  };
}

const sampleChange: FileChange = {
  filePath: 'src/app.tsx',
  changeType: 'edit',
  oldContent: 'before\n',
  newContent: 'after\n',
  confidence: 'exact',
  source: 'tool_event',
};

function renderRunCard(item: ChatTimelineItem, isActive = false, onFocusArtifacts = vi.fn()) {
  return render(
    <AppContext.Provider value={{ state: initialState, dispatch: vi.fn() }}>
      <RunCard item={item} isActive={isActive} onInterrupt={() => {}} onFocusArtifacts={onFocusArtifacts} />
    </AppContext.Provider>,
  );
}

describe('RunCard action states', () => {
  beforeEach(() => {
    mockedGetRunCardSummary.mockReset();
    mockedGetRunCardSummary.mockResolvedValue({
      workspace: {
        mode: 'git_clone',
        rootPath: '/tmp/.agenthub/clones/run-1',
        branchName: 'agenthub/run-1',
        status: 'ready',
        errorMessage: null,
      },
      changeApplication: null,
      fileChanges: [sampleChange],
      mergeMode: 'manual',
      mergeStatus: null,
      merge: null,
    });
    mockedGetRun.mockReset();
    mockedGetRun.mockImplementation(async (runId) => makeRunDetail(runId));
    mockedGetConversationApprovals.mockReset();
    mockedGetConversationApprovals.mockResolvedValue([]);
    mockedCheckRunApply.mockReset();
    mockedCheckRunApply.mockResolvedValue({
      runId: 'run-1',
      canApply: true,
      files: [{ filePath: sampleChange.filePath, changeType: sampleChange.changeType, status: 'safe' }],
      summary: { safe: 1, conflict: 0, skipped: 0 },
    });
    mockedRequestApplyAndCommit.mockReset();
    mockedRequestApplyAndCommit.mockResolvedValue({
      id: 'approval-commit-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      taskId: null,
      assignmentId: null,
      actionType: 'apply_and_commit',
      status: 'pending',
      title: 'Apply and Commit',
      description: '1 file ready to apply.',
      payload: null,
      result: null,
      errorMessage: null,
      createdAt: '2026-05-28T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });
    mockedGetRunDeployScripts.mockReset();
    mockedGetRunDeployScripts.mockResolvedValue({
      runId: 'run-1',
      scripts: ['build'],
      defaultScript: 'build',
    });
    mockedStartRunDeploy.mockReset();
    mockedGetRunDeploy.mockReset();
    mockedGetRunDeploy.mockResolvedValue(null);
  });

  it('auto-loads execution records when a completed run is expanded', async () => {
    renderRunCard({ ...makeRun('run-detail'), eventCount: 69 });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });
    expect(screen.queryByText('展开查看执行详情')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(mockedGetRun).toHaveBeenCalledWith('run-detail');
    });
    expect(screen.queryByRole('button', { name: /加载 69 条执行记录/ })).toBeNull();
  });

  it('uses the agent name as the title and does not promote machine ids', async () => {
    renderRunCard({
      ...makeRun('75b3e7cc-run-id'),
      agentId: '75b3e7cc-machine-id',
      agentName: null,
    });

    await waitFor(() => {
      expect(screen.getByText('Agent')).toBeTruthy();
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    expect(screen.queryByText('75b3e7cc-machine-id')).toBeNull();
    expect(screen.queryByText('75b3e7cc-run-id')).toBeNull();
  });

  it('also masks uuid-like agent names before rendering the title', async () => {
    renderRunCard({
      ...makeRun('run-safe-title'),
      agentName: '75b3e7cc-7110-4d7d-a501-2e89c64bb031',
    });

    await waitFor(() => {
      expect(screen.getByText('Agent')).toBeTruthy();
    });
    expect(screen.queryByText('75b3e7cc-7110-4d7d-a501-2e89c64bb031')).toBeNull();
  });

  it('shows a lightweight right-panel guide instead of inline apply actions', async () => {
    const onFocusArtifacts = vi.fn();
    renderRunCard(makeRun('run-1'), false, onFocusArtifacts);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '在右侧审查并部署' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: '查看产物' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply and Commit' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '在右侧审查并部署' }));
    expect(onFocusArtifacts).toHaveBeenCalledWith('run-1', 'diff');
  });

  it('shows a no-change state instead of actions when no file changes were produced', async () => {
    mockedGetRunCardSummary.mockResolvedValue({
      workspace: {
        mode: 'git_clone',
        rootPath: '/tmp/.agenthub/clones/run-2',
        branchName: 'agenthub/run-2',
        status: 'ready',
        errorMessage: null,
      },
      changeApplication: null,
      fileChanges: [],
      mergeMode: 'manual',
      mergeStatus: null,
      merge: null,
    });

    renderRunCard(makeRun('run-2'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('无文件改动')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'View Diff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('replaces actions with an applied state once changes are already synced', async () => {
    mockedGetRunCardSummary.mockResolvedValue({
      workspace: {
        mode: 'git_clone',
        rootPath: '/tmp/.agenthub/clones/run-3',
        branchName: 'agenthub/run-3',
        status: 'ready',
        errorMessage: null,
      },
      changeApplication: {
        id: 'ca-1',
        runId: 'run-3',
        conversationId: 'conv-1',
        runWorkspaceId: 'rws-1',
        status: 'applied',
        appliedFiles: ['src/app.tsx'],
        skippedFiles: [],
        errorMessage: null,
        appliedAt: '2026-05-28T00:00:00.000Z',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
      fileChanges: [sampleChange],
      mergeMode: 'manual',
      mergeStatus: null,
      merge: null,
    });

    renderRunCard(makeRun('run-3'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('已应用')).toBeTruthy();
      expect(screen.getByText('改动已经同步到项目目录。')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'View Diff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('shows the cleaned workspace message and hides the action bar', async () => {
    mockedGetRunCardSummary.mockResolvedValue({
      workspace: {
        mode: 'git_clone',
        rootPath: '/tmp/.agenthub/clones/run-4',
        branchName: 'agenthub/run-4',
        status: 'cleaned',
        errorMessage: null,
      },
      changeApplication: null,
      fileChanges: [sampleChange],
      mergeMode: 'manual',
      mergeStatus: null,
      merge: null,
    });

    renderRunCard(makeRun('run-4'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('临时工作区已清理，Diff 和 Preview 已收起')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'View Diff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('does not request apply-and-commit from the left run card', async () => {
    renderRunCard(makeRun('run-commit'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '在右侧审查并部署' })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Apply and Commit' })).toBeNull();
    expect(mockedCheckRunApply).not.toHaveBeenCalledWith('run-commit');
    expect(mockedRequestApplyAndCommit).not.toHaveBeenCalledWith('run-commit');
  });

  it('hides manual apply actions for auto-merge DAG runs and shows merge status instead', async () => {
    mockedGetRunCardSummary.mockResolvedValue({
      workspace: {
        mode: 'git_clone',
        rootPath: '/tmp/.agenthub/clones/run-auto',
        branchName: 'agenthub/run-auto',
        status: 'ready',
        errorMessage: null,
      },
      changeApplication: null,
      fileChanges: [sampleChange],
      mergeMode: 'auto',
      mergeStatus: 'auto_merged',
      merge: {
        id: 'merge-1',
        runId: 'run-auto',
        conversationId: 'conv-1',
        taskId: 'task-1',
        assignmentId: 'assignment-1',
        status: 'auto_merged',
        appliedFiles: ['src/app.tsx'],
        conflicts: [],
        blockedReason: null,
        approvalId: null,
        mergedAt: '2026-06-12T00:00:00.000Z',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
      },
    });

    renderRunCard(makeRun('run-auto'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('已自动合并到项目')).toBeTruthy();
    });
    const footer = document.querySelector('.run-card-footer');
    expect(footer).toBeTruthy();
    expect(footer?.textContent).toContain('已自动合并到项目');
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply and Commit' })).toBeNull();
    expect(screen.queryByText('这些改动还停留在隔离工作区里。应用到项目后，后续 Run 才会基于这次结果继续协作。')).toBeNull();
  });

  it('renders all agent text blocks inside one output panel', async () => {
    renderRunCard({
      ...makeRun('run-agent-text'),
      blocks: [
        {
          kind: 'agent_text',
          id: 'text-1',
          content: 'First paragraph',
        },
        {
          kind: 'agent_text',
          id: 'text-2',
          content: 'Second paragraph',
        },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));

    const panels = document.querySelectorAll('.agent-output-panel');
    expect(panels.length).toBe(1);
    expect(panels[0]?.textContent).toContain('First paragraph');
    expect(panels[0]?.textContent).toContain('Second paragraph');
  });

  it('shows a breathing cursor while agent text is streaming', async () => {
    renderRunCard({
      ...makeRun('run-streaming-text'),
      status: 'running',
      finishedAt: null,
      blocks: [
        {
          kind: 'agent_text',
          id: 'text-streaming',
          content: 'Streaming **markdown',
        },
      ],
    }, true);

    expect(await screen.findByText(/Streaming/)).toBeTruthy();
    expect(document.querySelector('.agent-output-panel .typing-cursor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '展开执行细节 ↓' })).toBeNull();
  });

  it('collapses long completed agent output and allows expanding it', async () => {
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(220);

    renderRunCard({
      ...makeRun('run-long-text'),
      blocks: [
        {
          kind: 'agent_text',
          id: 'text-long',
          content: Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
        },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));

    expect(await screen.findByRole('button', { name: '展开执行细节 ↓' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开执行细节 ↓' }));
    expect(screen.getByRole('button', { name: '↑ 收起' })).toBeTruthy();

    scrollHeightSpy.mockRestore();
  });

  it('refetches file changes after the run transitions to completed', async () => {
    mockedGetRunCardSummary
      .mockResolvedValueOnce({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-5',
          branchName: 'agenthub/run-5',
          status: 'ready',
          errorMessage: null,
        },
        changeApplication: null,
        fileChanges: [],
      })
      .mockResolvedValueOnce({
        workspace: {
          mode: 'git_clone',
          rootPath: '/tmp/.agenthub/clones/run-5',
          branchName: 'agenthub/run-5',
          status: 'ready',
          errorMessage: null,
        },
        changeApplication: null,
        fileChanges: [sampleChange],
      });

    const runningItem = {
      ...makeRun('run-5'),
      status: 'running' as const,
      finishedAt: null,
    };

    const { rerender } = renderRunCard(runningItem, true);

    await waitFor(() => {
      expect(mockedGetRunCardSummary).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'View Diff' })).toBeNull();

    rerender(
      <AppContext.Provider value={{ state: initialState, dispatch: vi.fn() }}>
        <RunCard
          item={{ ...runningItem, status: 'completed', finishedAt: '2026-05-28T00:01:00.000Z' }}
          isActive={false}
          onInterrupt={() => {}}
        />
      </AppContext.Provider>,
    );

    await waitFor(() => {
      expect(mockedGetRunCardSummary).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: '展开' })).toBeTruthy();
    });
  });

  it('keeps running details expanded without a duplicate loading summary bar', async () => {
    renderRunCard({
      ...makeRun('run-running'),
      status: 'running',
      finishedAt: null,
      blocks: [
        {
          kind: 'tool_call',
          id: 'tool-1',
          toolUseId: 'tool-use-1',
          toolName: 'Read',
          status: 'completed',
          inputPreview: '/tmp/workspace/src/app.tsx',
          input: { file_path: '/tmp/workspace/src/app.tsx' },
          summary: 'read file',
          resultContent: null,
          partialJson: '',
          expanded: false,
          resultKind: 'read',
        },
      ],
    }, true);

    await waitFor(() => {
      expect(screen.getByText('执行中')).toBeTruthy();
      expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();
      expect(screen.queryByText('工具调用')).toBeNull();
      expect(screen.queryByText('展开查看执行详情')).toBeNull();
      expect(screen.queryByText('正在工作...')).toBeNull();
    });
  });

  it('shows running tool calls as a single-line terminal strip', async () => {
    renderRunCard({
      ...makeRun('run-running-tool'),
      status: 'running',
      finishedAt: null,
      blocks: [
        {
          kind: 'tool_call',
          id: 'tool-running',
          toolUseId: 'tool-use-running',
          toolName: 'Bash',
          status: 'running',
          inputPreview: 'npm run dev',
          input: { command: 'npm run dev' },
          summary: null,
          resultContent: null,
          partialJson: '',
          expanded: false,
          resultKind: 'bash',
        },
      ],
    }, true);

    expect(await screen.findByText(/Bash npm run dev/)).toBeTruthy();
    expect(document.querySelector('.typing-cursor')).toBeTruthy();
    expect(screen.queryByText('正在工作...')).toBeNull();
  });

  it('shows tool calls immediately after expanding a run card', async () => {
    renderRunCard({
      ...makeRun('run-tools'),
      blocks: [
        {
          kind: 'tool_call',
          id: 'tool-1',
          toolUseId: 'tool-use-1',
          toolName: 'Read',
          status: 'completed',
          inputPreview: '/tmp/workspace/src/app.tsx',
          input: { file_path: '/tmp/workspace/src/app.tsx' },
          summary: 'read file',
          resultContent: null,
          partialJson: '',
          expanded: false,
          resultKind: 'read',
        },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));

    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('EXECUTED TOOLS')).toBeTruthy();
    expect(screen.queryByText('✓')).toBeNull();
    expect(document.querySelector('[style*="rgb(16, 185, 129)"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '展开' })).toBeNull();
  });

  it('keeps failed tool rows compact and avoids duplicate error text', async () => {
    const duplicateMessage = 'This Bash command contains multiple operations. The following part requires approval: curl -s http://localhost:3000/health';
    renderRunCard({
      ...makeRun('run-failed-tool'),
      blocks: [
        {
          kind: 'tool_call',
          id: 'tool-failed',
          toolUseId: 'tool-use-failed',
          toolName: 'Bash',
          status: 'error',
          inputPreview: 'node index.js & sleep 1 curl -s http://localhost:3000/health',
          input: { command: 'node index.js & sleep 1 curl -s http://localhost:3000/health' },
          summary: duplicateMessage,
          resultContent: duplicateMessage,
          partialJson: '',
          expanded: false,
          resultKind: 'bash',
        },
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: '展开' }));

    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.queryByText('✗')).toBeNull();
    expect(document.querySelector('[style*="rgb(239, 68, 68)"]')).toBeTruthy();
    expect(document.querySelector('pre')).toBeNull();
  });
});
