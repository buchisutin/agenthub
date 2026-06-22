import { useMemo, useState } from 'react';
import type { ApprovalRequestBlock, ChatTimelineItem, FileChangeIndicatorBlock, OrchestratorPlanningState, PlanCardModel, ToolCallBlock } from '../../types';
import { Badge } from '../ui/Badge';
import { ChevronDown } from '../ui/LineIcons';

function classifyStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' {
  const s = status.toLowerCase();
  if (s === 'completed' || s === 'done') return 'completed';
  if (s === 'failed' || s === 'interrupted' || s === 'cancelled') return 'failed';
  if (s === 'running' || s === 'in_progress' || s === 'queued') return 'running';
  return 'pending';
}

function formatDuration(startedAt: string, finishedAt: string | null | undefined): string | null {
  if (!finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return null;
  const s = Math.max(1, Math.round((finish - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

interface TaskRunData {
  run: ChatTimelineItem;
  runningAction: string | null;
  fileChangeCount: number;
  duration: string | null;
  approvals: ApprovalRequestBlock[];
}

function extractRunData(run: ChatTimelineItem | undefined): TaskRunData | null {
  if (!run) return null;
  const runningTool = [...run.blocks].reverse().find(
    (b): b is ToolCallBlock => b.kind === 'tool_call' && b.status === 'running',
  );
  const fileChanges = run.blocks.filter(
    (b): b is FileChangeIndicatorBlock => b.kind === 'file_change_indicator',
  );
  const approvals = run.blocks.filter(
    (b): b is ApprovalRequestBlock => b.kind === 'approval_request' && b.status === 'pending',
  );
  return {
    run,
    runningAction: runningTool ? `${runningTool.toolName} ${runningTool.inputPreview}` : null,
    fileChangeCount: fileChanges.length,
    duration: formatDuration(run.startedAt, run.finishedAt),
    approvals,
  };
}

type KanbanCol = 'pending' | 'running' | 'attention' | 'done';

function StatusRing({ col, size = 13 }: { col: KanbanCol; size?: number }) {
  const sw = 1.5;
  // filled shapes use rFill; stroke-only circle uses rStroke so outer edges align
  const rFill = size / 2 - 1;
  const rStroke = rFill - sw / 2;
  const cx = size / 2;
  const cy = size / 2;

  if (col === 'pending') {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className="flex-shrink-0">
        <circle cx={cx} cy={cy} r={rStroke} stroke="#B4B2A9" strokeWidth={sw} />
      </svg>
    );
  }

  if (col === 'running') {
    return (
      <div
        className="flex-shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          border: `${sw}px solid #1d892d`,
          padding: 2,
          backgroundImage: 'conic-gradient(from 0deg, #1d892d 50%, transparent 50%)',
          backgroundClip: 'content-box',
        }}
      />
    );
  }

  if (col === 'attention') {
    return (
      <div
        className="flex-shrink-0 rounded-full"
        style={{
          width: size,
          height: size,
          border: `${sw}px solid #E8A010`,
          padding: 2,
          backgroundImage: 'conic-gradient(from 0deg, #E8A010 75%, transparent 75%)',
          backgroundClip: 'content-box',
        }}
      />
    );
  }

  const checkSize = rFill * 0.55;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className="flex-shrink-0">
      <circle cx={cx} cy={cy} r={rFill} fill="#1A6BCC" />
      <polyline
        points={`${cx - checkSize * 0.6},${cy} ${cx - checkSize * 0.1},${cy + checkSize * 0.55} ${cx + checkSize * 0.7},${cy - checkSize * 0.45}`}
        stroke="white"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getKanbanCol(item: PlanCardModel['items'][number], runData: TaskRunData | null): KanbanCol {
  const status = classifyStatus(runData?.run.status ?? item.status);
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'attention';
  if (status === 'running') return 'running';
  if (runData && runData.approvals.length > 0) return 'attention';
  if (item.status === 'blocked' || item.status === 'in_review') return 'attention';
  return 'pending';
}

function TaskKanbanCard({
  item,
  runData,
  col,
  onOpenWorkLog,
}: {
  item: PlanCardModel['items'][number];
  runData: TaskRunData | null;
  col: KanbanCol;
  onOpenWorkLog?: (runId: string) => void;
}) {
  const status = classifyStatus(runData?.run.status ?? item.status);
  const isFailed = status === 'failed';
  const hasPendingApprovals = (runData?.approvals.length ?? 0) > 0;
  const isBlocked = item.status === 'blocked' || item.status === 'in_review';

  const handleClick = onOpenWorkLog && runData
    ? () => onOpenWorkLog(runData.run.runId)
    : undefined;

  return (
    <div
      className="rounded-lg p-2.5 flex flex-col gap-2 bg-white border border-transparent shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:bg-gray-50 hover:border-gray-200 hover:shadow-md cursor-pointer transition-all duration-200"
      onClick={handleClick}
    >
      <div className="text-xs font-medium leading-snug" style={{ color: 'var(--app-text)' }}>
        {item.title}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
          @{item.assignedAgentName}
        </span>
      </div>

      {col === 'running' && runData && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] truncate" style={{ color: '#3B6D11' }}>
            {runData.runningAction ?? '执行中...'}
          </span>
        </div>
      )}

      {col === 'attention' && isFailed && (
        <span className="text-[11px] truncate" style={{ color: '#A32D2D' }}>
          {runData?.run.error?.trim() || '执行失败'}
        </span>
      )}

      {col === 'attention' && hasPendingApprovals && (
        <span className="text-[11px]" style={{ color: '#854F0B' }}>
          {runData!.approvals.length} 项待批准
        </span>
      )}

      {col === 'attention' && isBlocked && !isFailed && !hasPendingApprovals && (
        <span className="text-[11px]" style={{ color: '#854F0B' }}>已阻塞</span>
      )}

      {col === 'done' && runData && runData.fileChangeCount > 0 && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--card-subtle)', color: 'var(--app-text-secondary)' }}
        >
          {runData.fileChangeCount} files
        </span>
      )}
    </div>
  );
}

const COLUMNS: { key: KanbanCol; label: string }[] = [
  { key: 'pending', label: '等待中' },
  { key: 'running', label: '执行中' },
  { key: 'attention', label: '需要处理' },
  { key: 'done', label: '已完成' },
];

export function PlanCard({
  plan,
  timeline,
  onOpenWorkLog,
  onExecute,
}: {
  plan: PlanCardModel;
  timeline?: ChatTimelineItem[];
  onOpenWorkLog?: (runId: string) => void;
  onExecute?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const runMap = useMemo(() => {
    const m = new Map<string, ChatTimelineItem>();
    if (timeline) for (const item of timeline) m.set(item.runId, item);
    return m;
  }, [timeline]);

  const runDataByItem = useMemo(() => {
    const m = new Map<string, TaskRunData | null>();
    for (const item of plan.items) {
      const run = item.runId ? runMap.get(item.runId) : undefined;
      m.set(item.taskId, extractRunData(run));
    }
    return m;
  }, [plan.items, runMap]);

  const colMap = useMemo(() => {
    const m = new Map<KanbanCol, PlanCardModel['items']>();
    for (const col of COLUMNS) m.set(col.key, []);
    for (const item of plan.items) {
      const runData = runDataByItem.get(item.taskId) ?? null;
      const col = getKanbanCol(item, runData);
      m.get(col)!.push(item);
    }
    return m;
  }, [plan.items, runDataByItem]);

  const completedCount = (colMap.get('done') ?? []).length;
  const totalCount = plan.items.length;
  const runningCount = (colMap.get('running') ?? []).length;
  const attentionCount = (colMap.get('attention') ?? []).length;
  const allDone = completedCount === totalCount && totalCount > 0;
  const allItemsPending = plan.items.every((item) => item.status === 'pending');
  const isPreview = plan.preview === true;

  const totalFileChanges = useMemo(() => {
    let count = 0;
    for (const [, data] of runDataByItem) if (data) count += data.fileChangeCount;
    return count;
  }, [runDataByItem]);

  const summaryText = useMemo(() => {
    if (allDone) {
      let text = '所有任务已完成';
      if (totalFileChanges > 0) text += ` · ${totalFileChanges} 个文件`;
      return text;
    }
    const parts: string[] = [`${completedCount}/${totalCount} 完成`];
    if (runningCount > 0) parts.push(`${runningCount} 执行中`);
    if (attentionCount > 0) parts.push(`${attentionCount} 需处理`);
    return parts.join(' · ');
  }, [allDone, completedCount, totalCount, runningCount, attentionCount, totalFileChanges]);

  return (
    <div className="agenthub-card w-full overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="font-semibold text-gray-700">协作计划</span>
          <span className="text-gray-300">·</span>
          <span className="truncate text-gray-500">{summaryText}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-400">{completedCount}/{totalCount}</span>
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: expanded ? '5000px' : '0' }}
      >
        <div
          className="grid gap-2 px-4 pb-4 pt-1"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
        >
          {COLUMNS.map(({ key, label }) => {
            const items = colMap.get(key) ?? [];
            return (
              <div
                key={key}
                className="rounded-lg p-2 flex flex-col gap-1.5"
                style={{
                  background: key === 'attention' ? '#fdfbf4' : key === 'done' ? '#f3f8fe' : key === 'running' ? '#f5f9f5' : '#fbfbfb',
                }}
              >
                <div className="flex items-center justify-between px-0.5 mb-1">
                  <div className="flex items-center gap-1.5">
                    <StatusRing col={key} size={13} />
                    <span className="text-[11px] font-medium" style={{ color: 'var(--app-text-secondary)' }}>
                      {label}
                    </span>
                  </div>
                  <span
                    className="text-[11px] px-1.5 rounded-full"
                    style={{
                      background: 'var(--card-bg)',
                      border: '0.5px solid var(--app-border)',
                      color: 'var(--app-text-secondary)',
                      lineHeight: '18px',
                    }}
                  >
                    {items.length}
                  </span>
                </div>
                {items.map((item) => (
                  <TaskKanbanCard
                    key={item.taskId}
                    item={item}
                    runData={runDataByItem.get(item.taskId) ?? null}
                    col={key}
                    onOpenWorkLog={onOpenWorkLog}
                  />
                ))}
              </div>
            );
          })}
        </div>
        {isPreview && allItemsPending && onExecute && (
          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={onExecute}
              className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: '#1D4ED8' }}
            >
              开始执行
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function OrchestratorPlanningCard({ planning }: { planning: OrchestratorPlanningState }) {
  const preview = planning.output.trim();
  return (
    <div className="agenthub-card overflow-hidden">
      <div className="space-y-3 px-5 py-4" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>Orchestrator 正在规划</div>
          <Badge variant="running">Planning</Badge>
        </div>
        {planning.prompt ? (
          <div className="line-clamp-2 text-[13px]" style={{ color: 'var(--app-text-secondary)' }}>{planning.prompt}</div>
        ) : null}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-1 px-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: 'var(--color-accent)', animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <div className="whitespace-pre-wrap rounded-lg px-3 py-3 text-sm" style={{ backgroundColor: 'var(--card-subtle)', color: preview ? 'var(--app-text)' : 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}>
          {preview || '正在分析请求并拆解任务...'}
        </div>
      </div>
    </div>
  );
}
