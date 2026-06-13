import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';
import { useApp } from '../../store/useApp';
import { loadConversationRuntime, startRun } from '../../store/runtimeActions';
import { api, ApiError } from '../../services/api';
import { socketService } from '../../services/socket';
import { OrchestratorPlanningCard, PlanCard } from '../PlanCard';
import { RunCard } from '../RunCard';
import { ConflictReviewCard } from '../ConflictReviewCard';
import { TaskDetailDrawer } from '../TaskPanel';
import { ArtifactPanel, DEFAULT_ARTIFACT_PANEL_WIDTH, type ArtifactTab } from '../ArtifactPanel';
import { TopBar } from '../TopBar';
import { WorkspaceSetup } from '../WorkspaceSetup';
import { createTimelineItemFromRun } from '../../store/timeline';
import { Badge } from '../ui/Badge';
import { normalizeMarkdownTables } from '../../utils/markdown';
import type { Agent, Message, Mention, PlanCardModel, Task, TaskAssignment, TaskDetail } from '../../types';

function slugifyAgentName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseMentions(input: string, agents: Agent[]) {
  const lookup = new Map<string, Agent>();
  for (const agent of agents.filter((item) => item.enabled)) {
    lookup.set(agent.name.toLowerCase(), agent);
    lookup.set(agent.slug.toLowerCase(), agent);
    const slug = slugifyAgentName(agent.name);
    if (slug) lookup.set(slug, agent);
  }

  const mentionedAgents: Agent[] = [];
  const mentions: Mention[] = [];
  const prompt = input.replace(/@([a-zA-Z0-9_-]+)/g, (match, rawToken: string) => {
    const agent = lookup.get(rawToken.toLowerCase());
    if (!agent) {
      mentions.push({ type: rawToken.toLowerCase() === 'orchestrator' ? 'orchestrator' : 'unknown', targetId: null, raw: match });
      return match;
    }
    if (!mentionedAgents.some((item) => item.id === agent.id)) mentionedAgents.push(agent);
    mentions.push({ type: 'agent', targetId: agent.id, raw: match });
    return ' ';
  });

  return {
    agents: mentionedAgents,
    mentions,
    prompt: prompt.replace(/\s+/g, ' ').trim(),
  };
}

function hasOrchestratorMention(input: string) {
  return /@orchestrator\b/i.test(input);
}

function stripOrchestratorMention(input: string) {
  return input.replace(/@orchestrator\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function formatWorkspaceBlockedError(error: ApiError) {
  const status = error.workspaceStatus;
  if (!status || status.state !== 'dirty') {
    return error.message;
  }
  const files =
    status.dirtyFilesSample.length > 0
      ? ` ${status.dirtyFilesSample.join(', ')}`
      : '';
  return `工作区有未提交改动，已阻止新的写入任务。${files}。${status.suggestion}`;
}

export function ChatArea() {
  const { state, dispatch } = useApp();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showArtifactPanel, setShowArtifactPanel] = useState(false);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>('diff');
  const [selectedArtifactRunId, setSelectedArtifactRunId] = useState<string | null>(null);
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(DEFAULT_ARTIFACT_PANEL_WIDTH);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskPanelError, setTaskPanelError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [loadingTaskDetail, setLoadingTaskDetail] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
  const [taskActionLoading, setTaskActionLoading] = useState<'cancel' | 'rerun' | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousConvIdRef = useRef<string | null>(null);

  const convId = state.selectedConvId;
  const timeline = useMemo(() => (convId ? state.timeline[convId] ?? [] : []), [convId, state.timeline]);
  const plans = useMemo(() => (convId ? state.plansByConversation[convId] ?? [] : []), [convId, state.plansByConversation]);
  const workspace = useMemo(() => (convId ? state.workspaces[convId] ?? null : null), [convId, state.workspaces]);
  const messages = useMemo(() => (convId ? state.messagesByConversation[convId] ?? [] : []), [convId, state.messagesByConversation]);
  const planning = useMemo(() => (convId ? state.planningByConversation?.[convId] ?? null : null), [convId, state.planningByConversation]);
  const activeRunIds = useMemo(() => (convId ? state.activeRunIdsByConversation[convId] ?? [] : []), [convId, state.activeRunIdsByConversation]);
  const defaultAgentId = useMemo(() => state.agents.find((agent) => agent.enabled && agent.is_default)?.id ?? state.agents.find((agent) => agent.enabled && agent.adapter_type === 'claude_cli')?.id, [state.agents]);
  const defaultAgentSlug = useMemo(() => state.agents.find((agent) => agent.enabled && agent.is_default)?.slug ?? null, [state.agents]);
  const runtimeUnavailable = useMemo(() => state.agents.some((agent) => agent.enabled && agent.status === 'unavailable'), [state.agents]);

  async function loadTasksPanelData(conversationId: string) {
    setLoadingTasks(true);
    setTaskPanelError(null);
    try {
      const [nextTasks, nextAssignments] = await Promise.all([
        api.getConversationTasks(conversationId),
        api.getConversationAssignments(conversationId),
      ]);
      setTasks(nextTasks);
      setAssignments(nextAssignments);
    } catch (e: unknown) {
      setTaskPanelError(e instanceof Error ? e.message : '加载任务失败');
    } finally {
      setLoadingTasks(false);
    }
  }

  async function loadTaskDetail(taskId: string) {
    setLoadingTaskDetail(true);
    setTaskDetailError(null);
    setTaskActionError(null);
    try {
      const detail = await api.getTaskDetail(taskId);
      setTaskDetail(detail);
    } catch (e: unknown) {
      setTaskDetailError(e instanceof Error ? e.message : '加载任务详情失败');
    } finally {
      setLoadingTaskDetail(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, timeline, plans]);

  useEffect(() => {
    if (previousConvIdRef.current === convId) return;
    previousConvIdRef.current = convId;
    setShowArtifactPanel(false);
    setArtifactTab('diff');
    setSelectedArtifactRunId(null);
    setTasks([]);
    setAssignments([]);
    setLoadingTasks(false);
    setTaskPanelError(null);
    setSelectedTaskId(null);
    setTaskDetail(null);
    setLoadingTaskDetail(false);
    setTaskDetailError(null);
    setTaskActionLoading(null);
    setTaskActionError(null);
  }, [convId]);

  const feedEntries = useMemo(() => {
    const rank = (kind: 'message' | 'plan' | 'run') => (kind === 'message' ? 0 : kind === 'plan' ? 1 : 2);
    return [
      ...messages.map((message) => ({ kind: 'message' as const, key: `message-${message.id}`, at: message.created_at, message })),
      ...plans.map((plan) => ({ kind: 'plan' as const, key: `plan-${plan.id}`, at: plan.createdAt, plan })),
      ...timeline.map((item) => ({ kind: 'run' as const, key: item.id, at: item.startedAt, item })),
    ].sort((a, b) => {
      const timeDiff = new Date(a.at).getTime() - new Date(b.at).getTime();
      if (timeDiff !== 0) return timeDiff;
      const rankDiff = rank(a.kind) - rank(b.kind);
      if (rankDiff !== 0) return rankDiff;
      return a.key.localeCompare(b.key);
    });
  }, [messages, plans, timeline]);

  async function openTask(taskId: string) {
    setShowArtifactPanel(true);
    setArtifactTab('diff');
    setSelectedTaskId(taskId);
    await loadTaskDetail(taskId);
  }

  function openArtifacts(tab: ArtifactTab, runId?: string | null) {
    setShowArtifactPanel(true);
    setArtifactTab(tab);
    setSelectedArtifactRunId(runId ?? null);
    if (tab === 'tasks' && convId) {
      void loadTasksPanelData(convId);
    }
  }

  async function handleCancelTask() {
    if (!convId || !taskDetail) return;
    setTaskActionLoading('cancel');
    setTaskActionError(null);
    try {
      const updatedTask = await api.updateTaskStatus(taskDetail.task.id, 'cancelled');
      setTaskDetail((current) => current ? { ...current, task: updatedTask, assignments: current.assignments.map((assignment) => assignment.id === current.assignments[0]?.id ? { ...assignment, status: 'cancelled' } : assignment) } : current);
      setTasks((current) => current.map((task) => (task.id === updatedTask.id ? updatedTask : task)));
      setAssignments((current) => current.map((assignment) => assignment.id === taskDetail.assignments[0]?.id ? { ...assignment, status: 'cancelled' } : assignment));
      dispatch({ type: 'UPDATE_PLAN_ITEM_TASK', payload: { convId, taskId: updatedTask.id, status: 'cancelled' } });
    } catch (e: unknown) {
      setTaskActionError(e instanceof Error ? e.message : '取消任务失败');
    } finally {
      setTaskActionLoading(null);
    }
  }

  async function handleRerunTask() {
    if (!convId || !taskDetail) return;
    setTaskActionLoading('rerun');
    setTaskActionError(null);
    try {
      const response = await api.rerunTask(taskDetail.task.id);
      const nextItem = createTimelineItemFromRun(response.run);
      dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: nextItem } });
      dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: response.run.id } });
      dispatch({ type: 'UPDATE_PLAN_ITEM_TASK', payload: { convId, taskId: response.task.id, assignmentId: response.assignment?.id, runId: response.run.id, status: response.run.status } });
      socketService.subscribeRun(response.run.id);
      setTasks((current) => current.map((task) => (task.id === response.task.id ? response.task : task)));
      if (response.assignment) {
        setAssignments((current) => current.map((assignment) => assignment.id === response.assignment?.id ? response.assignment : assignment));
      }
      setTaskDetail({ task: response.task, assignments: response.assignment ? [response.assignment] : taskDetail.assignments, latestRun: response.run });
    } catch (e: unknown) {
      setTaskActionError(e instanceof Error ? e.message : '重跑任务失败');
    } finally {
      setTaskActionLoading(null);
    }
  }

  async function handleResumePlanFrom(planId: string, plannerTaskId: string) {
    if (!convId) return;
    const confirmed = window.confirm(`将重新执行 ${plannerTaskId} 以及依赖它的下游任务。继续吗？`);
    if (!confirmed) return;

    setTaskActionLoading('rerun');
    setTaskActionError(null);
    try {
      const response = await api.resumePlan(planId, plannerTaskId);
      for (const run of response.runs) {
        dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: createTimelineItemFromRun(run) } });
        if (run.status === 'queued' || run.status === 'running') {
          dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: run.id } });
          socketService.subscribeRun(run.id);
        }
      }
      await loadConversationRuntime(convId, dispatch);
      if (selectedTaskId) {
        await loadTaskDetail(selectedTaskId);
      }
    } catch (e: unknown) {
      setTaskActionError(e instanceof Error ? e.message : '重新编排失败');
      dispatch({ type: 'SET_ERROR', payload: e instanceof Error ? e.message : '重新编排失败' });
    } finally {
      setTaskActionLoading(null);
    }
  }

  async function handleSend() {
    if (!input.trim() || !convId || sending) return;
    const rawPrompt = input.trim();
    setInput('');
    setSending(true);
    try {
      if (hasOrchestratorMention(rawPrompt)) {
        const prompt = stripOrchestratorMention(rawPrompt) || rawPrompt.replace(/@orchestrator\b/gi, '').trim();
        const parsed = parseMentions(rawPrompt, state.agents);
        const userMessage = await api.createMessage(convId, { content: rawPrompt, mentions: parsed.mentions, messageType: 'command' });
        dispatch({ type: 'ADD_MESSAGE', payload: { convId, message: userMessage } });
        dispatch({ type: 'START_ORCHESTRATOR_PLANNING', payload: { convId, prompt } });
        const response = await api.orchestrateConversation(convId, prompt, userMessage.id);
        const plan: PlanCardModel = {
          id: response.plan.id,
          conversationId: convId,
          prompt,
          summary: response.plan.summary,
          dagPreview: response.plan.dagPreview,
          items: response.plan.items.map((item) => ({
            index: item.index,
            plannerTaskId: item.plannerTaskId,
            title: item.title,
            description: item.description,
            taskType: item.taskType,
            expectedOutput: item.expectedOutput,
            affectedFiles: item.affectedFiles,
            dependsOn: item.dependsOn,
            suggestedAgent: item.suggestedAgent,
            assignedAgentId: item.assignedAgentId,
            assignedAgentName: item.assignedAgentName,
            taskId: item.taskId,
            assignmentId: item.assignmentId,
            runId: item.runId,
            status: item.status,
            outputSummary: item.outputSummary,
          })),
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_PLAN_CARD', payload: { convId, plan } });
        dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
        for (const run of response.runs) {
          dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: createTimelineItemFromRun(run) } });
          dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: run.id } });
          socketService.subscribeRun(run.id);
        }
      } else {
        const mentionResult = parseMentions(rawPrompt, state.agents);
        const prompt = mentionResult.prompt || rawPrompt;
        const messageType = mentionResult.mentions.length > 0 ? 'command' : 'text';
        const userMessage = await api.createMessage(convId, { content: rawPrompt, mentions: mentionResult.mentions, messageType });
        dispatch({ type: 'ADD_MESSAGE', payload: { convId, message: userMessage } });
        const targetAgentIds = mentionResult.agents.length > 0 ? mentionResult.agents.map((agent) => agent.id) : [defaultAgentId].filter((value): value is string => Boolean(value));
        if (targetAgentIds.length === 0) {
          dispatch({ type: 'SET_ERROR', payload: '没有可用的 Agent' });
          return;
        }
        await Promise.all(targetAgentIds.map((agentId) => startRun(convId, prompt, agentId, userMessage.id, workspace, dispatch)));
      }
    } catch (e: unknown) {
      if (convId) {
        dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
      }
      if (e instanceof ApiError && e.code === 'dirty_workspace_blocked') {
        dispatch({ type: 'SET_ERROR', payload: formatWorkspaceBlockedError(e) });
      } else {
        dispatch({ type: 'SET_ERROR', payload: e instanceof Error ? e.message : '启动运行失败' });
      }
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!convId) return <WorkspaceSetup />;
  if (convId && !workspace) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10" style={{ backgroundColor: 'var(--app-bg)' }}>
        <WorkspaceSetup compact />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[var(--app-bg)]">
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-150"
        style={{ paddingRight: showArtifactPanel ? artifactPanelWidth + 32 : 0 }}
      >
        <TopBar onOpenArtifacts={openArtifacts} />
        <div className="flex-1 overflow-y-auto px-8 py-5">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            {state.error ? (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: 'var(--status-danger)' }}>
                {state.error}
              </div>
            ) : state.loadingTimeline ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
              </div>
            ) : feedEntries.length === 0 ? (
              <ChatEmptyState onFillPrompt={setInput} agents={state.agents} />
            ) : (
              feedEntries.map((entry) => (
                entry.kind === 'message'
                  ? <MessageCard key={entry.key} message={entry.message} agents={state.agents} />
                  : entry.kind === 'plan'
                    ? <PlanCard key={entry.key} plan={entry.plan} onOpenTask={openTask} onResumeFrom={handleResumePlanFrom} onFocusArtifacts={(runId, tab) => openArtifacts(tab, runId)} />
                    : <RunCard key={entry.key} item={entry.item} isActive={activeRunIds.includes(entry.item.runId)} onInterrupt={() => socketService.interruptRun(entry.item.runId)} onFocusArtifacts={(runId, tab) => openArtifacts(tab, runId)} />
              ))
            )}
            {planning ? <OrchestratorPlanningCard planning={planning} /> : null}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="sticky bottom-0 px-8 pb-6 pt-5" style={{ borderTop: '0.5px solid var(--app-border)', backgroundColor: 'var(--app-bg)' }}>
          {!workspace && (
            <div className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FFFBEB', color: 'var(--status-warning)' }}>
              Bind a workspace path above to enable agent runs.
            </div>
          )}
          <div className="mx-auto w-full max-w-5xl">
            <ChatInputArea
              input={input}
              onChange={setInput}
              onSend={() => void handleSend()}
              onKeyDown={handleKeyDown}
              sending={sending}
              disabled={!workspace}
              agents={state.agents}
              runtimeUnavailable={runtimeUnavailable}
              defaultAgentSlug={defaultAgentSlug}
              showDemoChips={feedEntries.length > 0}
            />
          </div>
        </div>

        {showArtifactPanel && (
          <ArtifactPanel
            open={showArtifactPanel}
            activeTab={artifactTab}
            selectedRunId={selectedArtifactRunId}
            width={artifactPanelWidth}
            tasks={tasks}
            assignments={assignments}
            agents={state.agents}
            plans={plans}
            timeline={timeline}
            onOpenTask={openTask}
            onWidthChange={setArtifactPanelWidth}
            onTabChange={(tab) => {
              setArtifactTab(tab);
              if (tab === 'tasks' && convId) void loadTasksPanelData(convId);
            }}
            onClose={() => {
              setShowArtifactPanel(false);
              setSelectedTaskId(null);
              setTaskDetail(null);
              setTaskDetailError(null);
              setTaskActionError(null);
              setSelectedArtifactRunId(null);
            }}
            loadingTasks={loadingTasks}
            taskError={taskPanelError}
          />
        )}
        {showArtifactPanel && selectedTaskId && (
          <TaskDetailDrawer
            detail={taskDetail}
            agents={state.agents}
            planItem={plans.flatMap((plan) => plan.items).find((item) => item.taskId === selectedTaskId) ?? null}
            loading={loadingTaskDetail}
            error={taskDetailError}
            actionLoading={taskActionLoading}
            actionError={taskActionError}
            onClose={() => {
              setSelectedTaskId(null);
              setTaskDetail(null);
              setTaskDetailError(null);
              setTaskActionError(null);
            }}
            onCancelTask={() => void handleCancelTask()}
            onRerunTask={() => void handleRerunTask()}
            onResumeFromPlan={(plannerTaskId) => {
              const plan = plans.find((entry) => entry.items.some((item) => item.taskId === selectedTaskId));
              if (plan) {
                void handleResumePlanFrom(plan.id, plannerTaskId);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function ChatInputArea({
  input,
  onChange,
  onSend,
  onKeyDown,
  sending,
  disabled,
  agents,
  runtimeUnavailable,
  defaultAgentSlug,
  showDemoChips,
}: {
  input: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  sending: boolean;
  disabled: boolean;
  agents: Agent[];
  runtimeUnavailable: boolean;
  defaultAgentSlug: string | null;
  showDemoChips: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [selectedMention, setSelectedMention] = useState(0);
  const demoPrompts = [
    '让 Orchestrator 检查项目结构',
    '创建一个前端任务',
    '为最近改动补充测试',
  ];
  const demoPromptMap: Record<string, string> = {
    '让 Orchestrator 检查项目结构': '@orchestrator 请检查当前项目结构，并建议下一步可以实现的任务',
    '创建一个前端任务': '@frontend-agent 请创建或优化一个简单的首页界面',
    '为最近改动补充测试': '@tester-agent 请为最近的功能改动补充或完善测试',
  };

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.min(node.scrollHeight, 112)}px`;
  }, [input]);

  const mentionQuery = useMemo(() => {
    const match = input.match(/@([a-zA-Z0-9_-]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [input]);

  const mentionAgents = useMemo(() => {
    const base = [
      { id: 'orchestrator', name: 'Orchestrator', slug: 'orchestrator', enabled: true, status: 'active' as const },
      ...agents,
    ];
    if (mentionQuery === null) return [];
    return base.filter((agent) => agent.slug.toLowerCase().includes(mentionQuery) || agent.name.toLowerCase().includes(mentionQuery));
  }, [agents, mentionQuery]);

  useEffect(() => {
    setMentionOpen(mentionQuery !== null && mentionAgents.length > 0);
    setSelectedMention(0);
  }, [mentionAgents.length, mentionQuery]);

  function applyMention(slug: string) {
    onChange(input.replace(/@([a-zA-Z0-9_-]*)$/, `@${slug} `));
    setMentionOpen(false);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedMention((value) => (value + 1) % mentionAgents.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedMention((value) => (value - 1 + mentionAgents.length) % mentionAgents.length);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const target = mentionAgents[selectedMention];
        if (target) applyMention(target.slug);
        return;
      }
    }
    onKeyDown(event);
  }

  const mentionTokens = Array.from(input.matchAll(/@([a-zA-Z0-9_-]+)/g)).map((match) => match[1]);

  return (
    <div className="space-y-3">
      {runtimeUnavailable && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FFFBEB', color: 'var(--status-warning)', border: '0.5px solid #FDE68A' }}>
          ⚠ runtime 当前不可用，请检查配置
        </div>
      )}
      {showDemoChips && (
        <div className="flex flex-wrap gap-2">
          {demoPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onChange(demoPromptMap[prompt])}
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ backgroundColor: 'var(--card-bg)', color: 'var(--app-text-secondary)', border: '0.5px solid var(--app-border)' }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)' }}>
        {mentionTokens.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {mentionTokens.map((slug) => (
              <Badge key={`${slug}-${input}`} variant={slug === 'orchestrator' ? 'muted' : 'running'}>
                @{slug}
              </Badge>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={defaultAgentSlug ? `Ask agents to build, fix, review, or preview... (default @${defaultAgentSlug}, @orchestrator)` : 'Ask agents to build, fix, review, or preview... (@agent-name, @orchestrator)'}
            rows={1}
            className="w-full resize-none bg-transparent pr-20 text-sm outline-none"
            style={{ color: 'var(--app-text)', maxHeight: '112px', minHeight: '24px', overflowY: 'auto' }}
          />
          {mentionOpen && (
            <div
              className="absolute bottom-full left-0 mb-2 w-full rounded-lg"
              style={{ backgroundColor: 'var(--card-bg)', border: '0.5px solid var(--app-border)', boxShadow: '0 8px 24px rgba(26,26,24,0.08)' }}
            >
              {mentionAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => applyMention(agent.slug)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                  style={{ backgroundColor: index === selectedMention ? 'var(--card-subtle)' : 'transparent', color: 'var(--app-text)' }}
                >
                  <span>{agent.name} <span style={{ color: 'var(--app-text-secondary)' }}>@{agent.slug}</span></span>
                  <Badge variant={agent.status === 'active' ? 'completed' : 'failed'}>
                    {agent.status === 'active' ? '可用' : '不可用'}
                  </Badge>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label="Send"
            onClick={onSend}
            disabled={!input.trim() || sending || disabled}
            className="absolute bottom-0 right-0 rounded-lg px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: !input.trim() || sending || disabled ? 'var(--card-strong)' : 'var(--app-accent)',
              color: !input.trim() || sending || disabled ? 'var(--app-text-secondary)' : '#FFFFFF',
            }}
          >
            {sending ? '...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageCard({ message, agents }: { message: Message; agents: Agent[] }) {
  const isUser = message.sender_type === 'user';
  const title = message.sender_type === 'orchestrator' ? 'Orchestrator' : message.sender_type === 'system' ? 'System' : message.sender_type === 'agent' ? message.sender_id ?? 'Agent' : null;
  const avatarLabel = (title ?? 'A').trim().charAt(0).toUpperCase();
  const time = useMemo(() => {
    try {
      return new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }, [message.created_at]);
  const content = useMemo(() => {
    if (!message.mentions || message.mentions.length === 0) return message.content;
    let result = message.content;
    for (const m of message.mentions) {
      const agent = m.type === 'agent' ? agents.find((item) => item.id === m.targetId) : null;
      const label = m.type === 'orchestrator'
        ? '@orchestrator'
        : m.type === 'agent'
          ? `@${agent?.slug ?? m.raw.replace(/^@/, '')}`
          : m.raw;
      result = result.replace(m.raw, `**${label}**`);
    }
    return result;
  }, [agents, message.content, message.mentions]);

  if (message.message_type === 'conflict_review') {
    return <ConflictReviewCard message={message} title={title} time={time} avatarLabel={avatarLabel} />;
  }

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      data-message-role={isUser ? 'user' : 'agent'}
    >
      <div
        className="min-w-0"
        style={{
          maxWidth: isUser ? '70%' : '78%',
          marginLeft: isUser ? 'auto' : undefined,
          marginRight: isUser ? undefined : 'auto',
        }}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-3 px-1">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
            >
              {avatarLabel}
            </div>
            <div className="min-w-0 flex items-center gap-2">
              <span className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                {title ?? 'Message'}
              </span>
              <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                {time}
              </span>
            </div>
          </div>
        )}

        <div
          className="rounded-2xl px-5 py-4"
          style={{
            backgroundColor: isUser ? '#EFF8FF' : '#FFFFFF',
            color: 'var(--app-text)',
            border: isUser ? '0.5px solid #BFDBFE' : '0.5px solid #E8E7E4',
          }}
        >
          {isUser && (
            <div className="mb-2 flex items-center justify-end gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
                You
              </span>
              <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>
                {time}
              </span>
            </div>
          )}
          <div className="markdown-body text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdownTables(content)}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

const demoPrompts = [
  { title: '让 Orchestrator 检查项目结构', text: '@orchestrator 请检查当前项目结构，并建议下一步可以实现的任务' },
  { title: '创建一个前端任务', text: '@frontend-agent 请创建或优化一个简单的首页界面' },
  { title: '为最近改动补充测试', text: '@tester-agent 请为最近的功能改动补充或完善测试' },
];

function ChatEmptyState({
  onFillPrompt,
  agents,
}: {
  onFillPrompt: (text: string) => void;
  agents: Agent[];
}) {
  const defaultSlug = agents.find((a) => a.is_default)?.slug ?? null;
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="max-w-md space-y-6">
        <div className="space-y-3 text-left">
          <GuidanceStep index={1}>
            直接指定 Agent：
            <InlineCode>
              @{defaultSlug ?? 'agent-name'} 帮我实现一个登录页
            </InlineCode>
          </GuidanceStep>
          <GuidanceStep index={2}>
            让 Orchestrator 拆任务：
            <InlineCode>
              @orchestrator 帮我实现登录页和登录接口
            </InlineCode>
          </GuidanceStep>
          <GuidanceStep index={3}>
            Run 完成后可以查看 Diff、启动 Preview、确认 Apply，并清理临时工作区
          </GuidanceStep>
        </div>
        <div className="space-y-2">
          <p className="text-xs" style={{ color: '#484F58' }}>快速开始</p>
          {demoPrompts.map((prompt) => (
            <button
            key={prompt.title}
            type="button"
            onClick={() => onFillPrompt(prompt.text)}
            className="w-full text-left rounded-lg px-4 py-3 text-sm transition-colors hover:opacity-90"
            style={{ backgroundColor: '#FFFFFF', color: 'var(--app-text)', border: '0.5px solid var(--app-border)', boxShadow: '0 1px 2px rgba(9, 9, 11, 0.04)' }}
          >
            <div className="font-medium" style={{ color: 'var(--app-text)' }}>{prompt.title}</div>
            <div className="text-xs mt-1 truncate" style={{ color: 'var(--app-text-secondary)' }}>{prompt.text}</div>
          </button>
        ))}
      </div>
      </div>
    </div>
  );
}

function GuidanceStep({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm" style={{ color: 'var(--color-muted)' }}>
      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium" style={{ backgroundColor: 'var(--color-elevated)', color: 'var(--color-accent)' }}>
        {index}
      </span>
      <span>{children}</span>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="mx-1 inline-flex rounded-md px-2 py-0.5 text-[12px]"
      style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)', fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </code>
  );
}
