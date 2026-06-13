import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from './appState';
import { createTimelineItemFromRun, applyRunDetail } from './timeline';
import type { PlanCardModel, Run } from '../types';

function makeRun(runId: string, agentId: string): Run {
  return {
    id: runId,
    conversation_id: 'conv-1',
    task_id: `task-${runId}`,
    assignment_id: `assignment-${runId}`,
    agent_id: agentId,
    runtime_id: 'runtime-1',
    agent_session_id: `session-${agentId}`,
    source_message_id: null,
    workspace_id: 'workspace-1',
    prompt: `prompt-${runId}`,
    trigger_type: 'chat',
    trigger_source_id: 'conv-1',
    requested_by: 'user',
    status: 'running',
    pid: 123,
    exit_code: null,
    error_message: null,
    started_at: '2026-05-28T00:00:00.000Z',
    finished_at: null,
    events: [],
  };
}

function withTimeline(items = [makeRun('run-a', 'agent-a'), makeRun('run-b', 'agent-b'), makeRun('run-c', 'agent-c')]): AppState {
  return {
    ...initialState,
    selectedConvId: 'conv-1',
    messagesByConversation: {},
    timeline: {
      'conv-1': items.map((run) => createTimelineItemFromRun(run)),
    },
    activeRunIdsByConversation: {
      'conv-1': items.map((run) => run.id),
    },
  };
}

describe('AppContext reducer', () => {
  it('tracks multiple active runs in the same conversation', () => {
    const state = reducer(initialState, {
      type: 'ADD_ACTIVE_RUN',
      payload: { convId: 'conv-1', runId: 'run-a' },
    });
    const next = reducer(state, {
      type: 'ADD_ACTIVE_RUN',
      payload: { convId: 'conv-1', runId: 'run-b' },
    });

    expect(next.activeRunIdsByConversation['conv-1']).toEqual(['run-a', 'run-b']);
  });

  it('routes text and tool events only to the matching run card', () => {
    let state = withTimeline();

    state = reducer(state, {
      type: 'APPLY_TEXT_DELTA',
      payload: { convId: 'conv-1', runId: 'run-a', delta: 'hello' },
    });
    state = reducer(state, {
      type: 'APPLY_TOOL_STARTED',
      payload: {
        type: 'tool_started',
        runId: 'run-b',
        conversationId: 'conv-1',
        agentId: 'agent-b',
        taskId: 'task-run-b',
        toolUseId: 'tool-1',
        toolName: 'Read',
      },
    });

    const [runA, runB, runC] = state.timeline['conv-1'];
    expect(runA.blocks).toHaveLength(1);
    expect(runA.blocks[0]?.kind).toBe('agent_text');
    expect(runB.blocks).toHaveLength(1);
    expect(runB.blocks[0]?.kind).toBe('tool_call');
    expect(runC.blocks).toHaveLength(0);
  });

  it('updates only the target run when a run completes or is interrupted', () => {
    let state = withTimeline();

    state = reducer(state, {
      type: 'COMPLETE_RUN',
      payload: {
        convId: 'conv-1',
        runId: 'run-a',
        finalText: 'done',
        exitCode: 0,
      },
    });
    state = reducer(state, {
      type: 'FAIL_RUN',
      payload: {
        convId: 'conv-1',
        runId: 'run-b',
        error: 'Run interrupted by user',
        status: 'interrupted',
      },
    });

    const [runA, runB, runC] = state.timeline['conv-1'];
    expect(runA.status).toBe('completed');
    expect(runB.status).toBe('interrupted');
    expect(runC.status).toBe('running');
    expect(state.activeRunIdsByConversation['conv-1']).toEqual(['run-c']);
  });

  it('does not duplicate historical tool events when the same realtime event arrives again', () => {
    const historicalRun = {
      ...makeRun('run-a', 'agent-a'),
      events: [
        {
          id: 'evt-1',
          event_id: 'evt-1',
          run_id: 'run-a',
          conversation_id: 'conv-1',
          event_type: 'tool_started' as const,
          event_family: 'tool_started',
          dedup_key: 'run-a:1:tool_started',
          seq: 1,
          payload_json: {
            runId: 'run-a',
            conversationId: 'conv-1',
            agentId: 'agent-a',
            taskId: 'task-run-a',
            toolUseId: 'tool-1',
            toolName: 'Read',
          },
          occurred_at: '2026-05-28T00:00:00.000Z',
          created_at: '2026-05-28T00:00:00.000Z',
        },
      ],
    };
    let state: AppState = {
      ...initialState,
      selectedConvId: 'conv-1',
      messagesByConversation: {},
      timeline: {
        'conv-1': [applyRunDetail(historicalRun)],
      },
      activeRunIdsByConversation: {
        'conv-1': ['run-a'],
      },
    };

    state = reducer(state, {
      type: 'APPLY_TOOL_STARTED',
      payload: {
        type: 'tool_started',
        runId: 'run-a',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        taskId: 'task-run-a',
        toolUseId: 'tool-1',
        toolName: 'Read',
      },
    });

    expect(state.timeline['conv-1'][0]?.blocks).toHaveLength(1);
  });

  it('updates plan item status from run_status_changed and final run events', () => {
    const plan: PlanCardModel = {
      id: 'plan-1',
      conversationId: 'conv-1',
      prompt: 'do work',
      summary: 'summary',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: 'task a',
          description: 'task a',
          assignedAgentId: 'agent-a',
          assignedAgentName: 'agent-a',
          taskId: 'task-run-a',
          assignmentId: 'assignment-run-a',
          runId: 'run-a',
          status: 'queued',
        },
        {
          index: 2,
          title: 'task b',
          description: 'task b',
          assignedAgentId: 'agent-b',
          assignedAgentName: 'agent-b',
          taskId: 'task-run-b',
          assignmentId: 'assignment-run-b',
          runId: 'run-b',
          status: 'queued',
        },
        {
          index: 3,
          title: 'task c',
          description: 'task c',
          assignedAgentId: 'agent-c',
          assignedAgentName: 'agent-c',
          taskId: 'task-run-c',
          assignmentId: 'assignment-run-c',
          runId: 'run-c',
          status: 'queued',
        },
      ],
    };
    let state: AppState = {
      ...withTimeline([
        makeRun('run-a', 'agent-a'),
        makeRun('run-b', 'agent-b'),
        makeRun('run-c', 'agent-c'),
      ]),
      plansByConversation: {
        'conv-1': [plan],
      },
    };

    state = reducer(state, {
      type: 'APPLY_RUN_STATUS_CHANGED',
      payload: {
        type: 'run_status_changed',
        runId: 'run-a',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        taskId: 'task-run-a',
        status: 'running',
      },
    });
    state = reducer(state, {
      type: 'COMPLETE_RUN',
      payload: {
        convId: 'conv-1',
        runId: 'run-a',
        finalText: 'done',
        exitCode: 0,
      },
    });
    state = reducer(state, {
      type: 'FAIL_RUN',
      payload: {
        convId: 'conv-1',
        runId: 'run-b',
        error: 'boom',
        status: 'failed',
      },
    });
    state = reducer(state, {
      type: 'FAIL_RUN',
      payload: {
        convId: 'conv-1',
        runId: 'run-c',
        error: 'Run interrupted by user',
        status: 'interrupted',
      },
    });

    expect(state.plansByConversation['conv-1']?.[0]?.items[0]?.status).toBe('completed');
    expect(state.plansByConversation['conv-1']?.[0]?.items[1]?.status).toBe('failed');
    expect(state.plansByConversation['conv-1']?.[0]?.items[2]?.status).toBe('interrupted');
  });

  it('updates plan item by task when a task is cancelled or rerun', () => {
    const plan: PlanCardModel = {
      id: 'plan-1',
      conversationId: 'conv-1',
      prompt: 'do work',
      summary: 'summary',
      createdAt: '2026-05-28T00:00:00.000Z',
      items: [
        {
          index: 1,
          title: 'task a',
          description: 'task a',
          assignedAgentId: 'agent-a',
          assignedAgentName: 'agent-a',
          taskId: 'task-run-a',
          assignmentId: 'assignment-run-a',
          runId: 'run-a',
          status: 'completed',
        },
      ],
    };
    let state: AppState = {
      ...withTimeline([makeRun('run-a', 'agent-a')]),
      plansByConversation: {
        'conv-1': [plan],
      },
    };

    state = reducer(state, {
      type: 'UPDATE_PLAN_ITEM_TASK',
      payload: {
        convId: 'conv-1',
        taskId: 'task-run-a',
        status: 'cancelled',
      },
    });
    expect(state.plansByConversation['conv-1']?.[0]?.items[0]?.status).toBe('cancelled');

    state = reducer(state, {
      type: 'UPDATE_PLAN_ITEM_TASK',
      payload: {
        convId: 'conv-1',
        taskId: 'task-run-a',
        runId: 'run-a-rerun',
        assignmentId: 'assignment-run-a',
        status: 'queued',
      },
    });
    expect(state.plansByConversation['conv-1']?.[0]?.items[0]?.runId).toBe('run-a-rerun');
    expect(state.plansByConversation['conv-1']?.[0]?.items[0]?.status).toBe('queued');
  });
});
