import type { ChatTimelineItem } from '../../types';
import { RunLogPanel } from '../RunLogPanel';

interface TaskWorkLogPanelProps {
  open: boolean;
  item: ChatTimelineItem | null;
  taskTitle: string;
  onClose: () => void;
  onInterrupt: (runId: string) => void;
}

export function TaskWorkLogPanel({
  open,
  item,
  taskTitle,
  onClose,
  onInterrupt,
}: TaskWorkLogPanelProps) {
  if (!open) return null;

  return (
    <aside
      aria-label="工作日志"
      className="absolute inset-y-0 right-0 z-20 flex w-[420px] flex-col overflow-hidden bg-white"
      style={{ borderLeft: '0.5px solid var(--app-border)', boxShadow: '-4px 0 16px rgba(0,0,0,0.05)' }}
    >
      <header
        className="flex items-start justify-between gap-3 px-5 py-4"
        style={{ borderBottom: '0.5px solid var(--app-border)' }}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--app-text)]">{taskTitle}</div>
          <div className="mt-1 text-xs text-[var(--app-text-secondary)]">
            @{item?.agentName ?? 'Agent'} · {item?.status ?? 'waiting'}
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-[var(--app-text-secondary)]">
          Close
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-5">
        <RunLogPanel
          item={item}
          isActive={item?.status === 'queued' || item?.status === 'running'}
          onInterrupt={onInterrupt}
        />
      </div>
    </aside>
  );
}
