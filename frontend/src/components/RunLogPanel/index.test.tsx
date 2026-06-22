import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import type { ChatTimelineItem, Run } from '../../types';
import { RunLogPanel } from './index';

vi.mock('../../services/api', () => ({
  api: {
    getRun: vi.fn(),
  },
}));

const mockedGetRun = vi.mocked(api.getRun);

function makeSummaryItem(overrides: Partial<ChatTimelineItem> = {}): ChatTimelineItem {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    runId: 'run-1',
    taskId: null,
    agentId: 'agent-1',
    agentName: 'claude-code',
    agentSessionId: null,
    prompt: 'Run the test suite',
    status: 'completed',
    startedAt: '2026-06-19T00:00:00.000Z',
    finishedAt: '2026-06-19T00:00:10.000Z',
    detailsLoaded: false,
    blocks: [],
    error: null,
    ...overrides,
  };
}

function makeDetailedItem(): ChatTimelineItem {
  return makeSummaryItem({
    detailsLoaded: true,
    blocks: [
      { kind: 'agent_text', id: 'text-1', content: 'Agent answer' },
      {
        kind: 'tool_call',
        id: 'tool-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        status: 'completed',
        inputPreview: 'npm test',
        input: { command: 'npm test' },
        partialJson: '',
        summary: 'completed',
        resultContent: 'tests passed',
        expanded: false,
        resultKind: 'bash',
      },
    ],
  });
}

function makeRunWithEvents(): Run {
  return {
    id: 'run-1',
    conversation_id: 'conv-1',
    task_id: null,
    assignment_id: null,
    agent_id: 'agent-1',
    runtime_id: null,
    agent_session_id: null,
    source_message_id: null,
    workspace_id: 'workspace-1',
    prompt: 'Run the test suite',
    trigger_type: 'chat',
    trigger_source_id: 'conv-1',
    requested_by: 'user',
    status: 'completed',
    pid: null,
    exit_code: 0,
    error_message: null,
    started_at: '2026-06-19T00:00:00.000Z',
    finished_at: '2026-06-19T00:00:10.000Z',
    events: [
      {
        id: 'event-1',
        event_id: 'event-1',
        run_id: 'run-1',
        conversation_id: 'conv-1',
        event_type: 'text_delta',
        event_family: 'text_delta',
        dedup_key: 'run-1:1:text_delta',
        seq: 1,
        payload_json: { delta: 'Loaded answer' },
        occurred_at: '2026-06-19T00:00:01.000Z',
        created_at: '2026-06-19T00:00:01.000Z',
      },
    ],
  };
}

describe('RunLogPanel', () => {
  beforeEach(() => {
    mockedGetRun.mockReset();
  });

  it('renders complete Agent and tool output in the isolated panel', () => {
    render(<RunLogPanel item={makeDetailedItem()} onInterrupt={vi.fn()} />);

    expect(screen.getByText('Agent answer')).toBeTruthy();
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(screen.getByText('tests passed')).toBeTruthy();
    expect(mockedGetRun).not.toHaveBeenCalled();
  });

  it('loads full run detail when timeline blocks are incomplete', async () => {
    mockedGetRun.mockResolvedValue(makeRunWithEvents());

    render(<RunLogPanel item={makeSummaryItem()} onInterrupt={vi.fn()} />);

    await waitFor(() => expect(mockedGetRun).toHaveBeenCalledWith('run-1'));
    expect(await screen.findByText('Loaded answer')).toBeTruthy();
  });

  it('reloads the selected run after detail loading fails', async () => {
    mockedGetRun
      .mockRejectedValueOnce(new Error('detail unavailable'))
      .mockResolvedValueOnce(makeRunWithEvents());

    render(<RunLogPanel item={makeSummaryItem()} onInterrupt={vi.fn()} />);

    expect(await screen.findByText('detail unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载日志' }));

    expect(await screen.findByText('Loaded answer')).toBeTruthy();
    expect(mockedGetRun).toHaveBeenCalledTimes(2);
  });

  it('offers interrupt only while the selected run is active', () => {
    const onInterrupt = vi.fn();
    render(
      <RunLogPanel
        item={makeDetailedItem()}
        onInterrupt={onInterrupt}
        isActive
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '中断执行' }));
    expect(onInterrupt).toHaveBeenCalledWith('run-1');
  });
});
