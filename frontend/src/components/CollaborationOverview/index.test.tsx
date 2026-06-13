import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  it('shows task progress and active work', () => {
    render(
      <CollaborationOverview
        plans={[plan]}
        timeline={[runningRun]}
        activeRunIds={['run-2']}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('当前协作')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('任务完成')).toBeTruthy();
    expect(screen.getByText('Agent 运行中')).toBeTruthy();
    expect(screen.getByText('Frontend UI')).toBeTruthy();
    expect(screen.getByText('@frontend-agent')).toBeTruthy();
  });

  it('shows an empty state before any plan or run exists', () => {
    render(
      <CollaborationOverview
        plans={[]}
        timeline={[]}
        activeRunIds={[]}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('还没有协作任务')).toBeTruthy();
    expect(screen.getByText('发送 @orchestrator 或 @agent 开始。')).toBeTruthy();
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

    expect(screen.getAllByText('需要处理').length).toBeGreaterThan(0);
    expect(screen.getByText('Frontend UI 失败')).toBeTruthy();
  });
});
