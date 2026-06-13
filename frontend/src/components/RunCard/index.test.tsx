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
    getConversationApprovals: vi.fn(),
    checkRunApply: vi.fn(),
    requestApplyChanges: vi.fn(),
    requestApplyAndCommit: vi.fn(),
    startRunPreview: vi.fn(),
    approveApproval: vi.fn(),
    rejectApproval: vi.fn(),
  },
}));

const mockedGetRunCardSummary = vi.mocked(api.getRunCardSummary);
const mockedGetConversationApprovals = vi.mocked(api.getConversationApprovals);
const mockedCheckRunApply = vi.mocked(api.checkRunApply);
const mockedRequestApplyAndCommit = vi.mocked(api.requestApplyAndCommit);

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
  });

  it('shows artifact and apply actions only when file changes exist', async () => {
    const onFocusArtifacts = vi.fn();
    renderRunCard(makeRun('run-1'), false, onFocusArtifacts);

    await waitFor(() => {
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '查看产物' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Apply and Commit' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '查看产物' }));
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
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 0 files')).toBeTruthy();
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
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
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
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('临时工作区已清理，Diff 和 Preview 已收起')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'View Diff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
  });

  it('requests an apply-and-commit approval with the new action type', async () => {
    renderRunCard(makeRun('run-commit'));

    await waitFor(() => {
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply and Commit' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply and Commit' }));

    await waitFor(() => {
      expect(mockedCheckRunApply).toHaveBeenCalledWith('run-commit');
      expect(mockedRequestApplyAndCommit).toHaveBeenCalledWith('run-commit');
      expect(screen.getByText('Needs confirmation')).toBeTruthy();
    });
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
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    await waitFor(() => {
      expect(screen.getByText('已自动合并到项目')).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply and Commit' })).toBeNull();
    expect(screen.queryByText('这些改动还停留在隔离工作区里。应用到项目后，后续 Run 才会基于这次结果继续协作。')).toBeNull();
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
      expect(screen.getByText('frontend-agent 完成了「test prompt」 · 1 files')).toBeTruthy();
    });
  });

  it('keeps running details collapsed by default and shows a working summary', async () => {
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
      expect(screen.getByText('frontend-agent 正在处理「test prompt」')).toBeTruthy();
      expect(screen.queryByText('工具调用')).toBeNull();
    });
  });
});
