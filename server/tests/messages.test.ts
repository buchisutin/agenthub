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

describe("messages and conversation timeline", () => {
  it("creates and lists messages for a conversation", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Messages",
      type: "single",
    });
    const conversationId = conversation.json().id;

    const created = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@frontend-agent 做首页",
      messageType: "command",
      mentions: [{ type: "agent", targetId: "agent-1", raw: "@frontend-agent" }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().content).toBe("@frontend-agent 做首页");

    const listed = await harness.client.get(`/conversations/${conversationId}/messages`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0].message_type).toBe("command");
  });

  it("writes source_message_id for runs created from a message and keeps old calls compatible", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Run Source Message",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const message = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "做一个登录页",
      messageType: "text",
    });
    const messageId = message.json().id;

    const runWithMessage = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "做一个登录页",
      sourceMessageId: messageId,
    });
    expect(runWithMessage.statusCode).toBe(201);
    expect(runWithMessage.json().source_message_id).toBe(messageId);

    const legacyRun = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "直接再做一次",
    });
    expect(legacyRun.statusCode).toBe(201);
    expect(legacyRun.json().source_message_id).toBeNull();
  });

  it("rejects invalid sourceMessageId when creating a run", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Invalid Source Message",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const response = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "hello",
      sourceMessageId: "missing-message",
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns timeline items for persisted user messages and runs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Timeline Restore",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const message = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "先做一个登录页",
      messageType: "text",
    });
    const messageId = message.json().id;

    const run = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "先做一个登录页",
      sourceMessageId: messageId,
    });
    const runId = run.json().id;

    await waitFor(async () => {
      const current = await harness.client.get(`/runs/${runId}`);
      return current.json().status === "completed";
    });

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json().some((item: { type: string }) => item.type === "message")).toBe(true);
    expect(timeline.json().some((item: { type: string }) => item.type === "run")).toBe(true);
  });

  it("returns persisted plan messages with orchestrated runs in timeline", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "拆成两个子任务",
        tasks: [
          {
            title: "前端页面",
            description: "实现前端页面",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
          {
            title: "后端接口",
            description: "实现后端接口",
            suggested_agent: "backend-agent",
            priority: 2,
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("frontend-agent");
    harness.createAgent("backend-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Timeline Plan Restore",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const userMessage = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个博客系统",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });

    const orchestrated = await harness.client.post(
      `/conversations/${conversationId}/orchestrate`,
      {
        prompt: "做一个博客系统",
        sourceMessageId: userMessage.json().id,
      },
    );
    expect(orchestrated.statusCode).toBe(200);

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const planItem = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(planItem).toBeTruthy();
    expect(planItem.plan.items).toHaveLength(2);
    expect(timeline.json().filter((item: { type: string }) => item.type === "run")).toHaveLength(2);
  });

  it("returns a stable timeline order across repeated requests", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "拆成两个子任务",
        tasks: [
          {
            title: "前端页面",
            description: "实现前端页面",
            suggested_agent: "frontend-agent",
            priority: 1,
          },
          {
            title: "后端接口",
            description: "实现后端接口",
            suggested_agent: "backend-agent",
            priority: 2,
          },
        ],
      }),
    });
    harnesses.push(harness);
    harness.createAgent("frontend-agent");
    harness.createAgent("backend-agent");

    const conversation = await harness.client.post("/conversations", {
      title: "Stable Timeline",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const message = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个博客系统",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });
    await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个博客系统",
      sourceMessageId: message.json().id,
    });

    const first = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const second = await harness.client.get(`/conversations/${conversationId}/timeline`);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().map((item: { type: string; message?: { id: string }; run?: { id: string } }) => ({
      type: item.type,
      id: item.message?.id ?? item.run?.id ?? null,
    }))).toEqual(
      second.json().map((item: { type: string; message?: { id: string }; run?: { id: string } }) => ({
        type: item.type,
        id: item.message?.id ?? item.run?.id ?? null,
      })),
    );

    const types = first.json().map((item: { type: string }) => item.type);
    expect(types.slice(0, 4)).toEqual(["message", "plan", "run", "run"]);
  });

  it("keeps user messages ahead of fan-out runs from the same source message", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Message Before Runs",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const frontendAgentId = harness.createAgent("frontend-agent");
    const message = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@claude-code @frontend-agent 做一个首页",
      messageType: "command",
      mentions: [
        { type: "agent", targetId: harness.server.app.locals.agentsService.ensureDefaultClaudeAgent().id, raw: "@claude-code" },
        { type: "agent", targetId: frontendAgentId, raw: "@frontend-agent" },
      ],
    });
    const messageId = message.json().id;

    const runA = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "做一个首页",
      sourceMessageId: messageId,
    });
    const runB = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "做一个首页",
      agentId: frontendAgentId,
      sourceMessageId: messageId,
    });
    expect(runA.statusCode).toBe(201);
    expect(runB.statusCode).toBe(201);

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    const json = timeline.json();
    expect(json[0].type).toBe("message");
    expect(json.slice(1).every((item: { type: string }) => item.type === "run")).toBe(true);
  });

  it("falls back to plan metadata when task records are missing and still restores the timeline", async () => {
    const harness = await createTestHarness({
      orchestratorPlanner: async () => ({
        summary: "单任务计划",
        tasks: [
          {
            title: "实现登录页",
            description: "实现登录页",
            suggested_agent: null,
            priority: 1,
          },
        ],
      }),
    });
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Metadata Fallback",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const userMessage = await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "@orchestrator 做一个登录页",
      messageType: "command",
      mentions: [{ type: "orchestrator", targetId: null, raw: "@orchestrator" }],
    });
    const orchestrated = await harness.client.post(`/conversations/${conversationId}/orchestrate`, {
      prompt: "做一个登录页",
      sourceMessageId: userMessage.json().id,
    });

    const planMessage = harness.server.app.locals.messagesService
      .listMessagesByConversation(conversationId)
      .find((item: { message_type: string }) => item.message_type === "plan");
    expect(planMessage).toBeTruthy();
    harness.server.app.locals.messagesService["database"].db
      .prepare("DELETE FROM tasks WHERE plan_message_id = ?")
      .run(planMessage.id);

    const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
    expect(timeline.statusCode).toBe(200);
    const plan = timeline.json().find((item: { type: string }) => item.type === "plan");
    expect(plan).toBeTruthy();
    expect(plan.plan.items[0].title).toBe("实现登录页");
  });

  it("cascades message deletion when the conversation is deleted", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const conversation = await harness.client.post("/conversations", {
      title: "Cascade",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/messages`, {
      content: "hello",
      messageType: "text",
    });

    const db = harness.server.app.locals.messagesService["database"].db;
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);

    const count = db
      .prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?")
      .get(conversationId) as { c: number };
    expect(Number(count.c)).toBe(0);
  });
});
