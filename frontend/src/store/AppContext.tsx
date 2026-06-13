import {
  createContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import type {
  Agent,
  ApprovalRequiredEvent,
  Conversation,
  OrchestratorPlanningDoneEvent,
  OrchestratorPlanningStartedEvent,
  OrchestratorTextDeltaEvent,
  RunStatusChangedEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunInterruptedEvent,
  TextDeltaEvent,
  ToolCompletedEvent,
  ToolErrorEvent,
  ToolInputDeltaEvent,
  ToolResultEvent,
  ToolStartedEvent,
} from '../types';
import { initialState, reducer, type Action, type AppState } from './appState';
import { loadConversationRuntime } from './runtimeActions';

// eslint-disable-next-line react-refresh/only-export-components
export const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    socketService.connect();
    socketService.setHandlers({
      onConnectionChange: (connected) => dispatch({ type: 'SET_CONNECTED', payload: connected }),
      onTextDelta: (event: TextDeltaEvent) => {
        dispatch({
          type: 'APPLY_TEXT_DELTA',
          payload: {
            convId: event.conversationId,
            runId: event.runId,
            delta: event.delta,
          },
        });
      },
      onToolStarted: (event: ToolStartedEvent) => {
        dispatch({
          type: 'APPLY_TOOL_STARTED',
          payload: event,
        });
      },
      onToolInputDelta: (event: ToolInputDeltaEvent) => {
        dispatch({
          type: 'APPLY_TOOL_INPUT_DELTA',
          payload: event,
        });
      },
      onToolCompleted: (event: ToolCompletedEvent) => {
        dispatch({
          type: 'APPLY_TOOL_COMPLETED',
          payload: event,
        });
      },
      onToolResult: (event: ToolResultEvent) => {
        dispatch({
          type: 'APPLY_TOOL_RESULT',
          payload: event,
        });
      },
      onToolError: (event: ToolErrorEvent) => {
        dispatch({
          type: 'APPLY_TOOL_ERROR',
          payload: event,
        });
      },
      onApprovalRequired: (event: ApprovalRequiredEvent) => {
        dispatch({
          type: 'APPLY_APPROVAL_REQUIRED',
          payload: {
            convId: event.conversationId,
            runId: event.runId,
            reason: event.reason,
          },
        });
      },
      onRunStatusChanged: (event: RunStatusChangedEvent) => {
        dispatch({
          type: 'APPLY_RUN_STATUS_CHANGED',
          payload: event,
        });
      },
      onRunCompleted: (event: RunCompletedEvent) => {
        dispatch({
          type: 'COMPLETE_RUN',
          payload: {
            convId: event.conversationId,
            runId: event.runId,
            finalText: event.finalText,
            exitCode: event.exitCode,
          },
        });
        void loadConversationRuntime(event.conversationId, dispatch).catch(() => undefined);
      },
      onRunFailed: (event: RunFailedEvent) => {
        dispatch({
          type: 'FAIL_RUN',
          payload: {
            convId: event.conversationId,
            runId: event.runId,
            error: event.error,
            status: 'failed',
          },
        });
        void loadConversationRuntime(event.conversationId, dispatch).catch(() => undefined);
      },
      onRunInterrupted: (event: RunInterruptedEvent) => {
        dispatch({
          type: 'FAIL_RUN',
          payload: {
            convId: event.conversationId,
            runId: event.runId,
            error: event.reason,
            status: 'interrupted',
          },
        });
        void loadConversationRuntime(event.conversationId, dispatch).catch(() => undefined);
      },
      onOrchestratorPlanningStarted: (event: OrchestratorPlanningStartedEvent) => {
        dispatch({
          type: 'START_ORCHESTRATOR_PLANNING',
          payload: {
            convId: event.conversationId,
            prompt: event.prompt,
          },
        });
      },
      onOrchestratorTextDelta: (event: OrchestratorTextDeltaEvent) => {
        dispatch({
          type: 'APPEND_ORCHESTRATOR_PLANNING_TEXT',
          payload: {
            convId: event.conversationId,
            delta: event.delta,
          },
        });
      },
      onOrchestratorPlanningDone: (event: OrchestratorPlanningDoneEvent) => {
        dispatch({
          type: 'CLEAR_ORCHESTRATOR_PLANNING',
          payload: {
            convId: event.conversationId,
          },
        });
      },
    });

    dispatch({ type: 'SET_LOADING_CONVS', payload: true });
    dispatch({ type: 'SET_LOADING_AGENTS', payload: true });

    Promise.all([
      api.listConversations().catch((e) => {
        dispatch({ type: 'SET_ERROR', payload: e.message });
        return [] as Conversation[];
      }),
      api.listAgents().catch((e) => {
        dispatch({ type: 'SET_ERROR', payload: e.message });
        return [] as Agent[];
      }),
    ])
      .then(([convs, agents]) => {
        dispatch({ type: 'SET_CONVERSATIONS', payload: convs });
        dispatch({ type: 'SET_AGENTS', payload: agents });
      })
      .finally(() => {
        dispatch({ type: 'SET_LOADING_CONVS', payload: false });
        dispatch({ type: 'SET_LOADING_AGENTS', payload: false });
      });

    return () => socketService.disconnect();
  }, []);

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}
