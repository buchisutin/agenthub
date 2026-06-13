import { RuntimeAdapterCheck, RuntimeAdapterInfo } from "../shared/types.js";
import { AgentRuntime } from "./base/agent-runtime.js";

export class RuntimeRegistry {
  constructor(private readonly runtimes: Record<string, AgentRuntime>) {}

  hasAdapter(adapterType: string): boolean {
    return Boolean(this.runtimes[adapterType]);
  }

  getAdapter(adapterType: string): AgentRuntime {
    const runtime = this.runtimes[adapterType];
    if (!runtime) {
      throw new Error(`No runtime adapter registered for ${adapterType}`);
    }
    return runtime;
  }

  getAdapterInfo(adapterType: string): RuntimeAdapterInfo | null {
    const runtime = this.runtimes[adapterType];
    if (!runtime) {
      return null;
    }
    return {
      adapterType,
      displayName: runtime.displayName ?? adapterType,
      capabilities: runtime.capabilities ?? [],
      registered: true,
    };
  }

  listAdapters(): RuntimeAdapterInfo[] {
    return Object.keys(this.runtimes)
      .sort((a, b) => a.localeCompare(b))
      .map((adapterType) => this.getAdapterInfo(adapterType)!)
      .filter(Boolean);
  }

  checkAdapterSync(adapterType: string): RuntimeAdapterCheck {
    const runtime = this.getAdapter(adapterType);
    if (runtime.checkAvailabilitySync) {
      try {
        return {
          ...runtime.checkAvailabilitySync(),
          adapterType,
        };
      } catch (error) {
        return {
          adapterType,
          available: false,
          message: error instanceof Error ? error.message : "Runtime check failed",
          executablePath: null,
          version: null,
        };
      }
    }

    if (!runtime.checkAvailability) {
      return {
        adapterType,
        available: true,
        message: "No runtime-specific availability check provided",
        executablePath: null,
        version: null,
      };
    }

    try {
      const result = runtime.checkAvailability();
      if (result instanceof Promise) {
        throw new Error("Runtime check must be synchronous in createRun path");
      }
      return {
        ...result,
        adapterType,
      };
    } catch (error) {
      return {
        adapterType,
        available: false,
        message: error instanceof Error ? error.message : "Runtime check failed",
        executablePath: null,
        version: null,
      };
    }
  }

  async checkAdapter(adapterType: string): Promise<RuntimeAdapterCheck> {
    try {
      const runtime = this.getAdapter(adapterType);
      if (!runtime.checkAvailability) {
        return this.checkAdapterSync(adapterType);
      }
      const result = await runtime.checkAvailability();
      return {
        ...result,
        adapterType,
      };
    } catch (error) {
      return {
        adapterType,
        available: false,
        message: error instanceof Error ? error.message : "Runtime check failed",
        executablePath: null,
        version: null,
      };
    }
  }
}
