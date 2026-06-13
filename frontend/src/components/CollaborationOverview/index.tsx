import type { ChatTimelineItem, PlanCardModel } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';

export type ArtifactTab = 'tasks' | 'diff' | 'preview' | 'summary';

interface CollaborationOverviewProps {
  plans: PlanCardModel[];
  timeline: ChatTimelineItem[];
  activeRunIds: string[];
  onOpenArtifacts: (tab: ArtifactTab) => void;
}

function getLatestPlan(plans: PlanCardModel[]) {
  return [...plans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] ?? null;
}

export function CollaborationOverview({
  plans,
  timeline,
  activeRunIds,
  onOpenArtifacts,
}: CollaborationOverviewProps) {
  const plan = getLatestPlan(plans);
  const totalTasks = plan?.items.length ?? 0;
  const completedTasks = plan?.items.filter((item) => item.status === 'completed').length ?? 0;
  const activeRuns = timeline.filter((item) => activeRunIds.includes(item.runId));
  const attentionRuns = timeline.filter((item) => item.status === 'failed' || item.status === 'interrupted');
  const completedRuns = timeline.filter((item) => item.status === 'completed').length;

  if (!plan && timeline.length === 0) {
    return (
      <section className="agenthub-card px-5 py-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
          当前协作
        </div>
        <div className="mt-2 text-sm" style={{ color: 'var(--app-text-secondary)' }}>
          还没有协作任务
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          发送 @orchestrator 或 @agent 开始。
        </div>
      </section>
    );
  }

  return (
    <section className="agenthub-card px-5 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
            当前协作
          </div>
          {plan && (
            <div className="mt-1 text-xs line-clamp-1" style={{ color: 'var(--app-text-secondary)' }}>
              {plan.summary}
            </div>
          )}
        </div>
        {attentionRuns.length > 0 ? <Badge variant="failed">需要处理</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <OverviewMetric
          value={`${completedTasks} / ${totalTasks}`}
          label="任务完成"
          onClick={() => onOpenArtifacts('tasks')}
        />
        <OverviewMetric
          value={String(activeRuns.length)}
          label="Agent 运行中"
          onClick={() => onOpenArtifacts('tasks')}
        />
        <OverviewMetric
          value={String(completedRuns)}
          label="已完成 Run"
          onClick={() => onOpenArtifacts('diff')}
        />
        <OverviewMetric
          value={String(attentionRuns.length)}
          label="需要处理"
          danger={attentionRuns.length > 0}
          onClick={() => onOpenArtifacts('summary')}
        />
      </div>

      {activeRuns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: 'var(--app-text)' }}>
            正在进行
          </div>
          {activeRuns.slice(0, 3).map((run) => {
            const linkedTask = plan?.items.find((item) => item.runId === run.runId);
            return (
              <div
                key={run.runId}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                    {linkedTask?.title ?? run.prompt}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                    @{run.agentName ?? run.agentId}
                  </div>
                </div>
                <Badge variant={getStatusVariant(run.status)}>{getStatusLabel(run.status)}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {attentionRuns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: '#991B1B' }}>
            需要处理
          </div>
          {attentionRuns.slice(0, 2).map((run) => {
            const linkedTask = plan?.items.find((item) => item.runId === run.runId);
            return (
              <div
                key={run.runId}
                className="rounded-lg px-3 py-2 text-sm"
                style={{ backgroundColor: '#FEF2F2', color: '#991B1B', border: '0.5px solid #FECACA' }}
              >
                {linkedTask?.title ?? run.prompt} {run.status === 'failed' ? '失败' : '已中断'}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function OverviewMetric({
  value,
  label,
  danger,
  onClick,
}: {
  value: string;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-3 py-2 text-left transition-opacity hover:opacity-90"
      style={{
        backgroundColor: danger ? '#FEF2F2' : 'var(--card-subtle)',
        border: danger ? '0.5px solid #FECACA' : '0.5px solid var(--app-border)',
      }}
    >
      <div className="text-base font-semibold" style={{ color: danger ? '#991B1B' : 'var(--app-text)' }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: danger ? '#991B1B' : 'var(--app-text-secondary)' }}>
        {label}
      </div>
    </button>
  );
}
