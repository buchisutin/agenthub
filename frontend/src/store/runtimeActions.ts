import type React from 'react';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import type { PlanCardModel, Workspace } from '../types';
import type { Action } from './appState';
import { applyRunDetail, createTimelineItemFromRun } from './timeline';

function planFromTimelineMessage(
  message: {
    conversation_id: string;
    created_at: string;
  },
  plan: import('../types').TaskPlan,
): PlanCardModel {
  return {
    id: plan.id,
    conversationId: message.conversation_id,
    prompt: '',
    summary: plan.summary,
    dagPreview: plan.dagPreview,
    items: plan.items.map((item) => ({
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
    createdAt: message.created_at,
  };
}

export async function createConversation(title?: string, type: 'single' | 'group' = 'single') {
  return api.createConversation(title, type);
}

export async function loadConversationRuntime(
  convId: string,
  dispatch: React.Dispatch<Action>,
) {
  dispatch({ type: 'SET_LOADING_TIMELINE', payload: true });
  try {
    const [workspace, timeline] = await Promise.all([
      api.getWorkspace(convId).catch(() => null as Workspace | null),
      api.getConversationTimeline(convId),
    ]);

    dispatch({ type: 'SET_WORKSPACE', payload: { convId, workspace } });
    const messages = timeline
      .filter((item) => item.type === 'message')
      .map((item) => item.message);
    const plans = timeline
      .filter((item) => item.type === 'plan')
      .map((item) => planFromTimelineMessage(item.message, item.plan));
    const items = (await Promise.all(
      timeline
        .filter((item) => item.type === 'run')
        .map(async (item) => {
          if ('events' in item.run) {
            return applyRunDetail(item.run);
          }
          if (item.run.event_count > 0) {
            const detail = await api.getRun(item.run.id).catch(() => null);
            if (detail) {
              return applyRunDetail(detail);
            }
          }
          return createTimelineItemFromRun(item.run);
        }),
    )).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    dispatch({
      type: 'SET_CONVERSATION_CONTENT',
      payload: { convId, messages, plans, items },
    });

    const activeRunIds = items
      .filter((item) => item.status === 'queued' || item.status === 'running')
      .map((item) => item.runId);
    dispatch({ type: 'SET_ACTIVE_RUNS', payload: { convId, runIds: activeRunIds } });

    return { workspace, items };
  } finally {
    dispatch({ type: 'SET_LOADING_TIMELINE', payload: false });
  }
}

export async function ensureWorkspaceBound(workspace: Workspace | null) {
  if (workspace) {
    return workspace;
  }
  throw new Error('请先绑定工作目录');
}

export async function bindWorkspace(
  convId: string,
  rootPath: string,
  dispatch: React.Dispatch<Action>,
) {
  const bound = await api.bindWorkspace(convId, rootPath);
  dispatch({ type: 'SET_WORKSPACE', payload: { convId, workspace: bound } });
  return bound;
}

export async function startRun(
  convId: string,
  prompt: string,
  agentId: string | undefined,
  sourceMessageId: string | undefined,
  workspace: Workspace | null,
  dispatch: React.Dispatch<Action>,
) {
  await ensureWorkspaceBound(workspace);
  const run = await api.createRun(convId, prompt, agentId, sourceMessageId);
  const item = createTimelineItemFromRun(run);
  dispatch({ type: 'UPSERT_TIMELINE_ITEM', payload: { convId, item } });
  dispatch({ type: 'ADD_ACTIVE_RUN', payload: { convId, runId: run.id } });
  socketService.subscribeRun(run.id);
  return run;
}
