import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness, waitFor } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

describe("AgentHub realtime events", () => {
  it("routes room subscriptions and interrupts through socket handlers", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "Realtime",
      type: "single",
    });
    expect(conversation.statusCode).toBe(201);
    const conversationBody = conversation.json();

    const workspace = await client.post(
      `/conversations/${conversationBody.id}/workspace`,
      { rootPath: harness.workspacePath },
    );
    expect(workspace.statusCode).toBe(201);

    const run = await client.post(`/conversations/${conversationBody.id}/runs`, {
      prompt: "slow hello",
    });
    expect(run.statusCode).toBe(201);
    const runBody = run.json();

    const handlers = new Map<string, (...args: unknown[]) => void>();
    const joined: string[] = [];
    const left: string[] = [];
    const fakeSocket = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler);
      },
      join(room: string) {
        joined.push(room);
      },
      leave(room: string) {
        left.push(room);
      },
    };

    harness.server.realtimeServer.registerSocket(fakeSocket);
    handlers.get("join_conversation")?.(conversationBody.id);
    handlers.get("subscribe_run")?.(runBody.id);

    expect(joined).toContain(`conversation:${conversationBody.id}`);
    expect(joined).toContain(`run:${runBody.id}`);

    handlers.get("interrupt_run")?.(runBody.id);

    await waitFor(async () => {
      const currentRun = await client.get(`/runs/${runBody.id}`);
      return currentRun.json().status === "interrupted";
    });

    handlers.get("leave_conversation")?.(conversationBody.id);
    expect(left).toContain(`conversation:${conversationBody.id}`);
  });

  it("emits one event across both conversation-room and run-room subscriptions", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const emits: Array<{ rooms: string[]; event: string }> = [];
    const originalTo = harness.server.realtimeServer.io.to.bind(
      harness.server.realtimeServer.io,
    );

    (harness.server.realtimeServer.io.to as unknown as (
      room: string,
    ) => { to: (nextRoom: string) => { emit: (event: string, payload: unknown) => void }; emit: (event: string, payload: unknown) => void }) = (room: string) => ({
      to(nextRoom: string) {
        return {
          emit(event: string) {
            emits.push({ rooms: [room, nextRoom], event });
          },
        };
      },
      emit(event: string) {
        emits.push({ rooms: [room], event });
      },
    });

    harness.server.realtimeServer.emitRunEvent({
      type: "text_delta",
      runId: "run-1",
      conversationId: "conv-1",
      agentId: "agent-1",
      taskId: null,
      delta: "hello",
    });

    expect(emits).toEqual([
      {
        rooms: ["conversation:conv-1", "run:run-1"],
        event: "text_delta",
      },
    ]);

    harness.server.realtimeServer.io.to = originalTo;
  });

  it("emits run_status_changed as a supplemental socket event", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const emits: Array<{ rooms: string[]; event: string }> = [];
    const originalTo = harness.server.realtimeServer.io.to.bind(
      harness.server.realtimeServer.io,
    );

    (
      harness.server.realtimeServer.io.to as unknown as (
        room: string,
      ) => {
        to: (nextRoom: string) => {
          emit: (event: string, payload: unknown) => void;
        };
        emit: (event: string, payload: unknown) => void;
      }
    ) = (room: string) => ({
      to(nextRoom: string) {
        return {
          emit(event: string) {
            emits.push({ rooms: [room, nextRoom], event });
          },
        };
      },
      emit(event: string) {
        emits.push({ rooms: [room], event });
      },
    });

    harness.server.realtimeServer.emitRunEvent({
      type: "run_status_changed",
      runId: "run-1",
      conversationId: "conv-1",
      agentId: "agent-1",
      taskId: "task-1",
      status: "completed",
    });

    expect(emits).toEqual([
      {
        rooms: ["conversation:conv-1", "run:run-1"],
        event: "run_status_changed",
      },
    ]);

    harness.server.realtimeServer.io.to = originalTo;
  });
});
