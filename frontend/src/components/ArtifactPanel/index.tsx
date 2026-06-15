import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';
import { Badge } from '../ui/Badge';
import { FileDiffBlock } from '../DiffCard';
import { getStatusLabel, getStatusVariant } from '../ui/status';
import type {
  Agent,
  ApplyCheckResult,
  ChatTimelineItem,
  DeployRecord,
  DeployScriptsResponse,
  FileChange,
  PlanCardModel,
  PreviewStartResponse,
  RunCardSummary,
  Task,
  TaskAssignment,
} from '../../types';

export type ArtifactTab = 'tasks' | 'diff' | 'preview';

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
  const [resizing, setResizing] = useState(false);
  const runId = getSelectedRunId({ selectedRunId, timeline, plans });
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
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  if (!open) return null;

  return (
    <aside
      aria-label="成果面板"
      className="absolute bottom-0 right-0 top-0 z-20 flex h-full flex-col overflow-hidden"
      style={{
        width: `${panelWidth}px`,
        backgroundColor: 'var(--panel-bg)',
        borderLeft: '1px solid var(--app-border)',
      }}
    >
      <button
        type="button"
        aria-label="调整成果面板宽度"
        className="group absolute inset-y-0 -left-2 z-10 w-4 cursor-col-resize bg-transparent p-0"
        style={{ backgroundColor: 'transparent' }}
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setPanelWidth(DEFAULT_ARTIFACT_PANEL_WIDTH)}
      >
        <span
          className={[
            'pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all',
            resizing ? 'w-[2px]' : 'w-px group-hover:w-[2px]',
          ].join(' ')}
          style={{
            backgroundColor: resizing ? 'var(--app-border-strong)' : 'var(--app-border)',
          }}
        />
      </button>

      <div className="flex items-center justify-end px-5 pt-4 pb-0" style={{ backgroundColor: 'var(--panel-bg)' }}>
        <button type="button" onClick={onClose} className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          Close
        </button>
      </div>

      <div className="flex gap-1 px-5 py-4" style={{ backgroundColor: 'var(--panel-bg)', borderBottom: '0.5px solid var(--app-border)' }}>
        {(['diff', 'preview', 'tasks'] as ArtifactTab[]).map((tab) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[rgba(0,0,0,0.04)]"
              style={{
                backgroundColor: 'transparent',
                color: active ? 'var(--app-text)' : 'var(--app-text-secondary)',
                fontWeight: active ? 500 : 400,
              }}
            >
              {tab === 'diff' ? '代码改动' : tab === 'preview' ? '网页预览' : '执行计划'}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-5 pb-4">
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
      </div>
      <BottomConsole runId={runId} />
    </aside>
  );
}

function BottomConsole({ runId }: { runId: string | null }) {
  const [summary, setSummary] = useState<RunCardSummary | null>(null);
  const [scripts, setScripts] = useState<DeployScriptsResponse | null>(null);
  const [deploy, setDeploy] = useState<DeployRecord | null>(null);
  const [applyCheck, setApplyCheck] = useState<ApplyCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [startingDeploy, setStartingDeploy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setSummary(null);
      setScripts(null);
      setDeploy(null);
      setApplyCheck(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setApplyCheck(null);

    Promise.all([
      api.getRunCardSummary(runId),
      api.getRunDeployScripts(runId).catch(() => null),
      api.getRunDeploy(runId).catch(() => null),
    ])
      .then(([nextSummary, nextScripts, nextDeploy]) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setScripts(nextScripts);
        setDeploy(nextDeploy);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载操作状态失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!runId || deploy?.status !== 'running') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      api.getRunDeploy(runId)
        .then((nextDeploy) => {
          if (!cancelled) setDeploy(nextDeploy);
        })
        .catch(() => undefined);
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [deploy?.status, runId]);

  const fileCount = summary?.fileChanges.length ?? 0;
  const applied = summary?.changeApplication?.status === 'applied';
  const cleaned = summary?.workspace.status === 'cleaned';
  const canApply = Boolean(runId && fileCount > 0 && !applied && !cleaned);
  const deployScript = scripts?.defaultScript ?? scripts?.scripts[0] ?? 'start';
  const commandLabel = deploy?.command ?? (deployScript ? `npm run ${deployScript}` : 'package.json scripts');
  const logText = deploy?.logs.map((entry) => entry.chunk).join('').trimEnd() ?? '';
  const showTerminal = startingDeploy || deploy?.status === 'running' || logText.length > 0;
  const disabled = !runId || loading || applying || startingDeploy || deploy?.status === 'running' || cleaned;

  async function refreshSummary() {
    if (!runId) return;
    setSummary(await api.getRunCardSummary(runId));
  }

  async function handlePrimaryAction() {
    if (!runId || disabled) return;
    setError(null);
    setApplyCheck(null);

    if (canApply) {
      setApplying(true);
      try {
        const check = await api.checkRunApply(runId);
        setApplyCheck(check);
        if (!check.canApply) return;
        await api.requestApplyChanges(runId);
        await refreshSummary();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Apply failed');
      } finally {
        setApplying(false);
      }
      return;
    }

    setStartingDeploy(true);
    try {
      const started = await api.startRunDeploy(runId, deployScript);
      setDeploy(started);
      const latest = await api.getRunDeploy(runId);
      if (latest) setDeploy(latest);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Deploy failed');
    } finally {
      setStartingDeploy(false);
    }
  }

  return (
    <div className="z-20 flex flex-shrink-0 flex-col">
      {showTerminal && (
        <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap rounded-t-xl border-t border-gray-300 bg-[#1A1A1A] p-4 font-mono text-xs leading-relaxed text-[#A3BE8C]">
          {logText || (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-[#A3BE8C]" />
              Starting process...
            </span>
          )}
        </pre>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-gray-200 bg-white/95 px-6 py-4 backdrop-blur-md">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-700">
            {fileCount} files modified
          </div>
          <div className="mt-1 flex items-center gap-2 truncate text-xs text-gray-500">
            <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />
            <span className="truncate">{commandLabel} ready</span>
          </div>
          {error && <div className="mt-1" style={{ color: 'var(--status-danger)' }}>{error}</div>}
          {applyCheck && !applyCheck.canApply && (
            <div className="mt-1" style={{ color: 'var(--status-warning)' }}>
              {applyCheck.summary.conflict} conflicts, {applyCheck.summary.skipped} skipped
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void handlePrimaryAction()}
          className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg shadow-sm transition-colors border ${
            disabled
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200'
              : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white border-transparent'
          }`}
        >
          {applying ? (
            'Requesting...'
          ) : startingDeploy ? (
            'Starting...'
          ) : canApply ? (
            'Apply Changes'
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              Deploy
            </>
          )}
        </button>
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

  // Build a lookup from plannerTaskId / taskId to item for resolving agent-centric dependencies.
  // MUST be before any early return to keep hooks order stable.
  const taskById = useMemo(() => {
    const map = new Map<string, (typeof rows)[number]['item']>();
    for (const { item } of rows) {
      if (item.plannerTaskId) map.set(item.plannerTaskId, item);
      map.set(item.taskId, item);
    }
    return map;
  }, [rows]);

  if (loading) {
    return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>Loading tasks...</div>;
  }
  if (error) {
    return <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--status-danger)', border: '0.5px solid var(--app-border)' }}>{error}</div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>No tasks yet</div>;
  }

  return (
    <div className="relative pl-10 mt-2">
      {/* Vertical timeline line — pinned to the container, stops short of the last node */}
      <div className="absolute left-[20px] top-2 bottom-8 w-[2px] bg-gray-100" />

      {rows.map(({ planId, item }, index) => {
        const status = item.status;
        const isCompleted = status === 'completed' || status === 'done';
        const isRunning = status === 'running' || status === 'in_progress' || status === 'queued';
        const isFailed = status === 'failed' || status === 'interrupted';
        const isPending = !isCompleted && !isRunning && !isFailed;

        const agentLabel = item.assignedAgentName || agentName(item.assignedAgentId, agents);
        const agentInitial = agentLabel.charAt(0).toUpperCase();

        // Resolve agent-level waiting: find predecessor tasks' agents
        const waitingAgents = (() => {
          if (!item.dependsOn || item.dependsOn.length === 0) return null;
          const myAgentId = item.assignedAgentId;
          const unique = new Set<string>();
          for (const depId of item.dependsOn) {
            const dep = taskById.get(depId);
            if (dep && dep.assignedAgentId !== myAgentId) {
              const name = dep.assignedAgentName || agentName(dep.assignedAgentId, agents);
              unique.add(name);
            }
          }
          return unique.size > 0 ? Array.from(unique) : null;
        })();

        return (
          <div key={`${planId}-${item.taskId || item.index}`} className="relative mb-6 last:mb-0">
            {/* Status dot — z-10 and bg-white so it covers the vertical line */}
            <div
              className={`absolute -left-[30px] top-0.5 w-5 h-5 rounded-full bg-white flex items-center justify-center z-10 border-2 ${
                isCompleted
                  ? 'bg-[#10B981] border-[#10B981]'
                  : isFailed
                    ? 'bg-white border-[#EF4444] text-[#EF4444]'
                    : isRunning
                      ? 'bg-white border-[#3B82F6]'
                      : 'bg-gray-50 border-gray-300'
              }`}
            >
              {isCompleted && (
                <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {isFailed && (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
              {isRunning && (
                <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse" />
              )}
            </div>

            {/* Clickable content */}
            <button
              type="button"
              onClick={() => onOpenTask(item.taskId)}
              className="w-full text-left"
            >
              <div className={`text-sm font-medium leading-tight truncate ${isPending ? 'text-gray-500' : 'text-gray-900'}`}>
                {item.title}
              </div>

              <div className="flex items-center gap-2 mt-1">
                {/* Current executor */}
                <div className="flex items-center gap-1.5 text-xs text-gray-700 font-medium">
                  <span className="inline-flex w-4 h-4 items-center justify-center rounded bg-gray-800 text-white text-[10px] font-semibold leading-none">
                    {agentInitial}
                  </span>
                  {agentLabel}
                </div>

                {/* Agent-to-agent waiting relationship */}
                {waitingAgents && waitingAgents.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span>·</span>
                    <span>等待</span>
                    {waitingAgents.map((agent) => (
                      <span key={agent} className="font-mono text-[11px] text-gray-500 bg-gray-100 px-1 rounded">
                        @{agent}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {isFailed && (
                <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
                  执行意外中断，请检查日志。
                </div>
              )}
            </button>
          </div>
        );
      })}
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
  if (error) return <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--status-danger)', border: '0.5px solid var(--app-border)' }}>{error}</div>;
  if (changes.length === 0) return <EmptyDiffState />;

  return (
    <div className="space-y-3">
      {changes.map((change) => (
        <FileDiffBlock key={change.filePath} change={change} />
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
        style={{ backgroundColor: loading ? 'var(--card-strong)' : 'var(--card-subtle)', color: loading ? 'var(--app-text-secondary)' : 'var(--app-text)', border: '0.5px solid var(--app-border)' }}
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
      {error && <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: 'var(--card-subtle)', color: 'var(--status-danger)', border: '0.5px solid var(--app-border)' }}>{error}</div>}
    </div>
  );
}

function EmptyPanelText({ text }: { text: string }) {
  return <div className="text-sm" style={{ color: 'var(--app-text-secondary)' }}>{text}</div>;
}

function EmptyDiffState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center mt-32">
      <div className="w-12 h-12 mb-4 text-gray-300">
        <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <div className="text-sm font-medium text-gray-900">无可预览的代码改动</div>
      <div className="text-xs text-gray-500 mt-1">当前 Run 尚未生成或修改任何文件。</div>
    </div>
  );
}
