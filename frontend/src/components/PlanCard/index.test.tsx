import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanCard } from './index';
import type { ChatTimelineItem, PlanCardModel } from '../../types';

function makePlan(overrides: Partial<PlanCardModel> = {}): PlanCardModel {
  return {
    id: 'plan-1',
    conversationId: 'conv-1',
    prompt: '做一个博客系统',
    summary: '拆成前后端两个任务',
    createdAt: '2026-05-28T00:00:00.000Z',
    items: [],
    ...overrides,
  };
}

describe('PlanCard', () => {
  it('renders kanban columns', () => {
    const plan = makePlan({
      items: [
        {
          index: 1,
          title: '前端页面',
          description: '做页面',
          taskType: 'frontend',
          expectedOutput: 'Build UI.',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          runId: 'run-1',
          status: 'running',
        },
      ],
    });

    render(<PlanCard plan={plan} />);

    expect(screen.getByText('等待中')).toBeTruthy();
    expect(screen.getByText('执行中')).toBeTruthy();
    expect(screen.getByText('需要处理')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
  });

  it('places tasks in correct columns by status', () => {
    const plan = makePlan({
      items: [
        {
          index: 1,
          title: '待开始任务',
          description: '',
          taskType: 'general',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-pending',
          assignmentId: 'a1',
          runId: null,
          status: 'pending',
        },
        {
          index: 2,
          title: '执行中任务',
          description: '',
          taskType: 'general',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-running',
          assignmentId: 'a2',
          runId: null,
          status: 'running',
        },
        {
          index: 3,
          title: '已完成任务',
          description: '',
          taskType: 'general',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-done',
          assignmentId: 'a3',
          runId: null,
          status: 'completed',
        },
        {
          index: 4,
          title: '失败任务',
          description: '',
          taskType: 'general',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-failed',
          assignmentId: 'a4',
          runId: null,
          status: 'failed',
        },
      ],
    });

    render(<PlanCard plan={plan} />);

    expect(screen.getByText('待开始任务')).toBeTruthy();
    expect(screen.getByText('执行中任务')).toBeTruthy();
    expect(screen.getByText('已完成任务')).toBeTruthy();
    expect(screen.getByText('失败任务')).toBeTruthy();
  });

  it('shows agent name on each task card', () => {
    const plan = makePlan({
      items: [
        {
          index: 1,
          title: '后端 API',
          description: '',
          taskType: 'backend',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-back',
          assignedAgentName: 'backend-agent',
          taskId: 'task-1',
          assignmentId: 'a1',
          runId: null,
          status: 'pending',
        },
      ],
    });

    render(<PlanCard plan={plan} />);

    expect(screen.getByText('@backend-agent')).toBeTruthy();
  });

  it('does not render DAG, dependency labels, or debug actions', () => {
    const plan = makePlan({
      dagPreview: {
        levels: [['t1', 't2'], ['t3']],
        text: 'Layer 1:\n  t1\n  t2\nLayer 2:\n  t3',
      },
      items: [
        {
          index: 1,
          plannerTaskId: 't1',
          title: '任务一',
          description: '描述',
          taskType: 'backend',
          expectedOutput: '',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-1',
          assignedAgentName: 'builder',
          taskId: 'task-1',
          assignmentId: 'a1',
          runId: null,
          status: 'completed',
          outputSummary: '已完成后端接口。',
        },
      ],
    });

    render(<PlanCard plan={plan} />);

    expect(screen.queryByText(/阶段 1/)).toBeNull();
    expect(screen.queryByText(/可并行/)).toBeNull();
    expect(screen.queryByText(/等待任务/)).toBeNull();
    expect(screen.queryByText('描述')).toBeNull();
    expect(screen.queryByRole('button', { name: '从 t1 重新执行' })).toBeNull();
    expect(screen.queryByText('重跑此任务')).toBeNull();
    expect(screen.queryByText('产物：已完成后端接口。')).toBeNull();
  });

  it('shows summary in header', () => {
    const plan = makePlan({ summary: '三个任务' });
    render(<PlanCard plan={plan} />);
    expect(screen.getByText('协作计划')).toBeTruthy();
  });

  it('opens work logs when a task with a run is clicked', () => {
    const plan = makePlan({
      items: [{
        index: 1,
        title: 'Create GET /health endpoint',
        description: '',
        assignedAgentId: 'agent-1',
        assignedAgentName: 'builder',
        taskId: 'task-1',
        assignmentId: 'assignment-1',
        runId: 'run-1',
        status: 'completed',
        dependsOn: [],
      }],
    });
    const run: ChatTimelineItem = {
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
      blocks: [],
      error: null,
    };
    const onOpenWorkLog = vi.fn();

    render(<PlanCard plan={plan} timeline={[run]} onOpenWorkLog={onOpenWorkLog} />);
    fireEvent.click(screen.getByText('Create GET /health endpoint'));

    expect(onOpenWorkLog).toHaveBeenCalledWith('run-1');
  });
});
