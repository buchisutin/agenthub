import { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { RunManager } from "../runtime/manager/run-manager.js";
import { OrchestratorEvent, RuntimeEvent } from "../shared/types.js";

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function runRoom(runId: string): string {
  return `run:${runId}`;
}

export interface SocketLike {
  on(event: string, handler: (...args: any[]) => void): unknown;
  join(room: string): unknown;
  leave(room: string): unknown;
}

export class RealtimeServer {
  readonly io: Server;

  constructor(server: HttpServer, private readonly runManager: RunManager) {
    this.io = new Server(server, {
      cors: {
        origin: "*",
      },
    });

    this.io.on("connection", (socket) => this.registerSocket(socket));
  }

  registerSocket(socket: SocketLike): void {
    socket.on("join_conversation", (conversationId: string) => {
      socket.join(conversationRoom(conversationId));
    });

    socket.on("leave_conversation", (conversationId: string) => {
      socket.leave(conversationRoom(conversationId));
    });

    socket.on("subscribe_run", (runId: string) => {
      socket.join(runRoom(runId));
    });

    socket.on("interrupt_run", async (runId: string) => {
      try {
        await this.runManager.interruptRun(runId);
      } catch {
        // Best-effort socket action; API remains source of truth for errors.
      }
    });
  }

  emitRunEvent(event: RuntimeEvent): void {
    this.io
      .to(conversationRoom(event.conversationId))
      .to(runRoom(event.runId))
      .emit(event.type, event);
  }

  emitConversationEvent(event: OrchestratorEvent): void {
    this.io.to(conversationRoom(event.conversationId)).emit(event.type, event);
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}
