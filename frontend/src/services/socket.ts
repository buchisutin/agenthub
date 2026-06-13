import { io, Socket } from 'socket.io-client';
import type {
  ApprovalRequiredEvent,
  CommandOutputEvent,
  CommandStartedEvent,
  FileChangedEvent,
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

const SOCKET_URL = 'http://localhost:8000';

export type SocketEventHandler = {
  onTextDelta?: (event: TextDeltaEvent) => void;
  onToolStarted?: (event: ToolStartedEvent) => void;
  onToolInputDelta?: (event: ToolInputDeltaEvent) => void;
  onToolCompleted?: (event: ToolCompletedEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onToolError?: (event: ToolErrorEvent) => void;
  onCommandStarted?: (event: CommandStartedEvent) => void;
  onCommandOutput?: (event: CommandOutputEvent) => void;
  onFileChanged?: (event: FileChangedEvent) => void;
  onApprovalRequired?: (event: ApprovalRequiredEvent) => void;
  onRunStatusChanged?: (event: RunStatusChangedEvent) => void;
  onRunCompleted?: (event: RunCompletedEvent) => void;
  onRunFailed?: (event: RunFailedEvent) => void;
  onRunInterrupted?: (event: RunInterruptedEvent) => void;
  onOrchestratorPlanningStarted?: (event: OrchestratorPlanningStartedEvent) => void;
  onOrchestratorTextDelta?: (event: OrchestratorTextDeltaEvent) => void;
  onOrchestratorPlanningDone?: (event: OrchestratorPlanningDoneEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
};

export class SocketService {
  private socket: Socket | null = null;
  private currentConvId: string | null = null;
  private handlers: SocketEventHandler = {};
  private seenEventIds = new Set<string>();

  private dispatchEvent<T extends { eventId?: string }>(
    event: T,
    handler?: (event: T) => void,
  ) {
    if (event.eventId) {
      if (this.seenEventIds.has(event.eventId)) {
        return;
      }
      this.seenEventIds.add(event.eventId);
      if (this.seenEventIds.size > 5000) {
        const oldest = this.seenEventIds.values().next().value;
        if (oldest) {
          this.seenEventIds.delete(oldest);
        }
      }
    }
    handler?.(event);
  }

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this.handlers.onConnectionChange?.(true);
      if (this.currentConvId) {
        this.socket?.emit('join_conversation', this.currentConvId);
      }
    });

    this.socket.on('disconnect', () => {
      this.handlers.onConnectionChange?.(false);
    });

    this.socket.on('text_delta', (event: TextDeltaEvent) => {
      this.dispatchEvent(event, this.handlers.onTextDelta);
    });
    this.socket.on('tool_started', (event: ToolStartedEvent) => {
      this.dispatchEvent(event, this.handlers.onToolStarted);
    });
    this.socket.on('tool_input_delta', (event: ToolInputDeltaEvent) => {
      this.dispatchEvent(event, this.handlers.onToolInputDelta);
    });
    this.socket.on('tool_completed', (event: ToolCompletedEvent) => {
      this.dispatchEvent(event, this.handlers.onToolCompleted);
    });
    this.socket.on('tool_result', (event: ToolResultEvent) => {
      this.dispatchEvent(event, this.handlers.onToolResult);
    });
    this.socket.on('tool_error', (event: ToolErrorEvent) => {
      this.dispatchEvent(event, this.handlers.onToolError);
    });
    this.socket.on('command_started', (event: CommandStartedEvent) => {
      this.dispatchEvent(event, this.handlers.onCommandStarted);
    });
    this.socket.on('command_output', (event: CommandOutputEvent) => {
      this.dispatchEvent(event, this.handlers.onCommandOutput);
    });
    this.socket.on('file_changed', (event: FileChangedEvent) => {
      this.dispatchEvent(event, this.handlers.onFileChanged);
    });
    this.socket.on('approval_required', (event: ApprovalRequiredEvent) => {
      this.dispatchEvent(event, this.handlers.onApprovalRequired);
    });
    this.socket.on('run_status_changed', (event: RunStatusChangedEvent) => {
      this.dispatchEvent(event, this.handlers.onRunStatusChanged);
    });
    this.socket.on('run_completed', (event: RunCompletedEvent) => {
      this.dispatchEvent(event, this.handlers.onRunCompleted);
    });
    this.socket.on('run_failed', (event: RunFailedEvent) => {
      this.dispatchEvent(event, this.handlers.onRunFailed);
    });
    this.socket.on('run_interrupted', (event: RunInterruptedEvent) => {
      this.dispatchEvent(event, this.handlers.onRunInterrupted);
    });
    this.socket.on('orchestrator_planning_started', (event: OrchestratorPlanningStartedEvent) => {
      this.dispatchEvent(event, this.handlers.onOrchestratorPlanningStarted);
    });
    this.socket.on('orchestrator_text_delta', (event: OrchestratorTextDeltaEvent) => {
      this.dispatchEvent(event, this.handlers.onOrchestratorTextDelta);
    });
    this.socket.on('orchestrator_planning_done', (event: OrchestratorPlanningDoneEvent) => {
      this.dispatchEvent(event, this.handlers.onOrchestratorPlanningDone);
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
    this.seenEventIds.clear();
  }

  setHandlers(handlers: SocketEventHandler) {
    this.handlers = handlers;
  }

  joinConversation(conversationId: string) {
    if (this.currentConvId && this.currentConvId !== conversationId) {
      this.socket?.emit('leave_conversation', this.currentConvId);
    }
    this.currentConvId = conversationId;
    this.socket?.emit('join_conversation', conversationId);
  }

  leaveConversation(conversationId: string) {
    this.socket?.emit('leave_conversation', conversationId);
    if (this.currentConvId === conversationId) {
      this.currentConvId = null;
    }
  }

  subscribeRun(runId: string) {
    this.socket?.emit('subscribe_run', runId);
  }

  interruptRun(runId: string) {
    this.socket?.emit('interrupt_run', runId);
  }
}

export const socketService = new SocketService();
