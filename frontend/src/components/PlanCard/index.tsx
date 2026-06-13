import type { OrchestratorPlanningState, PlanCardModel } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant, getTaskDotColor } from '../ui/status';

function scrollToRun(runId: string) {
  const node = document.getElementById(`run-card-${runId}`);
  node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hasRunId(runId: string | null): runId is string {
  return Boolean(runId);
}

function formatTaskType(taskType?: string) {
  if (!taskType) return null;
  return taskType.charAt(0).toUpperCase() + taskType.slice(1);
}

function formatDependencies(dependsOn?: string[]) {
  if (!dependsOn || dependsOn.length === 0) {
    return '无依赖，可立即开始';
  }
  return `等待任务 ${dependsOn.join(', ')}`;
}

export function PlanCard({
  plan,
  onOpenTask,
  onResumeFrom,
  onFocusArtifacts,
}: {
  plan: PlanCardModel;
  onOpenTask?: (taskId: string) => void;
  onResumeFrom?: (planId: string, plannerTaskId: string) => void;
  onFocusArtifacts?: (runId: string, tab: 'diff' | 'preview') => void;
}) {
  const completed = plan.items.filter((i) => i.status === 'completed').length;
  const total = plan.items.length;
  const itemByPlannerId = new Map(plan.items.map((item) => [item.plannerTaskId ?? `t${item.index}`, item]));
  const stagedItems = plan.dagPreview?.levels?.length
    ? plan.dagPreview.levels
        .map((level) => level.map((plannerTaskId) => itemByPlannerId.get(plannerTaskId)).filter((item): item is PlanCardModel['items'][number] => Boolean(item)))
        .filter((level) => level.length > 0)
    : [plan.items];

  return (
    <div className="agenthub-card overflow-hidden">
      <div className="px-5 py-4 space-y-3" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
            协作计划
          </div>
          <span className="hidden">Task Plan</span>
          <span className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
            {completed} / {total} completed
          </span>
        </div>
        <div className="text-[13px] line-clamp-2" style={{ color: 'var(--app-text-secondary)' }}>
          {plan.summary}
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--card-strong)' }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%`, backgroundColor: 'var(--status-success)' }}
          />
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {stagedItems.map((level, levelIndex) => {
          const waitingOn = Array.from(new Set(level.flatMap((item) => item.dependsOn ?? [])));
          return (
            <div key={`level-${levelIndex}`} className="space-y-2">
              {stagedItems.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold" style={{ color: 'var(--app-text)' }}>
                    阶段 {levelIndex + 1} · {waitingOn.length > 0 ? `等待 ${waitingOn.join(', ')}` : '可并行'}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--app-text-secondary)' }}>
                    {level.length} 个任务
                  </div>
                </div>
              )}
              <div className="overflow-hidden rounded-lg" style={{ border: '0.5px solid var(--app-border)', backgroundColor: '#FFFFFF' }}>
                {level.map((item) => {
          const runId = hasRunId(item.runId) ? item.runId : null;
          const plannerTaskId = item.plannerTaskId ?? `t${item.index}`;
          return (
            <div
              key={item.runId ?? item.taskId}
              className="w-full px-4 py-3 text-left flex items-start justify-between gap-3"
              style={{ borderTop: level.indexOf(item) === 0 ? undefined : '0.5px solid var(--app-border)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="mt-0.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getTaskDotColor(item.status) }} />
                  <span className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
                    {plannerTaskId}
                  </span>
                  <span className="hidden">Task {item.index}</span>
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--app-text)' }}>
                    {item.title}
                  </span>
                  {item.taskType && (
                    <Badge variant="muted">
                      {formatTaskType(item.taskType)}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                  <span>@{item.assignedAgentName}</span>
                  <span>·</span>
                  <span>{formatDependencies(item.dependsOn)}</span>
                </div>
                {item.description ? (
                  <div className="mt-2 text-xs line-clamp-2" style={{ color: 'var(--app-text-secondary)' }}>
                    {item.description}
                  </div>
                ) : null}
                {item.outputSummary ? (
                  <div className="mt-2 rounded-md px-2 py-1.5 text-xs line-clamp-2" style={{ backgroundColor: 'var(--card-bg)', color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}>
                    产物：{item.outputSummary}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                {onOpenTask && (
                  <button
                    type="button"
                    onClick={() => onOpenTask(item.taskId)}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--app-text-secondary)' }}
                  >
                    View Task
                  </button>
                )}
                {onFocusArtifacts && runId ? (
                  <button
                    type="button"
                    onClick={() => onFocusArtifacts(runId, 'diff')}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--app-text-secondary)' }}
                  >
                    查看产物
                  </button>
                ) : null}
                <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
                {onResumeFrom && item.status !== 'running' && item.status !== 'queued' ? (
                  <button
                    type="button"
                    onClick={() => onResumeFrom(plan.id, plannerTaskId)}
                    aria-label={`从 ${plannerTaskId} 重新执行`}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--app-text-secondary)' }}
                  >
                    从此任务重新执行
                  </button>
                ) : null}
                {runId ? (
                  <button
                    type="button"
                    onClick={() => scrollToRun(runId)}
                    aria-label="View Run"
                    className="text-xs hover:underline"
                    style={{ color: 'var(--status-running)' }}
                  >
                    Run ↗
                  </button>
                ) : null}
              </div>
            </div>
          );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OrchestratorPlanningCard({
  planning,
}: {
  planning: OrchestratorPlanningState;
}) {
  const preview = planning.output.trim();

  return (
    <div className="agenthub-card overflow-hidden">
      <div className="px-5 py-4 space-y-3" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
            Orchestrator 正在规划
          </div>
          <Badge variant="running">Planning</Badge>
        </div>
        {planning.prompt ? (
          <div className="text-[13px] line-clamp-2" style={{ color: 'var(--app-text-secondary)' }}>
            {planning.prompt}
          </div>
        ) : null}
      </div>

      <div className="p-4 space-y-3">
        <div className="flex gap-1 px-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full animate-bounce"
              style={{ backgroundColor: 'var(--color-accent)', animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <div
          className="rounded-lg px-3 py-3 text-sm whitespace-pre-wrap"
          style={{
            backgroundColor: 'var(--card-subtle)',
            color: preview ? 'var(--app-text)' : 'var(--app-text-secondary)',
            border: '0.5px solid var(--app-border)',
          }}
        >
          {preview || '正在分析请求并拆解任务...'}
        </div>
      </div>
    </div>
  );
}
