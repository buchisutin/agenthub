import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketService } from './socket';

const handlers = new Map<string, (payload: unknown) => void>();
const fakeSocket = {
  connected: false,
  on: vi.fn((event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  }),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

describe('SocketService', () => {
  beforeEach(() => {
    handlers.clear();
    fakeSocket.on.mockClear();
    fakeSocket.emit.mockClear();
    fakeSocket.disconnect.mockClear();
    fakeSocket.connected = false;
  });

  it('dedupes duplicate runtime events by eventId before dispatching handlers', () => {
    const service = new SocketService();
    const onTextDelta = vi.fn();

    service.setHandlers({ onTextDelta });
    service.connect();

    const event = {
      eventId: 'evt-1',
      type: 'text_delta',
      runId: 'run-1',
      conversationId: 'conv-1',
      agentId: 'agent-1',
      taskId: 'task-1',
      delta: 'hello',
    };

    handlers.get('text_delta')?.(event);
    handlers.get('text_delta')?.(event);

    expect(onTextDelta).toHaveBeenCalledTimes(1);
  });
});
