import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskWorkLogPanel } from './index';
import type { ChatTimelineItem } from '../../types';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getRun: vi.fn(),
      getRunFileChanges: vi.fn(),
      getWorkspaceFileChanges: vi.fn(),
      startWorkspacePreview: vi.fn(),
      startWorkspaceDeploy: vi.fn(),
    },
  };
});

const item: ChatTimelineItem = {
  id: 'run-1',
  conversationId: 'conv-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  agentName: 'builder',
  agentSessionId: null,
  prompt: 'Create GET /health endpoint',
  status: 'completed',
  startedAt: '2026-06-20T00:00:00.000Z',
  finishedAt: '2026-06-20T00:01:00.000Z',
  blocks: [{ kind: 'agent_text', id: 'text-1', content: 'endpoint complete' }],
  error: null,
  detailsLoaded: true,
};

describe('TaskWorkLogPanel', () => {
  it('renders only the selected task work log', () => {
    render(
      <TaskWorkLogPanel
        open
        item={item}
        taskTitle="Create GET /health endpoint"
        onClose={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );

    expect(screen.getByRole('complementary', { name: '工作日志' })).toBeTruthy();
    expect(screen.getAllByText('Create GET /health endpoint').length).toBeGreaterThan(0);
    expect(screen.getByText('@builder · completed')).toBeTruthy();
    expect(screen.getByText('endpoint complete')).toBeTruthy();
    expect(screen.queryByText('代码改动')).toBeNull();
    expect(screen.queryByText('网页预览')).toBeNull();
    expect(screen.queryByText('部署')).toBeNull();
  });
});
