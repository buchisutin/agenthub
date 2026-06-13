import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { Badge } from '../ui/Badge';
import { UnifiedDiffView } from '../DiffCard';
import { getStatusLabel, getStatusVariant } from '../ui/status';
import type {
  Agent,
  ChatTimelineItem,
  FileChange,
  PlanCardModel,
  PreviewStartResponse,
  Task,
  TaskAssignment,
} from '../../types';

export type ArtifactTab = 'tasks' | 'diff' | 'preview' | 'summary';

interface ArtifactPanelProps {
  open: boolean;
  activeTab: ArtifactTab;
  selectedRunId?: string | null;
  width?: number;
  plans: PlanCardModel[];
  timeline: ChatTimelineItem[];
  agents: Agent[];
  tasks?: Task[];
  assignments?: TaskAssignment[];
  loadingTasks?: boolean;
  taskError?: string | null;
  onClose: () => void;
  onTabChange: (tab: ArtifactTab) => void;
  onOpenTask: (taskId: string) => void;
  onWidthChange?: (width: number) => void;
}

export const DEFAULT_ARTIFACT_PANEL_WIDTH = 420;
export const MIN_ARTIFACT_PANEL_WIDTH = 340;
export const MAX_ARTIFACT_PANEL_WIDTH = 760;

function clampPanelWidth(width: number) {
  return Math.min(MAX_ARTIFACT_PANEL_WIDTH, Math.max(MIN_ARTIFACT_PANEL_WIDTH, width));
}

function agentName(agentId: string | null | undefined, agents: Agent[]) {
  if (!agentId) return 'Unassigned';
  return agents.find((agent) => agent.id === agentId)?.name ?? agentId;
}

function getSelectedRunId(input: {
  selectedRunId?: string | null;
  timeline: ChatTimelineItem[];
  plans: PlanCardModel[];
}) {
  if (input.selectedRunId) return input.selectedRunId;
  const planRunId = input.plans.flatMap((plan) => plan.items).find((item) => item.runId)?.runId;
  return planRunId ?? input.timeline.find((item) => item.status === 'completed')?.runId ?? input.timeline[0]?.runId ?? null;
}

function getTaskRows(plans: PlanCardModel[], tasks: Task[], assignments: TaskAssignment[]) {
  if (plans.length > 0) {
    return plans.flatMap((plan) => plan.items.map((item) => ({ planId: plan.id, item })));
  }
  const assignmentByTaskId = new Map(assignments.map((assignment) => [assignment.task_id, assignment]));
  return tasks.map((task, index) => ({
    planId: task.plan_message_id ?? task.id,
    item: {
      index: index + 1,
      title: task.title,
      description: task.description ?? '',
      taskType: task.task_type ?? 'general',
      expectedOutput: task.expected_output ?? '',
      affectedFiles: [],
      dependsOn: task.depends_on ?? [],
      assignedAgentId: assignmentByTaskId.get(task.id)?.agent_id ?? '',
      assignedAgentName: '',
      taskId: task.id,
      assignmentId: assignmentByTaskId.get(task.id)?.id ?? '',
      runId: assignmentByTaskId.get(task.id)?.latest_run_id ?? null,
      status: task.status,
    } satisfies PlanCardModel['items'][number],
  }));
}

export function ArtifactPanel({
  open,
  activeTab,
  selectedRunId,
  width,
  plans,
  timeline,
  agents,
  tasks = [],
  assignments = [],
  loadingTasks = false,
  taskError = null,
  onClose,
  onTabChange,
  onOpenTask,
  onWidthChange,
}: ArtifactPanelProps) {
  const [internalWidth, setInternalWidth] = useState(DEFAULT_ARTIFACT_PANEL_WIDTH);
  const runId = getSelectedRunId({ selectedRunId, timeline, plans });
  const completedRuns = timeline.filter((item) => item.status === 'completed').length;
  const attentionRuns = timeline.filter((item) => item.status === 'failed' || item.status === 'interrupted').length;
  const panelWidth = clampPanelWidth(width ?? internalWidth);

  function setPanelWidth(nextWidth: number) {
    const clampedWidth = clampPanelWidth(nextWidth);
    if (onWidthChange) {
      onWidthChange(clampedWidth);
    } else {
      setInternalWidth(clampedWidth);
    }
  }

  function handleResizeStart(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;

    function handleMouseMove(moveEvent: MouseEvent) {
      setPanelWidth(startWidth + startX - moveEvent.clientX);
    }

    function handleMouseUp() {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  if (!open) return null;

  return (
    <aside
      aria-label="成果面板"
      className="absolute bottom-4 right-4 top-4 z-20 flex flex-col overflow-hidden rounded-xl shadow-sm"
      style={{
        width: `${panelWidth}px`,
        backgroundColor: 'var(--panel-bg)',
        border: '0.5px solid var(--app-border)',
      }}
    >
      <button
        type="button"
        aria-label="调整成果面板宽度"
        className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize"
        style={{ backgroundColor: 'transparent' }}
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setPanelWidth(DEFAULT_ARTIFACT_PANEL_WIDTH)}
      />

      <div className="px-6 py-5" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
              成果面板
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
              {completedRuns} completed runs · {attentionRuns} needs attention
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>
            Close
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <PanelMetric label="可验收 Run" value={completedRuns} />
          <PanelMetric label="待处理" value={attentionRuns} danger={attentionRuns > 0} />
        </div>
      </div>

      <div className="flex gap-1 px-5 py-4" style={{ borderBottom: '0.5px solid var(--app-border)' }}>
        {(['tasks', 'diff', 'preview', 'summary'] as ArtifactTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: activeTab === tab ? 'var(--card-bg)' : 'transparent',
              color: activeTab === tab ? 'var(--app-text)' : 'var(--app-text-secondary)',
              border: activeTab === tab ? '0.5px solid var(--app-border)' : '0.5px solid transparent',
            }}
          >
            {tab === 'tasks' ? 'Tasks' : tab === 'diff' ? 'Diff' : tab === 'preview' ? 'Preview' : 'Summary'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'tasks' && (
          <TasksTab
            plans={plans}
            tasks={tasks}
            assignments={assignments}
            agents={agents}
            loading={loadingTasks}
            error={taskError}
            onOpenTask={onOpenTask}
          />
        )}
        {activeTab === 'diff' && <DiffTab runId={runId} />}
        {activeTab === 'preview' && <PreviewTab runId={runId} />}
        {activeTab === 'summary' && (
          <SummaryTab plans={plans} timeline={timeline} completedRuns={completedRuns} attentionRuns={attentionRuns} />
        )}
      </div>
    </aside>
  );
}

function PanelMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{
        backgroundColor: danger ? '#FEF2F2' : 'var(--card-bg)',
        border: danger ? '0.5px solid #FECACA' : '0.5px solid var(--app-border)',
      }}
    >
      <div className="text-base font-semibold" style={{ color: danger ? '#991B1B' : 'var(--app-text)' }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: danger ? '#991B1B' : 'var(--app-text-secondary)' }}>
        {label}
      </div>
    </div>
  );
}

function TasksTab({
  plans,
  tasks,
  assignments,
  agents,
  loading,
  error,
  onOpenTask,
}: {
  plans: PlanCardModel[];
  tasks: Task[];
  assignments: TaskAssignment[];
  agents: Agent[];
  loading: boolean;
  error: string | null;
  onOpenTask: (taskId: string) => void;
}) {
  const rows = useMemo(() => getTaskRows(plans, tasks, assignments), [assignments, plans, tasks]);

  if (loading) {
    return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>Loading tasks...</div>;
  }
  if (error) {
    return <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>{error}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>No tasks yet</div>;
  }

  return (
    <div className="space-y-3">
      {rows.map(({ planId, item }) => (
        <button
          key={`${planId}-${item.taskId || item.index}`}
          type="button"
          onClick={() => onOpenTask(item.taskId)}
          className="w-full rounded-lg px-4 py-4 text-left"
          style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                {item.title}
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                @{item.assignedAgentName || agentName(item.assignedAgentId, agents)}
              </div>
              {item.dependsOn && item.dependsOn.length > 0 ? (
                <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                  等待 {item.dependsOn.join(', ')}
                </div>
              ) : null}
            </div>
            <Badge variant={getStatusVariant(item.status)}>{getStatusLabel(item.status)}</Badge>
          </div>
        </button>
      ))}
    </div>
  );
}

function DiffTab({ runId }: { runId: string | null }) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setChanges([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getRunFileChanges(runId)
      .then((next) => {
        if (!cancelled) setChanges(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载 Diff 失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (!runId) return <EmptyPanelText text="选择一个 Run 后查看 Diff。" />;
  if (loading) return <EmptyPanelText text="正在加载 Diff..." />;
  if (error) return <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>{error}</div>;
  if (changes.length === 0) return <EmptyPanelText text="这个 Run 没有文件改动。" />;

  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <div
          key={change.filePath}
          className="rounded-lg px-4 py-4"
          style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <code className="truncate text-xs" style={{ color: 'var(--app-text)' }}>{change.filePath}</code>
            <Badge variant="muted">{change.changeType}</Badge>
          </div>
          <div className="mt-2 max-h-72 overflow-auto rounded-md" style={{ backgroundColor: '#0D1117', border: '0.5px solid #30363D' }}>
            <UnifiedDiffView change={change} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewTab({ runId }: { runId: string | null }) {
  const [preview, setPreview] = useState<PreviewStartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPreview() {
    if (!runId || loading) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.startRunPreview(runId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '启动预览失败');
    } finally {
      setLoading(false);
    }
  }

  if (!runId) return <EmptyPanelText text="选择一个 Run 后启动 Preview。" />;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void startPreview()}
        disabled={loading}
        className="rounded-lg px-3 py-2 text-sm font-medium"
        style={{ backgroundColor: loading ? 'var(--card-strong)' : 'var(--app-accent)', color: loading ? 'var(--app-text-secondary)' : '#FFFFFF' }}
      >
        {loading ? '启动中...' : '启动预览'}
      </button>
      {preview && (
        <div className="space-y-2">
          <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)', color: 'var(--app-text)' }}>
            {preview.url}
          </div>
          <iframe title="Run preview" src={preview.url} className="h-72 w-full rounded-lg" style={{ border: '0.5px solid var(--app-border)', backgroundColor: '#FFFFFF' }} />
        </div>
      )}
      {error && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}>{error}</div>}
    </div>
  );
}

function SummaryTab({
  plans,
  timeline,
  completedRuns,
  attentionRuns,
}: {
  plans: PlanCardModel[];
  timeline: ChatTimelineItem[];
  completedRuns: number;
  attentionRuns: number;
}) {
  const totalTasks = plans.reduce((sum, plan) => sum + plan.items.length, 0);
  const completedTasks = plans.reduce((sum, plan) => sum + plan.items.filter((item) => item.status === 'completed').length, 0);

  return (
    <div className="space-y-3">
      <PanelMetric label="任务完成" value={completedTasks} />
      <PanelMetric label="任务总数" value={totalTasks} />
      <PanelMetric label="Run 总数" value={timeline.length} />
      <PanelMetric label="已完成 Run" value={completedRuns} />
      <PanelMetric label="待处理" value={attentionRuns} danger={attentionRuns > 0} />
      <div className="rounded-lg px-3 py-3 text-sm" style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)', color: 'var(--app-text-secondary)' }}>
        完整 Markdown 总结仍可通过现有总结入口生成；这里先展示会话级协作概览。
      </div>
    </div>
  );
}

function EmptyPanelText({ text }: { text: string }) {
  return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>{text}</div>;
}
