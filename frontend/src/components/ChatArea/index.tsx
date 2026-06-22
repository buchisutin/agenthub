import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'highlight.js/styles/github-dark.css';
import { useApp } from '../../store/useApp';
import { loadConversationRuntime, startRun } from '../../store/runtimeActions';
import { api, ApiError } from '../../services/api';
import { socketService } from '../../services/socket';
import { PlanCard } from '../PlanCard';
import { RunCard } from '../RunCard';
import { ToolApprovalCard } from '../ToolApprovalCard';
import { ConflictReviewCard } from '../ConflictReviewCard';
import { TaskDetailDrawer } from '../TaskPanel';
import { ProjectArtifactPanel, type ProjectArtifactTab } from '../ProjectArtifactPanel';
import { TaskWorkLogPanel } from '../TaskWorkLogPanel';
import { TopBar } from '../TopBar';
import { WorkspaceSetup } from '../WorkspaceSetup';
import { AlertTriangle, ArrowUp, ChevronDown } from '../ui/LineIcons';
import { createTimelineItemFromRun } from '../../store/timeline';
import { normalizeMarkdownTables } from '../../utils/markdown';
import type { Agent, ChatTimelineItem, Message, Mention, PlanCardModel, TaskDetail } from '../../types';

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

function stripOrchestratorMention(input: string) {
  return input.replace(/@orchestrator\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function singleAgentStorageKey(conversationId: string) {
  return `agenthub.singleAgent.${conversationId}`;
}

function readSingleAgentId(conversationId: string) {
  try {
    return localStorage.getItem(singleAgentStorageKey(conversationId));
  } catch {
    return null;
  }
}

function writeSingleAgentId(conversationId: string, agentId: string) {
  try {
    localStorage.setItem(singleAgentStorageKey(conversationId), agentId);
  } catch {
    // Local storage is only a UI preference; sending can continue without it.
  }
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
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [projectTab, setProjectTab] = useState<ProjectArtifactTab>('diff');
  const [selectedLogRunId, setSelectedLogRunId] = useState<string | null>(null);
  const [projectDiffSummary, setProjectDiffSummary] = useState<{ workspaceId: string; fileCount: number } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [loadingTaskDetail, setLoadingTaskDetail] = useState(false);
  const [taskDetailError, setTaskDetailError] = useState<string | null>(null);
  const [taskActionLoading, setTaskActionLoading] = useState<'cancel' | 'rerun' | null>(null);
  const [taskActionError, setTaskActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousConvIdRef = useRef<string | null>(null);
  const sendLockRef = useRef(false);
  const recentSendRef = useRef<{ key: string; at: number } | null>(null);

  const convId = state.selectedConvId;
  const timeline = useMemo(() => (convId ? state.timeline[convId] ?? [] : []), [convId, state.timeline]);
  const plans = useMemo(() => (convId ? state.plansByConversation[convId] ?? [] : []), [convId, state.plansByConversation]);
  const workspace = useMemo(() => (convId ? state.workspaces[convId] ?? null : null), [convId, state.workspaces]);
  const workspaceRevision = workspace ? state.workspaceRevisionById?.[workspace.id] ?? 0 : 0;
  const messages = useMemo(() => (convId ? state.messagesByConversation[convId] ?? [] : []), [convId, state.messagesByConversation]);
  const planning = useMemo(() => (convId ? state.planningByConversation?.[convId] ?? null : null), [convId, state.planningByConversation]);
  const pendingClarification = useMemo(
    () => (convId ? state.pendingClarificationConvIds?.includes(convId) ?? false : false),
    [convId, state.pendingClarificationConvIds],
  );
  const defaultAgentId = useMemo(() => state.agents.find((agent) => agent.enabled && agent.is_default)?.id ?? state.agents.find((agent) => agent.enabled && agent.adapter_type === 'claude_cli')?.id, [state.agents]);
  const defaultAgentSlug = useMemo(() => state.agents.find((agent) => agent.enabled && agent.is_default)?.slug ?? null, [state.agents]);
  const runtimeUnavailable = useMemo(() => state.agents.some((agent) => agent.enabled && agent.status === 'unavailable'), [state.agents]);
  const currentConversation = useMemo(() => state.conversations.find((conversation) => conversation.id === convId) ?? null, [convId, state.conversations]);
  const conversationType = currentConversation?.type ?? 'group';
  const [singleAgentSelection, setSingleAgentSelection] = useState<{ convId: string; agentId: string } | null>(null);
  const singleAgentId = convId && singleAgentSelection?.convId === convId
    ? singleAgentSelection.agentId
    : convId
      ? readSingleAgentId(convId)
      : null;
  const singleAgent = useMemo(
    () => state.agents.find((agent) => agent.enabled && agent.id === singleAgentId) ?? state.agents.find((agent) => agent.enabled && agent.id === defaultAgentId) ?? state.agents.find((agent) => agent.enabled) ?? null,
    [defaultAgentId, singleAgentId, state.agents],
  );
  const selectedLogItem = useMemo(
    () => timeline.find((item) => item.runId === selectedLogRunId) ?? null,
    [selectedLogRunId, timeline],
  );
  const selectedLogTaskTitle = useMemo(
    () => plans.flatMap((plan) => plan.items).find((item) => item.runId === selectedLogRunId)?.title
      ?? selectedLogItem?.prompt
      ?? '工作日志',
    [plans, selectedLogItem, selectedLogRunId],
  );
  const activePanelWidth = projectPanelOpen ? 620 : selectedLogRunId ? 420 : 0;
  const projectFileCount = projectDiffSummary && workspace?.id && projectDiffSummary.workspaceId === workspace.id
    ? projectDiffSummary.fileCount
    : 0;

  useEffect(() => {
    if (!workspace?.id) return;
    const workspaceId = workspace.id;
    let cancelled = false;
    api.getWorkspaceFileChanges(workspaceId)
      .then((result) => {
        if (!cancelled) setProjectDiffSummary({ workspaceId, fileCount: result.summary.files });
      })
      .catch(() => {
        if (!cancelled) setProjectDiffSummary({ workspaceId, fileCount: 0 });
      });
    return () => { cancelled = true; };
  }, [workspace?.id, workspaceRevision]);

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
    setProjectPanelOpen(false);
    setProjectTab('diff');
    setSelectedLogRunId(null);
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
      ...messages.filter((m) => m.message_type !== 'queued_prompt').map((message) => ({ kind: 'message' as const, key: `message-${message.id}`, at: message.created_at, message })),
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

  function openProjectArtifact(tab: 'tasks' | 'diff' | 'preview' | 'deploy') {
    setSelectedLogRunId(null);
    setProjectTab(tab === 'tasks' ? 'diff' : tab);
    setProjectPanelOpen(true);
  }

  function openWorkLog(runId: string) {
    setProjectPanelOpen(false);
    setSelectedLogRunId(runId);
  }

  async function retryRun(item: ChatTimelineItem) {
    if (!convId) throw new Error('当前会话不可用');

    if (item.taskId) {
      const response = await api.rerunTask(item.taskId);
      const nextItem = createTimelineItemFromRun(response.run);
      dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: nextItem } });
      dispatch({
        type: 'UPDATE_PLAN_ITEM_TASK',
        payload: {
          convId,
          taskId: response.task.id,
          assignmentId: response.assignment?.id,
          runId: response.run.id,
          status: response.run.status,
        },
      });
      if (response.run.status === 'queued' || response.run.status === 'running') {
        dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: response.run.id } });
        socketService.subscribeRun(response.run.id);
      }
      return;
    }

    await startRun(convId, item.prompt, item.agentId, undefined, workspace, dispatch);
  }

  async function handleCancelTask() {
    if (!convId || !taskDetail) return;
    setTaskActionLoading('cancel');
    setTaskActionError(null);
    try {
      const updatedTask = await api.updateTaskStatus(taskDetail.task.id, 'cancelled');
      setTaskDetail((current) => current ? { ...current, task: updatedTask, assignments: current.assignments.map((assignment) => assignment.id === current.assignments[0]?.id ? { ...assignment, status: 'cancelled' } : assignment) } : current);
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

  async function handleExecutePlan(planId: string) {
    if (!convId) return;
    try {
      const response = await api.executePlan(planId);
      dispatch({ type: 'UPDATE_PLAN_PREVIEW_EXECUTED', payload: { convId, planId } });
      for (const run of response.runs) {
        dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: createTimelineItemFromRun(run) } });
        dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: run.id } });
        socketService.subscribeRun(run.id);
      }
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', payload: e instanceof Error ? e.message : '执行计划失败' });
    }
  }

  async function handleSend() {
    if (!input.trim() || !convId || sending) return;
    const rawPrompt = input.trim();
    const sendKey = `${convId}:${rawPrompt}`;
    const now = Date.now();
    if (sendLockRef.current) return;
    if (recentSendRef.current?.key === sendKey && now - recentSendRef.current.at < 5000) return;
    sendLockRef.current = true;
    recentSendRef.current = { key: sendKey, at: now };
    setInput('');
    setSending(true);
    try {
      if (conversationType === 'single') {
        const agentId = singleAgent?.id ?? defaultAgentId;
        if (!agentId) {
          dispatch({ type: 'SET_ERROR', payload: '没有可用的 Agent' });
          return;
        }
        const userMessage = await api.createMessage(convId, { content: rawPrompt, mentions: [], messageType: 'text' });
        dispatch({ type: 'ADD_MESSAGE', payload: { convId, message: userMessage } });
        await startRun(convId, rawPrompt, agentId, userMessage.id, workspace, dispatch);
      } else {
        // Group conversation
        const mentionResult = parseMentions(rawPrompt, state.agents);

        if (mentionResult.agents.length > 0) {
          // Has explicit @agent mention → direct route
          const prompt = mentionResult.prompt || rawPrompt;
          const userMessage = await api.createMessage(convId, {
            content: rawPrompt,
            mentions: mentionResult.mentions,
            messageType: 'command',
          });
          dispatch({ type: 'ADD_MESSAGE', payload: { convId, message: userMessage } });
          await Promise.all(
            mentionResult.agents.map((agent) =>
              startRun(convId, prompt, agent.id, userMessage.id, workspace, dispatch),
            ),
          );
        } else {
          // No mention → orchestrate (was @orchestrator)
          const prompt = stripOrchestratorMention(rawPrompt);
          const userMessage = await api.createMessage(convId, {
            content: rawPrompt,
            mentions: [],
            messageType: 'command',
          });
          dispatch({ type: 'ADD_MESSAGE', payload: { convId, message: userMessage } });
          dispatch({ type: 'START_ORCHESTRATOR_PLANNING', payload: { convId, prompt } });
          const response = await api.orchestrateConversation(convId, prompt, userMessage.id);

          if (response.pendingClarification) {
            dispatch({ type: 'SET_PENDING_CLARIFICATION', payload: { convId } });
            dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
            return;
          }

          if (response.queued) {
            dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
            return;
          }

          dispatch({ type: 'CLEAR_PENDING_CLARIFICATION', payload: { convId } });

          if (response.plan) {
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
              preview: response.preview,
            };
            dispatch({ type: 'ADD_PLAN_CARD', payload: { convId, plan } });
            dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
            for (const run of response.runs) {
              dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item: createTimelineItemFromRun(run) } });
              dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: run.id } });
              socketService.subscribeRun(run.id);
            }
          } else {
            dispatch({ type: 'CLEAR_ORCHESTRATOR_PLANNING', payload: { convId } });
          }
        }
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
      recentSendRef.current = null;
    } finally {
      sendLockRef.current = false;
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
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-white px-6 py-10">
        <WorkspaceSetup compact />
      </div>
    );
  }

  return (
    <div
      data-testid="chat-surface"
      className="relative flex h-full min-h-0 flex-1 overflow-x-hidden"
      style={{ background: 'linear-gradient(#e8eee7 0%, #f7f7f1 55%, #fff8f7 100%)' }}
    >
      <div
        className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-150"
        style={{ paddingRight: activePanelWidth }}
      >
        <TopBar
          onOpenProjectArtifact={openProjectArtifact}
          projectPanelOpen={projectPanelOpen}
          activeProjectTab={projectTab}
          projectFileCount={projectFileCount}
        />
        <div className="flex-1 overflow-y-auto">
          <div
            data-testid="chat-message-list"
            className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-8 pb-40 pt-5"
          >
            {state.error ? (
              <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: 'var(--status-danger)' }}>
                {state.error}
              </div>
            ) : state.loadingTimeline ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }} />
              </div>
            ) : feedEntries.length === 0 ? (
              <ChatEmptyState
                onFillPrompt={setInput}
                agents={state.agents}
                conversationType={conversationType}
                singleAgentName={singleAgent?.name ?? null}
              />
            ) : (
              <>
                <div className="contents">
                {feedEntries.map((entry) => {
                if (entry.kind === 'message') {
                  return <MessageCard key={entry.key} message={entry.message} agents={state.agents} />;
                }
                if (entry.kind === 'plan') {
                  return (
                    <PlanCard
                      key={entry.key}
                      plan={entry.plan}
                      timeline={timeline}
                      onOpenWorkLog={openWorkLog}
                      onExecute={entry.plan.preview ? () => handleExecutePlan(entry.plan.id) : undefined}
                    />
                  );
                }
                // entry.kind === 'run' — suppress if this run belongs to a plan
                const belongsToPlan = plans.some((p) =>
                  p.items.some((item) => item.runId === entry.item.runId),
                );
                if (belongsToPlan) return null;
                return (
                  <div key={entry.key}>
                    <RunCard
                      item={entry.item}
                      onOpenLogs={openWorkLog}
                      onRetry={retryRun}
                    />
                    <RunResponse item={entry.item} />
                    {entry.item.blocks
                      .filter((b) => b.kind === 'approval_request' && b.approvalId)
                      .map((b) => b.kind === 'approval_request' ? <ToolApprovalCard key={b.id} block={b} /> : null)}
                  </div>
                );
              })}
              </div>
            </>
            )}
            {planning ? <SystemMessageIndicator text="正在分析需求并生成任务计划..." /> : null}
            {pendingClarification && !planning ? (
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: '#EFF6FF', color: '#1D4ED8' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                规划中 · 等待你的回复
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div
          className="absolute bottom-0 z-20 transition-[padding] duration-150"
          style={{
            left: 0,
            right: 0,
            paddingRight: activePanelWidth,
          }}
        >
          {!workspace && (
            <div className="mx-auto mb-3 w-full max-w-5xl px-8">
              <div className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FFFBEB', color: 'var(--status-warning)' }}>
                Bind a workspace path above to enable agent runs.
              </div>
            </div>
          )}
          <div data-testid="chat-composer-shell" className="mx-auto w-[65%] max-w-5xl pb-6">
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
              conversationType={conversationType}
              singleAgentId={singleAgent?.id ?? null}
              onSingleAgentChange={(agentId) => {
                if (convId) {
                  setSingleAgentSelection({ convId, agentId });
                  writeSingleAgentId(convId, agentId);
                }
              }}
            />
          </div>
        </div>

        {projectPanelOpen && workspace && (
          <ProjectArtifactPanel
            open
            activeTab={projectTab}
            workspace={workspace}
            revision={workspaceRevision}
            onClose={() => setProjectPanelOpen(false)}
          />
        )}
        {selectedLogRunId && (
          <TaskWorkLogPanel
            open
            item={selectedLogItem}
            taskTitle={selectedLogTaskTitle}
            onClose={() => setSelectedLogRunId(null)}
            onInterrupt={(runId) => socketService.interruptRun(runId)}
          />
        )}
        {selectedTaskId && (
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
  conversationType,
  singleAgentId,
  onSingleAgentChange,
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
  conversationType: 'single' | 'group';
  singleAgentId: string | null;
  onSingleAgentChange: (agentId: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const [mentionSelection, setMentionSelection] = useState<{ query: string; index: number } | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const selectedSingleAgent = enabledAgents.find((agent) => agent.id === singleAgentId) ?? enabledAgents[0] ?? null;

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.min(node.scrollHeight, 112)}px`;
  }, [input]);

  const mentionQuery = useMemo(() => {
    if (conversationType !== 'group') return null;
    const match = input.match(/@([a-zA-Z0-9_-]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [conversationType, input]);

  const mentionAgents = useMemo(() => {
    const base = [
      { id: 'orchestrator', name: 'Orchestrator', slug: 'orchestrator', enabled: true, status: 'active' as const },
      ...enabledAgents,
    ];
    if (mentionQuery === null) return [];
    return base.filter((agent) => agent.slug.toLowerCase().includes(mentionQuery) || agent.name.toLowerCase().includes(mentionQuery));
  }, [enabledAgents, mentionQuery]);
  const mentionOpen = mentionQuery !== null && mentionAgents.length > 0;
  const selectedMention = mentionSelection?.query === mentionQuery
    ? Math.min(mentionSelection.index, mentionAgents.length - 1)
    : 0;

  useEffect(() => {
    if (!agentMenuOpen) return;

    function closeAgentMenu(event: MouseEvent) {
      if (!agentMenuRef.current?.contains(event.target as Node)) setAgentMenuOpen(false);
    }

    function closeAgentMenuWithEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAgentMenuOpen(false);
    }

    document.addEventListener('mousedown', closeAgentMenu);
    document.addEventListener('keydown', closeAgentMenuWithEscape);
    return () => {
      document.removeEventListener('mousedown', closeAgentMenu);
      document.removeEventListener('keydown', closeAgentMenuWithEscape);
    };
  }, [agentMenuOpen]);

  function applyMention(slug: string) {
    onChange(input.replace(/@([a-zA-Z0-9_-]*)$/, `@${slug} `));
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionSelection({ query: mentionQuery!, index: (selectedMention + 1) % mentionAgents.length });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionSelection({
          query: mentionQuery!,
          index: (selectedMention - 1 + mentionAgents.length) % mentionAgents.length,
        });
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
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <AlertTriangle size={16} className="shrink-0 text-amber-500" />
          <span>runtime 当前不可用，请检查配置</span>
        </div>
      )}
      <div
        data-testid="chat-composer"
        className="relative z-50 rounded-2xl bg-white p-4"
        style={{ boxShadow: '0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 6px rgba(0, 0, 0, 0.03)' }}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-400">
            {conversationType === 'single' ? '单聊' : '群聊'}
          </span>
          {conversationType === 'single' ? (
            <div ref={agentMenuRef} className="relative">
              <button
                type="button"
                aria-label="选择单聊 Agent"
                aria-expanded={agentMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setAgentMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <span>{selectedSingleAgent?.name ?? 'Agent'}</span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform ${agentMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {agentMenuOpen && (
                <div
                  role="listbox"
                  aria-label="选择单聊 Agent"
                  className="absolute left-0 top-full z-[70] mt-2 min-w-44 overflow-hidden rounded-xl border border-gray-100 bg-white p-1.5"
                  style={{ boxShadow: '0 10px 25px rgba(0, 0, 0, 0.05), 0 2px 6px rgba(0, 0, 0, 0.03)' }}
                >
                  {enabledAgents.map((agent) => {
                    const selected = agent.id === selectedSingleAgent?.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-label={agent.name}
                        aria-selected={selected}
                        onClick={() => {
                          onSingleAgentChange(agent.id);
                          setAgentMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${selected ? 'bg-gray-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                      >
                        <span className="w-4 text-center text-xs text-gray-700">{selected ? '✓' : ''}</span>
                        <span>{agent.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
        {mentionTokens.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {mentionTokens.map((slug) => (
              <span key={`${slug}-${input}`} className="rounded-full bg-gray-50 px-2 py-0.5 font-mono text-[11px] font-medium text-gray-400">
                @{slug}
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={conversationType === 'single'
              ? `和 ${selectedSingleAgent?.name ?? 'Agent'} 单聊：直接描述任务，不需要 @`
              : defaultAgentSlug
                ? `群聊：直接描述需求，或 @${defaultAgentSlug} 指定成员`
                : '群聊：直接描述需求，或 @成员名 指定成员'}
            rows={1}
            className="min-h-[60px] w-full resize-none bg-transparent pr-12 text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-300"
            style={{ maxHeight: '132px', overflowY: 'auto' }}
          />
          {mentionOpen && (
            <div
              className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-gray-100/80 bg-white shadow-sm"
            >
              {mentionAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => applyMention(agent.slug)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 ${index === selectedMention ? 'bg-gray-50' : 'bg-transparent'}`}
                >
                  <span>{agent.name} <span className="font-mono text-gray-400">@{agent.slug}</span></span>
                  <span className={`text-[11px] font-medium ${agent.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>
                    {agent.status === 'active' ? '可用' : '不可用'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-label="Send"
            onClick={onSend}
            disabled={!input.trim() || sending || disabled}
            className={[
              'absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200',
              !input.trim() || sending || disabled
                ? 'bg-gray-100 text-gray-400'
                : 'bg-gray-900 text-white hover:bg-gray-800',
            ].join(' ')}
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SystemMessageIndicator({ text }: { text: string }) {
  return (
    <div className="my-4 flex items-center justify-center gap-3">
      <div className="h-px flex-1 max-w-[40px]" style={{ backgroundColor: 'var(--app-border)' }} />
      <span className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>{text}</span>
      <div className="h-px flex-1 max-w-[40px]" style={{ backgroundColor: 'var(--app-border)' }} />
    </div>
  );
}

function RunResponse({ item }: { item: ChatTimelineItem }) {
  if (item.status !== 'completed') return null;

  const content = item.blocks
    .filter((block) => block.kind === 'agent_text')
    .map((block) => block.content)
    .join('')
    .trim();

  if (!content) return null;

  return (
    <div
      data-run-response={item.runId}
      className="w-[65%] py-1 pl-11 pr-2"
      style={{ color: 'var(--app-text)' }}
    >
      <div className="markdown-body text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeMarkdownTables(content)}</ReactMarkdown>
      </div>
    </div>
  );
}

function MessageCard({ message, agents }: { message: Message; agents: Agent[] }) {
  const isUser = message.sender_type === 'user';
  const agent = agents.find((item) => item.id === message.sender_id);
  const title = message.sender_type === 'orchestrator' ? 'Orchestrator'
    : message.sender_type === 'system' ? 'System'
    : agent ? agent.name
    : 'Agent';
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

  if (message.sender_type === 'system') {
    return <SystemMessageIndicator text={message.content} />;
  }

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
          width: '65%',
          maxWidth: '65%',
          marginLeft: isUser ? 'auto' : undefined,
          marginRight: isUser ? undefined : 'auto',
        }}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-3 px-1">
            <div
              className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-xs font-semibold"
              style={{ backgroundColor: 'var(--card-strong)', color: 'var(--app-text)' }}
            >
              {avatarLabel}
            </div>
            <div className="min-w-0 flex items-center gap-2">
              <span className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                {title ?? 'Message'}
              </span>
            </div>
          </div>
        )}

        <div
          data-message-content={isUser ? 'user' : 'agent'}
          className={isUser ? 'rounded-2xl px-5 py-4' : 'py-1 pl-11 pr-2'}
          style={isUser
            ? { backgroundColor: '#EFF8FF', color: 'var(--app-text)', border: '0.5px solid #BFDBFE' }
            : { color: 'var(--app-text)' }}
        >
          {isUser && (
            <div className="mb-2 flex items-center justify-end gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--app-text-secondary)' }}>
                You
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

function ChatEmptyState({
  onFillPrompt,
  agents,
  conversationType,
  singleAgentName,
}: {
  onFillPrompt: (text: string) => void;
  agents: Agent[];
  conversationType: 'single' | 'group';
  singleAgentName: string | null;
}) {
  const defaultSlug = agents.find((a) => a.is_default)?.slug ?? null;
  const prompts = conversationType === 'single'
    ? [
        { title: `和 ${singleAgentName ?? 'Agent'} 检查项目结构`, text: '请检查当前项目结构，并建议下一步可以实现的任务' },
        { title: '实现一个小功能', text: '请实现一个小功能，并说明改动位置' },
        { title: '为最近改动补充测试', text: '请为最近的功能改动补充或完善测试' },
      ]
    : [
        { title: '检查项目结构', text: '请检查当前项目结构，列出主要模块和建议的下一步任务' },
        { title: '加登录日志功能', text: '帮我加一个用户登录日志功能：记录每次登录的时间、IP、成功/失败，写入数据库，并提供查询接口 GET /logs' },
        { title: '为登录接口补充测试', text: '请为登录和注册接口补充测试，覆盖正常流程和异常情况' },
      ];
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="max-w-md space-y-6">
        <div className="space-y-3 text-left">
          <GuidanceStep index={1}>
            {conversationType === 'single' ? '直接描述任务：' : '直接描述需求，多 Agent 自动协作：'}
            <InlineCode>
              {conversationType === 'single'
                ? '帮我加一个用户登录日志功能'
                : '帮我加一个用户登录日志功能，记录时间和 IP'}
            </InlineCode>
          </GuidanceStep>
          <GuidanceStep index={2}>
            {conversationType === 'single' ? (
              '需要多人协作时，切换到群聊模式'
            ) : (
              <>
                或 @成员名 直接指派给某个 Agent：
                <InlineCode>
                  @{defaultSlug ?? 'codex-cli'} 帮我优化登录接口性能
                </InlineCode>
              </>
            )}
          </GuidanceStep>
          <GuidanceStep index={3}>
            Run 完成后可以查看文件变更，点击任务卡了解详情
          </GuidanceStep>
        </div>
        <div className="space-y-2">
          <p className="text-xs" style={{ color: '#484F58' }}>快速开始</p>
          {prompts.map((prompt) => (
            <button
            key={prompt.title}
            type="button"
            onClick={() => onFillPrompt(prompt.text)}
            className="w-full text-left rounded-lg px-4 py-3 text-sm transition-colors hover:opacity-90"
            style={{ backgroundColor: '#F9FAFB', color: 'var(--app-text)', border: '0.5px solid var(--app-border)', boxShadow: '0 1px 2px rgba(9, 9, 11, 0.04)' }}
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
