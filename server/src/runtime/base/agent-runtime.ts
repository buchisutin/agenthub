import { RuntimeEvent } from "../../shared/types.js";
import { RuntimeAdapterCheck } from "../../shared/types.js";

export interface RuntimeStartInput {
  runId: string;
  conversationId: string;
  prompt: string;
  workspacePath: string;
  resumeSessionId?: string | null;
  agentConfig?: Record<string, unknown> | null;
}

export interface RuntimeCompletion {
  status: "completed" | "failed" | "interrupted";
  exitCode: number | null;
  errorMessage?: string;
}

export interface RuntimeRunHandle {
  pid: number | undefined;
  completion: Promise<RuntimeCompletion>;
}

export interface RuntimeEventHandler {
  onEvent(event: RuntimeEvent): Promise<void>;
}

export interface AgentRuntime {
  readonly displayName?: string;
  readonly capabilities?: string[];

  startRun(
    input: RuntimeStartInput,
    handler: RuntimeEventHandler,
  ): Promise<RuntimeRunHandle>;

  interruptRun(runId: string): Promise<void>;

  checkAvailabilitySync?(): RuntimeAdapterCheck;
  checkAvailability?(): Promise<RuntimeAdapterCheck> | RuntimeAdapterCheck;
}
