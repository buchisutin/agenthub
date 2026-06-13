import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailDrawer, TaskPanel } from './index';
import type { Agent, PlanCardModel, Task, TaskAssignment, TaskDetail } from '../../types';

function makeAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    slug: name,
    platform: 'claude',
    adapter_type: 'claude_cli',
    instructions: null,
    status: 'active',
    capabilities: null,
    config_json: null,
    enabled: true,
    is_default: false,
    created_at: '2026-06-12T00:00:00.000Z',
    updated_at: '2026-06-12T00:00:00.000Z',
  };
}

describe('TaskPanel', () => {
  it('shows orchestrator task metadata in the right panel', () => {
    const tasks: Task[] = [
      {
        id: 'task-1',
        conversation_id: 'conv-1',
        source_message_id: null,
        plan_message_id: 'plan-msg-1',
        depends_on: ['t1'],
        title: 'Write health endpoint tests',
        description: 'Add tests',
        task_type: 'test',
        expected_output: 'Tests',
        status: 'pending',
        priority: 1,
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      },
    ];
    const assignments: TaskAssignment[] = [
      {
        id: 'assignment-1',
        task_id: 'task-1',
        conversation_id: 'conv-1',
        agent_id: 'agent-tester',
        status: 'pending',
        latest_run_id: null,
        assigned_at: '2026-06-12T00:00:00.000Z',
        started_at: null,
        completed_at: null,
      },
    ];
    const plans: PlanCardModel[] = [
      {
        id: 'plan-1',
        conversationId: 'conv-1',
        prompt: 'build health endpoint',
        summary: '拆成两个任务',
        createdAt: '2026-06-12T00:00:00.000Z',
        items: [
          {
            index: 2,
            title: 'Write health endpoint tests',
            description: 'Add tests',
            assignedAgentId: 'agent-tester',
            assignedAgentName: 'tester',
            taskId: 'task-1',
            assignmentId: 'assignment-1',
            runId: 'run-1',
            status: 'pending',
            dependsOn: ['Task 1'],
          },
        ],
      },
    ];

    render(
      <TaskPanel
        tasks={tasks}
        assignments={assignments}
        agents={[makeAgent('agent-tester', 'tester')]}
        plans={plans}
        onOpenTask={vi.fn()}
        onClose={vi.fn()}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('Write health endpoint tests')).toBeTruthy();
    expect(screen.getByText('@tester')).toBeTruthy();
    expect(screen.getByText('等待 Task 1')).toBeTruthy();
    expect(screen.getByText('Task 2')).toBeTruthy();
  });

  it('filters tasks and opens the selected task', () => {
    const onOpenTask = vi.fn();
    render(
      <TaskPanel
        tasks={[
          {
            id: 'task-1',
            conversation_id: 'conv-1',
            source_message_id: null,
            plan_message_id: null,
            title: 'Create endpoint',
            description: 'builder',
            task_type: 'backend',
            expected_output: null,
            status: 'completed',
            priority: 1,
            created_at: '2026-06-12T00:00:00.000Z',
            updated_at: '2026-06-12T00:00:00.000Z',
          },
        ]}
        assignments={[]}
        agents={[]}
        plans={[]}
        onOpenTask={onOpenTask}
        onClose={vi.fn()}
        loading={false}
        error={null}
      />,
    );

    fireEvent.click(screen.getByText('Create endpoint'));
    expect(onOpenTask).toHaveBeenCalledWith('task-1');
  });

  it('shows selected task output and resumes from the planner task id', () => {
    const onResumeFrom = vi.fn();
    const detail: TaskDetail = {
      task: {
        id: 'task-2',
        conversation_id: 'conv-1',
        source_message_id: null,
        plan_message_id: 'plan-msg-1',
        depends_on: ['t1'],
        title: 'Frontend integration',
        description: 'Use upstream API output',
        task_type: 'frontend',
        expected_output: 'Integrated UI',
        status: 'completed',
        priority: 1,
        created_at: '2026-06-12T00:00:00.000Z',
        updated_at: '2026-06-12T00:00:00.000Z',
      },
      assignments: [
        {
          id: 'assignment-2',
          task_id: 'task-2',
          conversation_id: 'conv-1',
          agent_id: 'agent-front',
          status: 'completed',
          latest_run_id: 'run-2',
          assigned_at: '2026-06-12T00:00:00.000Z',
          started_at: null,
          completed_at: null,
        },
      ],
      latestRun: {
        id: 'run-2',
        conversation_id: 'conv-1',
        task_id: 'task-2',
        assignment_id: 'assignment-2',
        agent_id: 'agent-front',
        runtime_id: null,
        agent_session_id: null,
        source_message_id: 'plan-msg-1',
        workspace_id: 'workspace-1',
        prompt: 'Use upstream API output',
        trigger_type: 'chat',
        trigger_source_id: 'conv-1',
        requested_by: 'user',
        status: 'completed',
        pid: null,
        exit_code: 0,
        error_message: null,
        started_at: '2026-06-12T00:00:00.000Z',
        finished_at: '2026-06-12T00:00:02.000Z',
        event_count: 0,
      },
    };

    render(
      <TaskDetailDrawer
        detail={detail}
        agents={[makeAgent('agent-front', 'frontend-agent')]}
        planItem={{
          index: 2,
          plannerTaskId: 't2',
          title: 'Frontend integration',
          description: 'Use upstream API output',
          assignedAgentId: 'agent-front',
          assignedAgentName: 'frontend-agent',
          taskId: 'task-2',
          assignmentId: 'assignment-2',
          runId: 'run-2',
          status: 'completed',
          dependsOn: ['t1'],
          outputSummary: 'Frontend now consumes the login API.',
        }}
        loading={false}
        error={null}
        actionLoading={null}
        actionError={null}
        onClose={vi.fn()}
        onCancelTask={vi.fn()}
        onRerunTask={vi.fn()}
        onResumeFromPlan={onResumeFrom}
      />,
    );

    expect(screen.getByText('编排任务')).toBeTruthy();
    expect(screen.getByText('t2')).toBeTruthy();
    expect(screen.getByText('上游依赖')).toBeTruthy();
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.getByText('任务产物')).toBeTruthy();
    expect(screen.getByText('Frontend now consumes the login API.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '从 t2 重新执行' }));
    expect(onResumeFrom).toHaveBeenCalledWith('t2');
  });
});
