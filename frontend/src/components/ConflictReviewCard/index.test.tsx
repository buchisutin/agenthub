import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import type { Message } from '../../types';
import { ConflictReviewCard } from './index';

vi.mock('../../services/api', () => ({
  api: {
    getConversationApprovals: vi.fn(),
    requestConflictResolution: vi.fn(),
    approveApproval: vi.fn(),
    rejectApproval: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConflictReviewCard', () => {
  it('submits merge conflict selections including the llm option when available', async () => {
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);
    vi.mocked(api.requestConflictResolution).mockResolvedValue({
      id: 'approval-1',
      conversationId: 'conv-1',
      runId: 'run-1',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      actionType: 'resolve_conflicts',
      status: 'pending',
      title: 'Resolve Merge Conflicts',
      description: null,
      payload: null,
      result: null,
      errorMessage: null,
      createdAt: '2026-06-11T00:00:00.000Z',
      decidedAt: null,
      executedAt: null,
    });

    const message: Message = {
      id: 'msg-1',
      conversation_id: 'conv-1',
      sender_type: 'orchestrator',
      sender_id: null,
      content: '需要处理冲突',
      message_type: 'conflict_review',
      mentions: null,
      metadata_json: {
        runId: 'run-1',
        branchName: 'agenthub/run-1',
        conflictFiles: [
          {
            filePath: 'src/app.ts',
            reason: 'Main workspace changed since this run started',
            baseContent: 'old',
            currentContent: 'current',
            runContent: 'run',
            llmAvailable: true,
          },
        ],
      },
      created_at: '2026-06-11T00:00:00.000Z',
    };

    render(
      <ConflictReviewCard
        message={message}
        title="Orchestrator"
        time="00:00"
        avatarLabel="OR"
      />,
    );

    await waitFor(() => {
      expect(api.getConversationApprovals).toHaveBeenCalledWith('conv-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '用 LLM 建议' }));
    fireEvent.click(screen.getByRole('button', { name: '提交冲突处理' }));

    await waitFor(() => {
      expect(api.requestConflictResolution).toHaveBeenCalledWith(
        'run-1',
        [{ filePath: 'src/app.ts', strategy: 'use_llm' }],
      );
    });
  });

  it('caps large conflict lists, shows a warning, and expands on demand', async () => {
    vi.mocked(api.getConversationApprovals).mockResolvedValue([]);

    const message: Message = {
      id: 'msg-2',
      conversation_id: 'conv-1',
      sender_type: 'orchestrator',
      sender_id: null,
      content: '大量冲突',
      message_type: 'conflict_review',
      mentions: null,
      metadata_json: {
        runId: 'run-2',
        branchName: 'agenthub/run-2',
        conflictFiles: Array.from({ length: 60 }, (_, index) => ({
          filePath: `src/file-${index}.ts`,
          reason: 'Conflict',
          baseContent: `base-${index}`,
          currentContent: `current-${index}`,
          runContent: `run-${index}`,
          llmAvailable: false,
        })),
      },
      created_at: '2026-06-11T00:00:00.000Z',
    };

    render(
      <ConflictReviewCard
        message={message}
        title="Orchestrator"
        time="00:00"
        avatarLabel="OR"
      />,
    );

    expect(screen.getByText('检测到大量冲突文件（60 个），可能是未排除生成目录导致，请检查 .gitignore 配置')).toBeTruthy();
    expect(screen.getByText('src/file-0.ts')).toBeTruthy();
    expect(screen.getByText('src/file-19.ts')).toBeTruthy();
    expect(screen.queryByText('src/file-20.ts')).toBeNull();
    expect(screen.getByRole('button', { name: '显示更多' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '展开 src/file-0.ts' }));
    expect(screen.getByText('base-0')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '显示更多' }));
    expect(screen.getByText('src/file-20.ts')).toBeTruthy();
  });
});
