import { useMemo, useState } from 'react';
import type { Agent, PlanCardModel, Task, TaskAssignment, TaskDetail } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';

function getStatusTone(status: string) {
  if (status === 'completed') {
    return { color: '#3FB950', background: 'rgba(46, 160, 67, 0.16)' };
  }
  if (status === 'failed' || status === 'interrupted') {
    return { color: '#F85149', background: 'rgba(248, 81, 73, 0.16)' };
  }
  if (status === 'cancelled') {
    return { color: '#8B949E', background: 'rgba(139, 148, 158, 0.16)' };
  }
  if (status === 'running' || status === 'queued') {
    return { color: '#E3B341', background: 'rgba(210, 153, 34, 0.18)' };
  }
  return { color: '#8B949E', background: 'rgba(139, 148, 158, 0.16)' };
}

function agentName(agentId: string | null | undefined, agents: Agent[]) {
  if (!agentId) return 'Unassigned';
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function scrollToRun(runId: string) {
  const node = document.getElementById(`run-card-${runId}`);
  node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

type TaskFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled';

function getFilterGroup(status: string): TaskFilter {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'interrupted') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'running' || status === 'queued' || status === 'pending' || status === 'assigned' || status === 'in_progress') return 'active';
  return 'all';
}

function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  return getFilterGroup(task.status) === filter;
}

function matchesSearch(task: Task, query: string, assignment: TaskAssignment | undefined, agents: Agent[]): boolean {
  if (!query.trim()) return true;
  const q = query.toLowerCase();
  if (task.title.toLowerCase().includes(q)) return true;
  if (task.description?.toLowerCase().includes(q)) return true;
  if (agentName(assignment?.agent_id, agents).toLowerCase().includes(q)) return true;
  return false;
}

const FILTER_LABELS: Record<TaskFilter, string> = {
  all: 'All',
  active: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function TaskPanel({
  tasks,
  assignments,
  agents,
  plans,
  onOpenTask,
  onResumeFrom,
  onClose,
  loading,
  error,
}: {
  tasks: Task[];
  assignments: TaskAssignment[];
  agents: Agent[];
  plans: PlanCardModel[];
  onOpenTask: (taskId: string) => void;
  onResumeFrom?: (planId: string, plannerTaskId: string) => void;
  onClose: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [search, setSearch] = useState('');

  const assignmentByTaskId = useMemo(
    () => new Map(assignments.map((a) => [a.task_id, a])),
    [assignments],
  );
  const planItemByTaskId = useMemo(() => {
    const map = new Map<string, PlanCardModel['items'][number]>();
    for (const plan of plans) {
      for (const item of plan.items) {
        map.set(item.taskId, item);
      }
    }
    return map;
  }, [plans]);

  const filterCounts = useMemo(() => {
    const counts: Record<TaskFilter, number> = { all: 0, active: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const task of tasks) {
      counts.all += 1;
      counts[getFilterGroup(task.status)] += 1;
    }
    return counts;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const assignment = assignmentByTaskId.get(task.id);
      return matchesFilter(task, filter) && matchesSearch(task, search, assignment, agents);
    });
  }, [tasks, filter, search, assignmentByTaskId, agents]);

  return (
    <div
      className="absolute inset-y-0 right-0 w-80 z-20 flex flex-col"
      style={{ backgroundColor: 'var(--panel-bg)', borderLeft: '0.5px solid var(--app-border)' }}
    >
      <div className="px-4 py-4 flex items-center justify-between" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
          任务
        </div>
        <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>
          Close
        </button>
      </div>

      <div className="px-3 pt-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索任务…"
          className="h-8 w-full rounded-md px-3 text-xs outline-none"
          style={{
            backgroundColor: 'var(--card-bg)',
            border: '0.5px solid var(--app-border)',
            color: 'var(--app-text)',
          }}
        />
      </div>

      <div className="px-3 py-2">
        <div
          className="inline-flex flex-wrap gap-1 rounded-full p-1"
          style={{ backgroundColor: 'var(--color-border)' }}
        >
        {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((key) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: active ? 'var(--card-bg)' : 'transparent',
                color: active ? 'var(--app-text)' : 'var(--app-text-secondary)',
              }}
            >
              {FILTER_LABELS[key]} {filterCounts[key]}
            </button>
          );
        })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-sm" style={{ color: '#8B949E' }}>
            Loading tasks...
          </div>
        ) : error ? (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'rgba(248, 81, 73, 0.10)', color: '#FCA5A5' }}>
            {error}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-sm" style={{ color: '#8B949E' }}>
            No tasks yet
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-sm" style={{ color: '#8B949E' }}>
            {search ? 'No matching tasks' : `No ${FILTER_LABELS[filter].toLowerCase()} tasks`}
          </div>
        ) : (
          filteredTasks.map((task) => {
            const assignment = assignmentByTaskId.get(task.id);
            const planItem = planItemByTaskId.get(task.id);
            const taskTone = getStatusTone(task.status);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                className="w-full rounded-xl px-3 py-3 text-left"
                style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: taskTone.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--app-text)' }}>
                      {task.title}
                    </div>
                    <div className="mt-1 text-xs truncate" style={{ color: 'var(--app-text-secondary)' }}>
                      @{planItem?.assignedAgentName ?? agentName(assignment?.agent_id, agents)}
                    </div>
                    {planItem?.dependsOn && planItem.dependsOn.length > 0 && (
                      <div className="mt-1 text-xs truncate" style={{ color: 'var(--app-text-secondary)' }}>
                        等待 {planItem.dependsOn.join(', ')}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {planItem && <Badge variant="muted">Task {planItem.index}</Badge>}
                      <Badge variant={getStatusVariant(task.status)}>{getStatusLabel(task.status)}</Badge>
                      {planItem?.plannerTaskId && onResumeFrom && task.status !== 'running' && assignment?.status !== 'running' && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            const plan = plans.find((entry) => entry.items.some((item) => item.taskId === task.id));
                            if (plan) {
                              onResumeFrom(plan.id, planItem.plannerTaskId!);
                            }
                          }}
                          className="text-xs hover:underline"
                          style={{ color: 'var(--app-text-secondary)' }}
                        >
                          从此任务重新执行
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function TaskDetailDrawer({
  detail,
  agents,
  planItem,
  loading,
  error,
  actionLoading,
  actionError,
  onClose,
  onCancelTask,
  onRerunTask,
  onResumeFromPlan,
}: {
  detail: TaskDetail | null;
  agents: Agent[];
  planItem?: PlanCardModel['items'][number] | null;
  loading: boolean;
  error: string | null;
  actionLoading: 'cancel' | 'rerun' | null;
  actionError: string | null;
  onClose: () => void;
  onCancelTask: () => void;
  onRerunTask: () => void;
  onResumeFromPlan?: (plannerTaskId: string) => void;
}) {
  const assignment = detail?.assignments[0] ?? null;
  const latestRun = detail?.latestRun ?? null;
  const task = detail?.task ?? null;

  const canCancel =
    task !== null &&
    task.status !== 'completed' &&
    task.status !== 'running' &&
    latestRun?.status !== 'running' &&
    latestRun?.status !== 'queued';
  const canRerun =
    task !== null &&
    task.status !== 'running' &&
    latestRun?.status !== 'running' &&
    latestRun?.status !== 'queued';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl"
        style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)', boxShadow: '0 18px 48px rgba(26,26,24,0.16)' }}
      >
        <div className="px-5 py-4 flex items-start justify-between gap-4" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
          <div className="min-w-0">
            <div className="text-base font-semibold truncate" style={{ color: 'var(--app-text)' }}>
              {task?.title ?? '任务详情'}
            </div>
            {task && (
              <div className="mt-2">
                <Badge variant={getStatusVariant(task.status)}>{getStatusLabel(task.status)}</Badge>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-base leading-none" style={{ color: 'var(--app-text-secondary)' }} aria-label="Close">
            ×
          </button>
        </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {loading ? (
          <div className="text-sm" style={{ color: '#8B949E' }}>
            Loading task details...
          </div>
        ) : error ? (
          <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'rgba(248, 81, 73, 0.10)', color: '#FCA5A5' }}>
            {error}
          </div>
        ) : !task ? (
          <div className="text-sm" style={{ color: '#8B949E' }}>
            No task selected
          </div>
        ) : (
          <>
            <div>
              {task.description && (
                <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--app-text-secondary)' }}>
                  {task.description}
                </div>
              )}
            </div>

            <div className="space-y-3">
              {planItem?.plannerTaskId && (
                <TaskField label="编排任务" value={planItem.plannerTaskId} />
              )}
              {planItem?.dependsOn && planItem.dependsOn.length > 0 && (
                <TaskField label="上游依赖" value={planItem.dependsOn.join(', ')} />
              )}
              <TaskField label="任务状态" value={getStatusLabel(task.status)} />
              <TaskField label="任务类型" value={task.task_type ?? 'general'} />
              <TaskField
                label="预期输出"
                value={task.expected_output?.trim() ? task.expected_output : 'none'}
              />
              <TaskField label="指派 Agent" value={agentName(assignment?.agent_id, agents)} />
              <TaskField label="指派状态" value={assignment?.status ?? 'none'} />
              <TaskField label="最新 Run" value={latestRun?.id ?? 'none'} />
              <TaskField label="最新 Run 状态" value={latestRun?.status ?? 'none'} />
            </div>

            {planItem?.outputSummary ? (
              <div className="rounded-lg px-3 py-3 space-y-2" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
                <div className="text-xs font-semibold" style={{ color: 'var(--app-text)' }}>
                  任务产物
                </div>
                <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--app-text-secondary)' }}>
                  {planItem.outputSummary}
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-2 flex-wrap">
              {latestRun && (
                <button
                  type="button"
                  onClick={() => scrollToRun(latestRun.id)}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{ backgroundColor: 'var(--color-accent)', color: '#FFFFFF' }}
                >
                  View Run
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={onCancelTask}
                  disabled={actionLoading !== null}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{ backgroundColor: 'transparent', color: 'var(--color-danger)' }}
                >
                  {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Task'}
                </button>
              )}
              {canRerun && (
                <button
                  type="button"
                  onClick={onRerunTask}
                  disabled={actionLoading !== null}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{ backgroundColor: 'var(--color-panel-bg)', color: 'var(--app-text)' }}
                >
                  {actionLoading === 'rerun' ? 'Rerunning...' : 'Rerun Task'}
                </button>
              )}
              {canRerun && planItem?.plannerTaskId && onResumeFromPlan && (
                <button
                  type="button"
                  onClick={() => onResumeFromPlan(planItem.plannerTaskId!)}
                  disabled={actionLoading !== null}
                  aria-label={`从 ${planItem.plannerTaskId} 重新执行`}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--app-text)' }}
                >
                  从此任务重新执行
                </button>
              )}
            </div>

            {actionError && (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'rgba(248, 81, 73, 0.10)', color: '#FCA5A5' }}>
                {actionError}
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

function TaskField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
      <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
        {label}
      </div>
      <div className="text-sm text-right break-words" style={{ color: 'var(--app-text)' }}>
        {value}
      </div>
    </div>
  );
}
