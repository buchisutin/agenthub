import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../services/api';
import { loadConversationRuntime } from './runtimeActions';

vi.mock('../services/api', () => ({
  api: {
    getWorkspace: vi.fn(),
    getConversationTimeline: vi.fn(),
    getRun: vi.fn(),
  },
}));

describe('loadConversationRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWorkspace).mockResolvedValue(null);
  });

  it('hydrates run events so completed replies survive a timeline reload', async () => {
    vi.mocked(api.getConversationTimeline).mockResolvedValue([
      {
        type: 'run',
        run: {
          id: 'run-1',
          conversation_id: 'conv-1',
          task_id: null,
          assignment_id: null,
          agent_id: 'agent-1',
          runtime_id: null,
          agent_session_id: null,
          source_message_id: null,
          workspace_id: 'workspace-1',
          prompt: '你好',
          trigger_type: 'chat',
          trigger_source_id: null,
          requested_by: null,
          status: 'completed',
          pid: null,
          exit_code: 0,
          error_message: null,
          started_at: '2026-06-21T10:23:32.000Z',
          finished_at: '2026-06-21T10:23:35.000Z',
          event_count: 2,
        },
      },
    ]);
    vi.mocked(api.getRun).mockResolvedValue({
      id: 'run-1',
      conversation_id: 'conv-1',
      task_id: null,
      assignment_id: null,
      agent_id: 'agent-1',
      runtime_id: null,
      agent_session_id: null,
      source_message_id: null,
      workspace_id: 'workspace-1',
      prompt: '你好',
      trigger_type: 'chat',
      trigger_source_id: null,
      requested_by: null,
      status: 'completed',
      pid: null,
      exit_code: 0,
      error_message: null,
      started_at: '2026-06-21T10:23:32.000Z',
      finished_at: '2026-06-21T10:23:35.000Z',
      events: [
        {
          id: 'event-1',
          event_id: 'event-1',
          run_id: 'run-1',
          conversation_id: 'conv-1',
          event_type: 'text_delta',
          event_family: 'runtime',
          dedup_key: 'run-1:1:text_delta',
          seq: 1,
          payload_json: { delta: '你好，我可以正常回复。' },
          occurred_at: '2026-06-21T10:23:34.000Z',
          created_at: '2026-06-21T10:23:34.000Z',
        },
      ],
    });
    const dispatch = vi.fn();

    const result = await loadConversationRuntime('conv-1', dispatch);

    expect(api.getRun).toHaveBeenCalledWith('run-1');
    expect(result.items[0].blocks).toEqual([
      expect.objectContaining({ kind: 'agent_text', content: '你好，我可以正常回复。' }),
    ]);
  });
});
