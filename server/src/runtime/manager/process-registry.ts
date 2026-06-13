import { RuntimeRunHandle } from "../base/agent-runtime.js";

export class ProcessRegistry {
  private readonly handles = new Map<string, RuntimeRunHandle>();

  set(runId: string, handle: RuntimeRunHandle): void {
    this.handles.set(runId, handle);
  }

  get(runId: string): RuntimeRunHandle | undefined {
    return this.handles.get(runId);
  }

  delete(runId: string): void {
    this.handles.delete(runId);
  }

  values(): RuntimeRunHandle[] {
    return Array.from(this.handles.values());
  }
}
