import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunCard } from './index';
import type { ChatTimelineItem, ToolCallBlock } from '../../types';

function makeTool(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
  return {
    kind: 'tool_call',
    id: 'tool-1',
    toolUseId: 'tool-use-1',
    toolName: 'Read',
    status: 'completed',
    inputPreview: 'src/app.tsx',
    input: null,
    partialJson: '',
    summary: null,
    resultContent: null,
    expanded: false,
    resultKind: 'read',
    ...overrides,
  };
}

function makeRun(overrides: Partial<ChatTimelineItem> = {}): ChatTimelineItem {
  return {
    id: 'run-1',
    conversationId: 'conv-1',
    runId: 'run-1',
    taskId: null,
    agentId: 'agent-1',
    agentName: 'frontend-agent',
    agentSessionId: null,
    prompt: 'test prompt',
    status: 'completed',
    startedAt: '2026-05-28T00:00:00.000Z',
    finishedAt: '2026-05-28T00:01:05.000Z',
    blocks: [],
    error: null,
    ...overrides,
  };
}

function renderRunCard(
  item: ChatTimelineItem,
  onOpenLogs = vi.fn(),
  onRetry?: (item: ChatTimelineItem) => Promise<void>,
) {
  render(<RunCard item={item} onOpenLogs={onOpenLogs} onRetry={onRetry} />);
  return { onOpenLogs };
}

describe('RunCard', () => {
  it('shows the latest running tool without rendering inline execution content', () => {
    renderRunCard(makeRun({
      status: 'running',
      finishedAt: null,
      blocks: [
        { kind: 'agent_text', id: 'text-1', content: 'Long agent explanation' },
        makeTool({ id: 'tool-old', toolName: 'Read', status: 'running', inputPreview: 'README.md' }),
        makeTool({
          id: 'tool-latest',
          toolName: 'Bash',
          status: 'running',
          inputPreview: 'npm test',
          resultContent: 'terminal output that must stay hidden',
          resultKind: 'bash',
        }),
      ],
    }));

    expect(screen.getByText('Running Bash npm test')).toBeTruthy();
    expect(screen.queryByText('Long agent explanation')).toBeNull();
    expect(screen.queryByText('terminal output that must stay hidden')).toBeNull();
    expect(screen.queryByText('EXECUTED TOOLS')).toBeNull();
  });

  it('shows completed action count and duration', () => {
    renderRunCard(makeRun({
      blocks: [makeTool(), makeTool({ id: 'tool-2', toolUseId: 'tool-use-2', toolName: 'Write' })],
    }));

    expect(screen.getByText('Completed · 2 actions · 1m 5s')).toBeTruthy();
  });

  it('omits duration when a completed run has no finished time', () => {
    renderRunCard(makeRun({ status: 'completed', finishedAt: null }));

    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.queryByText(/进行中/)).toBeNull();
  });

  it('opens logs for the selected run when clicked', () => {
    const onOpenLogs = vi.fn();
    renderRunCard(makeRun({ runId: 'run-selected' }), onOpenLogs);

    fireEvent.click(screen.getByRole('button', { name: /frontend-agent.*Completed/ }));

    expect(onOpenLogs).toHaveBeenCalledWith('run-selected');
  });

  it('does not open logs when the run card wrapper is clicked', () => {
    const onOpenLogs = vi.fn();
    renderRunCard(makeRun(), onOpenLogs);

    fireEvent.click(screen.getByText('frontend-agent').closest('[data-run-id]')!);

    expect(onOpenLogs).not.toHaveBeenCalled();
  });

  it('uses danger styling for failed status text', () => {
    renderRunCard(makeRun({ status: 'failed', error: 'Build failed' }));

    expect(screen.getByText('Build failed').style.color).toBe('var(--status-danger)');
  });

  it('retries a failed run without opening logs', async () => {
    const onOpenLogs = vi.fn();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const item = makeRun({ status: 'failed', error: 'Build failed' });
    renderRunCard(item, onOpenLogs, onRetry);

    fireEvent.click(screen.getByRole('button', { name: '重试任务' }));

    await waitFor(() => expect(onRetry).toHaveBeenCalledWith(item));
    expect(onOpenLogs).not.toHaveBeenCalled();
  });

  it('allows only one retry while the retry promise is pending', async () => {
    let resolveRetry!: () => void;
    const pendingRetry = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    const onRetry = vi.fn().mockReturnValue(pendingRetry);
    renderRunCard(makeRun({ status: 'failed', error: 'Build failed' }), vi.fn(), onRetry);

    const retryButton = screen.getByRole('button', { name: '重试任务' }) as HTMLButtonElement;
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(retryButton.disabled).toBe(true);
    expect(retryButton.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);

    resolveRetry();
    await waitFor(() => expect(retryButton.disabled).toBe(false));
  });

  it('shows a retry error only within the failed run pill', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('Retry service unavailable'));
    renderRunCard(makeRun({ runId: 'failed-1', status: 'failed', error: 'First failure' }), vi.fn(), onRetry);
    renderRunCard(makeRun({ runId: 'failed-2', status: 'failed', error: 'Second failure' }), vi.fn(), vi.fn());

    const retries = screen.getAllByRole('button', { name: '重试任务' });
    fireEvent.click(retries[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Retry service unavailable');
    expect(alert.closest('[data-run-id]')?.getAttribute('data-run-id')).toBe('failed-1');
  });

  it('masks machine ids used as agent names', () => {
    renderRunCard(makeRun({
      runId: 'machine-id-run',
      agentId: '75b3e7cc-machine-id',
      agentName: null,
    }));
    renderRunCard(makeRun({
      runId: 'uuid-name-run',
      agentName: '75b3e7cc-7110-4d7d-a501-2e89c64bb031',
    }));
    renderRunCard(makeRun({
      runId: 'descriptive-name-run',
      agentName: 'deadbeef-support-agent',
    }));

    expect(screen.getAllByText('Agent')).toHaveLength(2);
    expect(screen.queryByText('75b3e7cc-machine-id')).toBeNull();
    expect(screen.queryByText('75b3e7cc-7110-4d7d-a501-2e89c64bb031')).toBeNull();
    expect(screen.getByText('deadbeef-support-agent')).toBeTruthy();
  });

  it('keeps descriptive hyphenated agent names visible', () => {
    renderRunCard(makeRun({ agentName: 'customer-support-specialist' }));

    expect(screen.getByText('customer-support-specialist')).toBeTruthy();
  });
});
