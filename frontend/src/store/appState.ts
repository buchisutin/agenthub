import type {
  Agent,
  ChatTimelineItem,
  Conversation,
  Message,
  OrchestratorPlanningState,
  PlanCardModel,
  RunStatusChangedEvent,
  ToolCompletedEvent,
  ToolErrorEvent,
  ToolInputDeltaEvent,
  ToolResultEvent,
  ToolStartedEvent,
  Workspace,
} from '../types';
import { applySocketEventToTimelineItem } from './timeline';

export interface AppState {
  conversations: Conversation[];
  selectedConvId: string | null;
  agents: Agent[];
  workspaces: Record<string, Workspace | null>;
  messagesByConversation: Record<string, Message[]>;
  timeline: Record<string, ChatTimelineItem[]>;
  plansByConversation: Record<string, PlanCardModel[]>;
  planningByConversation?: Record<string, OrchestratorPlanningState | null>;
  activeRunIdsByConversation: Record<string, string[]>;
  workspaceRevisionById?: Record<string, number>;
  connected: boolean;
  loadingConvs: boolean;
  loadingAgents: boolean;
  loadingTimeline: boolean;
  error: string | null;
}

export type Action =
  | { type: 'SET_CONVERSATIONS'; payload: Conversation[] }
  | { type: 'UPDATE_CONVERSATION'; payload: Conversation }
  | { type: 'ADD_CONVERSATION'; payload: Conversation }
  | { type: 'REMOVE_CONVERSATION'; payload: string }
  | { type: 'SELECT_CONVERSATION'; payload: string | null }
  | { type: 'SET_AGENTS'; payload: Agent[] }
  | { type: 'SET_WORKSPACE'; payload: { convId: string; workspace: Workspace | null } }
  | {
      type: 'SET_CONVERSATION_CONTENT';
      payload: {
        convId: string;
        messages: Message[];
        plans: PlanCardModel[];
        items: ChatTimelineItem[];
      };
    }
  | { type: 'SET_MESSAGES'; payload: { convId: string; messages: Message[] } }
  | { type: 'ADD_MESSAGE'; payload: { convId: string; message: Message } }
  | { type: 'SET_TIMELINE'; payload: { convId: string; items: ChatTimelineItem[] } }
  | { type: 'ADD_PLAN_CARD'; payload: { convId: string; plan: PlanCardModel } }
  | { type: 'START_ORCHESTRATOR_PLANNING'; payload: { convId: string; prompt: string } }
  | { type: 'APPEND_ORCHESTRATOR_PLANNING_TEXT'; payload: { convId: string; delta: string } }
  | { type: 'CLEAR_ORCHESTRATOR_PLANNING'; payload: { convId: string } }
  | { type: 'UPDATE_PLAN_ITEM_STATUS'; payload: { convId: string; runId: string; status: ToolStatusLike } }
  | {
      type: 'UPDATE_PLAN_ITEM_TASK';
      payload: {
        convId: string;
        taskId: string;
        status?: ToolStatusLike;
        runId?: string;
        assignmentId?: string;
      };
    }
  | { type: 'UPSERT_TIMELINE_ITEM'; payload: { convId: string; item: ChatTimelineItem } }
  | { type: 'SET_ACTIVE_RUNS'; payload: { convId: string; runIds: string[] } }
  | { type: 'ADD_ACTIVE_RUN'; payload: { convId: string; runId: string } }
  | { type: 'REMOVE_ACTIVE_RUN'; payload: { convId: string; runId: string } }
  | { type: 'BUMP_WORKSPACE_REVISION'; payload: { workspaceId: string } }
  | { type: 'APPLY_TEXT_DELTA'; payload: { convId: string; runId: string; delta: string } }
  | { type: 'APPLY_TOOL_STARTED'; payload: ToolStartedEvent }
  | { type: 'APPLY_TOOL_INPUT_DELTA'; payload: ToolInputDeltaEvent }
  | { type: 'APPLY_TOOL_COMPLETED'; payload: ToolCompletedEvent }
  | { type: 'APPLY_TOOL_RESULT'; payload: ToolResultEvent }
  | { type: 'APPLY_TOOL_ERROR'; payload: ToolErrorEvent }
  | { type: 'APPLY_RUN_STATUS_CHANGED'; payload: RunStatusChangedEvent }
  | { type: 'APPLY_APPROVAL_REQUIRED'; payload: { convId: string; runId: string; reason: string; approvalId: string; toolName?: string; toolInput?: Record<string, unknown> } }
  | { type: 'UPDATE_APPROVAL_STATUS'; payload: { convId: string; runId: string; approvalId: string; status: 'approved' | 'rejected' | 'cancelled' | 'executed' | 'failed' } }
  | { type: 'COMPLETE_RUN'; payload: { convId: string; runId: string; finalText: string; exitCode: number } }
  | { type: 'FAIL_RUN'; payload: { convId: string; runId: string; error: string; status: 'failed' | 'interrupted' } }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_LOADING_CONVS'; payload: boolean }
  | { type: 'SET_LOADING_AGENTS'; payload: boolean }
  | { type: 'SET_LOADING_TIMELINE'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_ERROR' };

export const initialState: AppState = {
  conversations: [],
  selectedConvId: null,
  agents: [],
  workspaces: {},
  messagesByConversation: {},
  timeline: {},
  plansByConversation: {},
  planningByConversation: {},
  activeRunIdsByConversation: {},
  workspaceRevisionById: {},
  connected: false,
  loadingConvs: false,
  loadingAgents: false,
  loadingTimeline: false,
  error: null,
};

type ToolStatusLike = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';

function updateTimelineItem(
  items: ChatTimelineItem[],
  runId: string,
  updater: (item: ChatTimelineItem) => ChatTimelineItem,
): ChatTimelineItem[] {
  return items.map((item) => (item.runId === runId ? updater(item) : item));
}

function dedupeRunIds(runIds: string[]) {
  return Array.from(new Set(runIds));
}

function applyAgentNames(
  timeline: Record<string, ChatTimelineItem[]>,
  agents: Agent[],
) {
  const namesById = new Map(agents.map((agent) => [agent.id, agent.name]));
  return Object.fromEntries(
    Object.entries(timeline).map(([convId, items]) => [
      convId,
      items.map((item) => ({
        ...item,
        agentName: namesById.get(item.agentId) ?? item.agentName ?? item.agentId,
      })),
    ]),
  );
}

function sortMessages(messages: Message[]) {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function updatePlansByRunStatus(
  plans: Record<string, PlanCardModel[]>,
  convId: string,
  runId: string,
  status: ToolStatusLike,
) {
  const currentPlans = plans[convId] ?? [];
  return {
    ...plans,
    [convId]: currentPlans.map((plan) => ({
      ...plan,
      items: plan.items.map((item) =>
        item.runId === runId ? { ...item, status } : item,
      ),
    })),
  };
}

function updatePlansByTask(
  plans: Record<string, PlanCardModel[]>,
  convId: string,
  taskId: string,
  input: {
    status?: ToolStatusLike;
    runId?: string;
    assignmentId?: string;
  },
) {
  const currentPlans = plans[convId] ?? [];
  return {
    ...plans,
    [convId]: currentPlans.map((plan) => ({
      ...plan,
      items: plan.items.map((item) =>
        item.taskId === taskId
          ? {
              ...item,
              status: input.status ?? item.status,
              runId: input.runId ?? item.runId,
              assignmentId: input.assignmentId ?? item.assignmentId,
            }
          : item,
      ),
    })),
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CONVERSATIONS':
      return { ...state, conversations: action.payload };
    case 'ADD_CONVERSATION':
      return { ...state, conversations: [action.payload, ...state.conversations] };
    case 'REMOVE_CONVERSATION': {
      const id = action.payload;
      return {
        ...state,
        conversations: state.conversations.filter((c) => c.id !== id),
        workspaces: Object.fromEntries(Object.entries(state.workspaces).filter(([k]) => k !== id)),
        messagesByConversation: Object.fromEntries(Object.entries(state.messagesByConversation).filter(([k]) => k !== id)),
        timeline: Object.fromEntries(Object.entries(state.timeline).filter(([k]) => k !== id)),
        plansByConversation: Object.fromEntries(Object.entries(state.plansByConversation).filter(([k]) => k !== id)),
        planningByConversation: Object.fromEntries(Object.entries(state.planningByConversation ?? {}).filter(([k]) => k !== id)),
        activeRunIdsByConversation: Object.fromEntries(Object.entries(state.activeRunIdsByConversation).filter(([k]) => k !== id)),
      };
    }
    case 'UPDATE_CONVERSATION':
      return {
        ...state,
        conversations: state.conversations.map((conversation) =>
          conversation.id === action.payload.id ? action.payload : conversation,
        ),
      };
    case 'SELECT_CONVERSATION':
      return { ...state, selectedConvId: action.payload };
    case 'SET_AGENTS':
      return {
        ...state,
        agents: action.payload,
        timeline: applyAgentNames(state.timeline, action.payload),
      };
    case 'SET_WORKSPACE':
      return {
        ...state,
        workspaces: { ...state.workspaces, [action.payload.convId]: action.payload.workspace },
      };
    case 'BUMP_WORKSPACE_REVISION':
      return {
        ...state,
        workspaceRevisionById: {
          ...(state.workspaceRevisionById ?? {}),
          [action.payload.workspaceId]:
            (state.workspaceRevisionById?.[action.payload.workspaceId] ?? 0) + 1,
        },
      };
    case 'SET_CONVERSATION_CONTENT':
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.payload.convId]: sortMessages(action.payload.messages),
        },
        plansByConversation: {
          ...state.plansByConversation,
          [action.payload.convId]: action.payload.plans,
        },
        timeline: {
          ...state.timeline,
          [action.payload.convId]: applyAgentNames(
            { [action.payload.convId]: action.payload.items },
            state.agents,
          )[action.payload.convId],
        },
      };
    case 'SET_MESSAGES':
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.payload.convId]: sortMessages(action.payload.messages),
        },
      };
    case 'ADD_MESSAGE': {
      const current = state.messagesByConversation[action.payload.convId] ?? [];
      return {
        ...state,
        messagesByConversation: {
          ...state.messagesByConversation,
          [action.payload.convId]: sortMessages([...current, action.payload.message]),
        },
      };
    }
    case 'SET_TIMELINE':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.convId]: applyAgentNames(
            { [action.payload.convId]: action.payload.items },
            state.agents,
          )[action.payload.convId],
        },
      };
    case 'ADD_PLAN_CARD': {
      const current = state.plansByConversation[action.payload.convId] ?? [];
      return {
        ...state,
        plansByConversation: {
          ...state.plansByConversation,
          [action.payload.convId]: [...current, action.payload.plan].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          ),
        },
        planningByConversation: {
          ...(state.planningByConversation ?? {}),
          [action.payload.convId]: null,
        },
      };
    }
    case 'START_ORCHESTRATOR_PLANNING':
      return {
        ...state,
        planningByConversation: {
          ...(state.planningByConversation ?? {}),
          [action.payload.convId]: {
            conversationId: action.payload.convId,
            prompt: action.payload.prompt,
            output: '',
            startedAt: new Date().toISOString(),
          },
        },
      };
    case 'APPEND_ORCHESTRATOR_PLANNING_TEXT': {
      const current = state.planningByConversation?.[action.payload.convId];
      if (!current) {
        return {
          ...state,
          planningByConversation: {
            ...(state.planningByConversation ?? {}),
            [action.payload.convId]: {
              conversationId: action.payload.convId,
              prompt: '',
              output: action.payload.delta,
              startedAt: new Date().toISOString(),
            },
          },
        };
      }
      return {
        ...state,
        planningByConversation: {
          ...(state.planningByConversation ?? {}),
          [action.payload.convId]: {
            ...current,
            output: current.output + action.payload.delta,
          },
        },
      };
    }
    case 'CLEAR_ORCHESTRATOR_PLANNING':
      return {
        ...state,
        planningByConversation: {
          ...(state.planningByConversation ?? {}),
          [action.payload.convId]: null,
        },
      };
    case 'UPDATE_PLAN_ITEM_STATUS':
      return {
        ...state,
        plansByConversation: updatePlansByRunStatus(
          state.plansByConversation,
          action.payload.convId,
          action.payload.runId,
          action.payload.status,
        ),
      };
    case 'UPDATE_PLAN_ITEM_TASK':
      return {
        ...state,
        plansByConversation: updatePlansByTask(
          state.plansByConversation,
          action.payload.convId,
          action.payload.taskId,
          {
            status: action.payload.status,
            runId: action.payload.runId,
            assignmentId: action.payload.assignmentId,
          },
        ),
      };
    case 'UPSERT_TIMELINE_ITEM': {
      const current = state.timeline[action.payload.convId] ?? [];
      const nextItem = {
        ...action.payload.item,
        agentName:
          state.agents.find((agent) => agent.id === action.payload.item.agentId)?.name ??
          action.payload.item.agentName ??
          action.payload.item.agentId,
      };
      const idx = current.findIndex((item) => item.runId === action.payload.item.runId);
      if (idx === -1) {
        return {
          ...state,
          timeline: {
            ...state.timeline,
            [action.payload.convId]: [...current, nextItem].sort(
              (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
            ),
          },
        };
      }

      const updated = [...current];
      updated[idx] = nextItem;
      return {
        ...state,
        timeline: { ...state.timeline, [action.payload.convId]: updated },
      };
    }
    case 'SET_ACTIVE_RUNS':
      return {
        ...state,
        activeRunIdsByConversation: {
          ...state.activeRunIdsByConversation,
          [action.payload.convId]: dedupeRunIds(action.payload.runIds),
        },
      };
    case 'ADD_ACTIVE_RUN': {
      const current = state.activeRunIdsByConversation[action.payload.convId] ?? [];
      return {
        ...state,
        activeRunIdsByConversation: {
          ...state.activeRunIdsByConversation,
          [action.payload.convId]: dedupeRunIds([...current, action.payload.runId]),
        },
      };
    }
    case 'REMOVE_ACTIVE_RUN': {
      const current = state.activeRunIdsByConversation[action.payload.convId] ?? [];
      return {
        ...state,
        activeRunIdsByConversation: {
          ...state.activeRunIdsByConversation,
          [action.payload.convId]: current.filter((runId) => runId !== action.payload.runId),
        },
      };
    }
    case 'APPLY_TEXT_DELTA':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.convId]: updateTimelineItem(
            state.timeline[action.payload.convId] ?? [],
            action.payload.runId,
            (item) =>
              applySocketEventToTimelineItem(item, {
                type: 'text_delta',
                runId: action.payload.runId,
                conversationId: action.payload.convId,
                agentId: item.agentId,
                taskId: item.taskId,
                delta: action.payload.delta,
              }),
          ),
        },
      };
    case 'APPLY_TOOL_STARTED':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.conversationId]: updateTimelineItem(
            state.timeline[action.payload.conversationId] ?? [],
            action.payload.runId,
            (item) => applySocketEventToTimelineItem(item, action.payload),
          ),
        },
      };
    case 'APPLY_TOOL_INPUT_DELTA':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.conversationId]: updateTimelineItem(
            state.timeline[action.payload.conversationId] ?? [],
            action.payload.runId,
            (item) => applySocketEventToTimelineItem(item, action.payload),
          ),
        },
      };
    case 'APPLY_TOOL_COMPLETED':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.conversationId]: updateTimelineItem(
            state.timeline[action.payload.conversationId] ?? [],
            action.payload.runId,
            (item) => applySocketEventToTimelineItem(item, action.payload),
          ),
        },
      };
    case 'APPLY_TOOL_RESULT':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.conversationId]: updateTimelineItem(
            state.timeline[action.payload.conversationId] ?? [],
            action.payload.runId,
            (item) => applySocketEventToTimelineItem(item, action.payload),
          ),
        },
      };
    case 'APPLY_TOOL_ERROR':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.conversationId]: updateTimelineItem(
            state.timeline[action.payload.conversationId] ?? [],
            action.payload.runId,
            (item) => applySocketEventToTimelineItem(item, action.payload),
          ),
        },
      };
    case 'APPLY_RUN_STATUS_CHANGED':
      return {
        ...state,
        plansByConversation: updatePlansByRunStatus(
          state.plansByConversation,
          action.payload.conversationId,
          action.payload.runId,
          action.payload.status,
        ),
      };
    case 'APPLY_APPROVAL_REQUIRED':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.convId]: updateTimelineItem(
            state.timeline[action.payload.convId] ?? [],
            action.payload.runId,
            (item) =>
              applySocketEventToTimelineItem(item, {
                type: 'approval_required',
                runId: action.payload.runId,
                conversationId: action.payload.convId,
                agentId: item.agentId,
                taskId: item.taskId,
                reason: action.payload.reason,
                approvalId: action.payload.approvalId,
                rawEvent: action.payload.toolInput
                  ? { tool_name: action.payload.toolName, tool_input: action.payload.toolInput }
                  : undefined,
              }),
          ),
        },
      };
    case 'UPDATE_APPROVAL_STATUS':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.convId]: (state.timeline[action.payload.convId] ?? []).map((item) => {
            if (item.runId !== action.payload.runId) return item;
            return {
              ...item,
              blocks: item.blocks.map((block) =>
                block.kind === 'approval_request' && block.approvalId === action.payload.approvalId
                  ? { ...block, status: action.payload.status }
                  : block,
              ),
            };
          }),
        },
      };
    case 'COMPLETE_RUN':
      return {
        ...state,
        timeline: {
          ...state.timeline,
          [action.payload.convId]: updateTimelineItem(
            state.timeline[action.payload.convId] ?? [],
            action.payload.runId,
            (item) =>
              applySocketEventToTimelineItem(item, {
                type: 'run_completed',
                runId: action.payload.runId,
                conversationId: action.payload.convId,
                agentId: '',
                taskId: null,
                finalText: action.payload.finalText,
                exitCode: action.payload.exitCode,
              }),
          ),
        },
        activeRunIdsByConversation: {
          ...state.activeRunIdsByConversation,
          [action.payload.convId]: (state.activeRunIdsByConversation[action.payload.convId] ?? [])
            .filter((runId) => runId !== action.payload.runId),
        },
        plansByConversation: updatePlansByRunStatus(
          state.plansByConversation,
          action.payload.convId,
          action.payload.runId,
          'completed',
        ),
      };
    case 'FAIL_RUN':
      return action.payload.status === 'failed'
        ? {
            ...state,
            timeline: {
              ...state.timeline,
              [action.payload.convId]: updateTimelineItem(
                state.timeline[action.payload.convId] ?? [],
                action.payload.runId,
                (item) =>
                  applySocketEventToTimelineItem(item, {
                    type: 'run_failed',
                    runId: action.payload.runId,
                    conversationId: action.payload.convId,
                    agentId: '',
                    taskId: null,
                    error: action.payload.error,
                  }),
              ),
            },
            activeRunIdsByConversation: {
              ...state.activeRunIdsByConversation,
              [action.payload.convId]: (state.activeRunIdsByConversation[action.payload.convId] ?? [])
                .filter((runId) => runId !== action.payload.runId),
            },
            plansByConversation: updatePlansByRunStatus(
              state.plansByConversation,
              action.payload.convId,
              action.payload.runId,
              'failed',
            ),
          }
        : {
            ...state,
            timeline: {
              ...state.timeline,
              [action.payload.convId]: updateTimelineItem(
                state.timeline[action.payload.convId] ?? [],
                action.payload.runId,
                (item) =>
                  applySocketEventToTimelineItem(item, {
                    type: 'run_interrupted',
                    runId: action.payload.runId,
                    conversationId: action.payload.convId,
                    agentId: '',
                    taskId: null,
                    reason: action.payload.error,
                  }),
              ),
            },
            activeRunIdsByConversation: {
              ...state.activeRunIdsByConversation,
              [action.payload.convId]: (state.activeRunIdsByConversation[action.payload.convId] ?? [])
                .filter((runId) => runId !== action.payload.runId),
            },
            plansByConversation: updatePlansByRunStatus(
              state.plansByConversation,
              action.payload.convId,
              action.payload.runId,
              'interrupted',
            ),
          };
    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };
    case 'SET_LOADING_CONVS':
      return { ...state, loadingConvs: action.payload };
    case 'SET_LOADING_AGENTS':
      return { ...state, loadingAgents: action.payload };
    case 'SET_LOADING_TIMELINE':
      return { ...state, loadingTimeline: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}
