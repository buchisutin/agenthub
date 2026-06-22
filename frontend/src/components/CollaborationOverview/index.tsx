import type { ChatTimelineItem, PlanCardModel } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';

export type ArtifactTab = 'tasks' | 'diff' | 'preview';

interface CollaborationOverviewProps {
  plans: PlanCardModel[];
  timeline: ChatTimelineItem[];
  activeRunIds: string[];
  queuedCount?: number;
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
  queuedCount = 0,
  onOpenArtifacts,
}: CollaborationOverviewProps) {
  const plan = getLatestPlan(plans);
  const totalTasks = plan?.items.length ?? 0;
  const completedTasks = plan?.items.filter((item) => item.status === 'completed').length ?? 0;
  const activeRuns = timeline.filter((item) => activeRunIds.includes(item.runId));
  const attentionRuns = timeline.filter((item) => item.status === 'failed' || item.status === 'interrupted');
  const completedRuns = timeline.filter((item) => item.status === 'completed').length;

  if (!plan && timeline.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="协作状态"
      className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-2"
      style={{ backgroundColor: '#FFFFFF', borderTop: '0.5px solid var(--app-border)', borderBottom: '0.5px solid var(--app-border)' }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
        <span>{completedTasks}/{totalTasks} 完成</span>
        <span>{activeRuns.length} 运行中</span>
        <span style={{ color: attentionRuns.length > 0 ? '#991B1B' : 'var(--app-text-secondary)' }}>{attentionRuns.length} 待处理</span>
        {queuedCount > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#92400e' }}>
            {queuedCount} 条排队中
          </span>
        )}
        {activeRuns[0] ? (
          <Badge variant={getStatusVariant(activeRuns[0].status)}>{getStatusLabel(activeRuns[0].status)}</Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenArtifacts(completedRuns > 0 ? 'diff' : 'tasks')}
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ color: 'var(--app-accent)' }}
        >
          成果
        </button>
      </div>
    </section>
  );
}
