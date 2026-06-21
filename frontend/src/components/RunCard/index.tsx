import { useMemo, useState } from 'react';
import type { ChatTimelineItem, ToolCallBlock } from '../../types';
import { AlertTriangle, RotateCcw } from '../ui/LineIcons';

function looksLikeMachineId(value: string) {
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    || /^[0-9a-f]{8,}-machine-id$/i.test(trimmed);
}

function getSafeAgentTitle(agentName: string | null | undefined, agentId: string | null | undefined) {
  const candidate = agentName?.trim() || agentId?.trim() || '';
  const fallback = /orchestrator/i.test(`${agentName ?? ''} ${agentId ?? ''}`) ? 'Orchestrator' : 'Agent';
  if (!candidate || looksLikeMachineId(candidate)) return fallback;
  return candidate;
}

function formatRunDuration(startedAt: string, finishedAt: string) {
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return '0s';
  const seconds = Math.max(1, Math.round((finish - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function getStatusText(item: ChatTimelineItem, toolBlocks: ToolCallBlock[]) {
  if (item.status === 'queued') return 'Waiting to start';
  if (item.status === 'running') {
    const runningTool = [...toolBlocks].reverse().find((block) => block.status === 'running');
    if (!runningTool) return 'Running';
    return `Running ${runningTool.toolName}${runningTool.inputPreview ? ` ${runningTool.inputPreview}` : ''}`;
  }
  if (item.status === 'completed') {
    const actions = toolBlocks.length > 0 ? ` · ${toolBlocks.length} actions` : '';
    const duration = item.finishedAt ? ` · ${formatRunDuration(item.startedAt, item.finishedAt)}` : '';
    return `Completed${actions}${duration}`;
  }
  if (item.status === 'failed') return item.error?.trim() || 'Execution failed';
  return 'Interrupted';
}

function StatusIndicator({ status }: { status: ChatTimelineItem['status'] }) {
  if (status === 'queued' || status === 'running') {
    return (
      <span
        className="h-3 w-3 shrink-0 animate-spin rounded-full border"
        style={{ borderColor: 'var(--app-accent)', borderTopColor: 'transparent' }}
        aria-hidden="true"
      />
    );
  }
  if (status === 'failed') {
    return <AlertTriangle size={14} className="shrink-0" style={{ color: 'var(--status-danger)' }} />;
  }
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: status === 'completed' ? 'var(--status-success)' : 'var(--status-warning)' }}
      aria-hidden="true"
    />
  );
}

export function RunCard({
  item,
  onOpenLogs,
  onRetry,
}: {
  item: ChatTimelineItem;
  onOpenLogs: (runId: string) => void;
  onRetry?: (item: ChatTimelineItem) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const toolBlocks = useMemo(
    () => item.blocks.filter((block): block is ToolCallBlock => block.kind === 'tool_call'),
    [item.blocks],
  );
  const agentTitle = getSafeAgentTitle(item.agentName, item.agentId);
  const statusText = getStatusText(item, toolBlocks);
  const failed = item.status === 'failed';

  async function handleRetry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetry(item);
    } catch (error: unknown) {
      setRetryError(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      data-run-id={item.runId}
      className={`group mr-auto flex cursor-pointer items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-gray-100 ${failed ? 'bg-red-50' : ''}`}
      style={{ color: 'var(--app-text-secondary)' }}
    >
      <button
        type="button"
        aria-label={`${agentTitle} ${statusText}`}
        onClick={() => onOpenLogs(item.runId)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
      >
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
          style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
          aria-hidden="true"
        >
          {agentTitle.slice(0, 1).toUpperCase()}
        </span>
        <span className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          {agentTitle}
        </span>
        <StatusIndicator status={item.status} />
        {retryError ? (
          <span role="alert" className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--status-danger)' }}>
            {retryError}
          </span>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-xs"
            style={failed ? { color: 'var(--status-danger)' } : undefined}
          >
            {statusText}
          </span>
        )}
      </button>
      {failed && onRetry && (
        <button
          type="button"
          aria-label="重试任务"
          title="重试任务"
          disabled={retrying}
          onClick={() => void handleRetry()}
          className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-[var(--card-strong)] disabled:cursor-wait"
          style={{ color: 'var(--status-danger)' }}
        >
          <RotateCcw size={14} className={retrying ? 'animate-spin' : undefined} />
        </button>
      )}
    </div>
  );
}
