import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlanCard } from './index';
import type { PlanCardModel } from '../../types';

describe('PlanCard', () => {
  it('renders plan items without debug actions in each task row', () => {
    const plan: PlanCardModel = {
      id: 'plan-1',
      conversationId: 'conv-1',
      prompt: '做一个博客系统',
      summary: '拆成前后端两个任务',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '前端页面',
          description: '做页面',
          taskType: 'frontend',
          expectedOutput: 'Build the login UI.',
          affectedFiles: ['frontend/src/App.tsx', 'frontend/src/components/*'],
          dependsOn: [],
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          runId: 'run-1',
          status: 'running',
        },
      ],
    };

    render(<PlanCard plan={plan} />);

    expect(screen.queryByText('拆成前后端两个任务')).toBeNull();
    expect(screen.getByText('Task 1')).toBeTruthy();
    expect(screen.getByText('Frontend')).toBeTruthy();
    expect(screen.getByText('@frontend-agent')).toBeTruthy();
    expect(screen.getByText('无依赖，可立即开始')).toBeTruthy();
    expect(screen.queryByText('做页面')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View Task' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看产物' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View Run' })).toBeNull();
  });

  it('renders task dependency labels', () => {
    const plan: PlanCardModel = {
      id: 'plan-2',
      conversationId: 'conv-2',
      prompt: '做一个带依赖的计划',
      summary: '先后端，再前端和测试',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: '后端 API',
          description: '先做后端',
          taskType: 'backend',
          expectedOutput: 'API ready.',
          affectedFiles: ['server/src/app.ts'],
          dependsOn: [],
          assignedAgentId: 'agent-back',
          assignedAgentName: 'backend-agent',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          runId: 'run-1',
          status: 'completed',
        },
        {
          index: 2,
          title: '前端页面',
          description: '等后端完成',
          taskType: 'frontend',
          expectedOutput: 'UI ready.',
          affectedFiles: ['frontend/src/App.tsx'],
          dependsOn: ['t1'],
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-2',
          assignmentId: 'assignment-2',
          runId: 'run-2',
          status: 'pending',
        },
        {
          index: 3,
          title: '集成测试',
          description: '等前端和测试完成',
          taskType: 'test',
          expectedOutput: 'Integration tests.',
          affectedFiles: ['server/tests/*'],
          dependsOn: ['t1', 't2'],
          assignedAgentId: 'agent-test',
          assignedAgentName: 'tester-agent',
          taskId: 'task-3',
          assignmentId: 'assignment-3',
          runId: 'run-3',
          status: 'blocked',
        },
      ],
    };

    render(<PlanCard plan={plan} />);

    expect(screen.getByText('无依赖，可立即开始')).toBeTruthy();
    expect(screen.getByText('等待任务 t1')).toBeTruthy();
    expect(screen.getByText('等待任务 t1, t2')).toBeTruthy();
  });

  it('renders DAG layers as IM rich-card stages without inline rerun actions', () => {
    const plan: PlanCardModel = {
      id: 'plan-dag',
      conversationId: 'conv-dag',
      prompt: '@orchestrator 做登录功能',
      summary: '按依赖拆解登录功能',
      dagPreview: {
        levels: [['t1', 't2'], ['t3']],
        text: 'Layer 1:\n  t1 后端接口\n  t2 数据模型\n\nLayer 2:\n  t3 前端接入 depends on t1,t2',
      },
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          plannerTaskId: 't1',
          title: '后端接口',
          description: '实现登录接口',
          taskType: 'backend',
          expectedOutput: 'API ready.',
          affectedFiles: ['server/src/auth.ts'],
          dependsOn: [],
          assignedAgentId: 'agent-back',
          assignedAgentName: 'backend-agent',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          runId: 'run-1',
          status: 'completed',
          outputSummary: '登录接口已完成，包含 POST /login。',
        },
        {
          index: 2,
          plannerTaskId: 't2',
          title: '数据模型',
          description: '实现数据模型',
          taskType: 'backend',
          expectedOutput: 'Model ready.',
          affectedFiles: [],
          dependsOn: [],
          assignedAgentId: 'agent-back',
          assignedAgentName: 'backend-agent',
          taskId: 'task-2',
          assignmentId: 'assignment-2',
          runId: 'run-2',
          status: 'completed',
        },
        {
          index: 3,
          plannerTaskId: 't3',
          title: '前端接入',
          description: '接入登录接口',
          taskType: 'frontend',
          expectedOutput: 'UI ready.',
          affectedFiles: ['frontend/src/App.tsx'],
          dependsOn: ['t1', 't2'],
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-3',
          assignmentId: 'assignment-3',
          runId: null,
          status: 'pending',
        },
      ],
    };

    render(<PlanCard plan={plan} />);

    expect(screen.getByText('阶段 1 · 可并行')).toBeTruthy();
    expect(screen.getByText('阶段 2 · 等待 t1, t2')).toBeTruthy();
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.getByText('t3')).toBeTruthy();
    expect(screen.queryByText('实现登录接口')).toBeNull();
    expect(screen.queryByText('产物：登录接口已完成，包含 POST /login。')).toBeNull();
    expect(screen.queryByRole('button', { name: '从 t3 重新执行' })).toBeNull();
    expect(screen.queryByText('重跑此任务')).toBeNull();
  });
});
