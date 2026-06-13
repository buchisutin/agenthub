import type { ChatTimelineItem, PlanCardModel } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';

export type ArtifactTab = 'tasks' | 'diff' | 'preview';

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
    return null;
  }

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3"
      style={{ backgroundColor: 'var(--panel-bg)', border: '0.5px solid var(--app-border)' }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
        <span className="font-medium" style={{ color: 'var(--app-text)' }}>协作状态</span>
        <span style={{ color: 'var(--app-text-secondary)' }}>{completedTasks}/{totalTasks} 任务完成</span>
        <span style={{ color: 'var(--app-text-secondary)' }}>{activeRuns.length} 运行中</span>
        <span style={{ color: attentionRuns.length > 0 ? '#991B1B' : 'var(--app-text-secondary)' }}>{attentionRuns.length} 待处理</span>
        {activeRuns[0] ? (
          <Badge variant={getStatusVariant(activeRuns[0].status)}>{getStatusLabel(activeRuns[0].status)}</Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenArtifacts('tasks')}
          className="text-xs hover:underline"
          style={{ color: 'var(--app-text-secondary)' }}
        >
          查看计划
        </button>
        <button
          type="button"
          onClick={() => onOpenArtifacts(completedRuns > 0 ? 'diff' : 'tasks')}
          className="text-xs hover:underline"
          style={{ color: 'var(--app-accent)' }}
        >
          查看成果
        </button>
      </div>
    </section>
  );
}
