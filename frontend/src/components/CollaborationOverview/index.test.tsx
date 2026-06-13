import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollaborationOverview } from './index';
import type { ChatTimelineItem, PlanCardModel } from '../../types';

const plan: PlanCardModel = {
  id: 'plan-1',
  conversationId: 'conv-1',
  prompt: 'build feature',
  summary: 'Build the feature in stages',
  createdAt: '2026-06-13T00:00:00.000Z',
  items: [
    {
      index: 1,
      plannerTaskId: 't1',
      title: 'Backend API',
      description: 'Build API',
      assignedAgentId: 'agent-back',
      assignedAgentName: 'backend-agent',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      runId: 'run-1',
      status: 'completed',
      dependsOn: [],
    },
    {
      index: 2,
      plannerTaskId: 't2',
      title: 'Frontend UI',
      description: 'Build UI',
      assignedAgentId: 'agent-front',
      assignedAgentName: 'frontend-agent',
      taskId: 'task-2',
      assignmentId: 'assignment-2',
      runId: 'run-2',
      status: 'running',
      dependsOn: ['t1'],
    },
  ],
};

const runningRun: ChatTimelineItem = {
  id: 'run-2',
  conversationId: 'conv-1',
  runId: 'run-2',
  taskId: 'task-2',
  agentId: 'agent-front',
  agentName: 'frontend-agent',
  agentSessionId: null,
  prompt: 'Build UI',
  status: 'running',
  startedAt: '2026-06-13T00:00:00.000Z',
  finishedAt: null,
  blocks: [],
  error: null,
};

describe('CollaborationOverview', () => {
  it('shows a compact collaboration status strip', () => {
    const onOpenArtifacts = vi.fn();
    render(
      <CollaborationOverview
        plans={[plan]}
        timeline={[runningRun]}
        activeRunIds={['run-2']}
        onOpenArtifacts={onOpenArtifacts}
      />,
    );

    expect(screen.getByText('协作状态')).toBeTruthy();
    expect(screen.getByText('1/2 任务完成')).toBeTruthy();
    expect(screen.getByText('1 运行中')).toBeTruthy();
    expect(screen.getByText('0 待处理')).toBeTruthy();
    expect(screen.queryByText('Build the feature in stages')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看计划' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看成果' })).toBeNull();
    expect(screen.getByRole('button', { name: '成果' })).toBeTruthy();
    expect(screen.getByLabelText('协作状态').className).toContain('sticky');

    fireEvent.click(screen.getByRole('button', { name: '成果' }));
    expect(onOpenArtifacts).toHaveBeenCalledWith('tasks');
  });

  it('stays out of the way before any plan or run exists', () => {
    render(
      <CollaborationOverview
        plans={[]}
        timeline={[]}
        activeRunIds={[]}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.queryByText('还没有协作任务')).toBeNull();
    expect(screen.queryByText('发送 @orchestrator 或 @agent 开始。')).toBeNull();
  });

  it('surfaces failed runs as needs attention', () => {
    render(
      <CollaborationOverview
        plans={[plan]}
        timeline={[{ ...runningRun, status: 'failed', error: 'Runtime failed' }]}
        activeRunIds={[]}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('1 待处理')).toBeTruthy();
  });
});
