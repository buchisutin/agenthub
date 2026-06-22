import { execSync } from "node:child_process";
import fs from "node:fs";
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

describe("AgentHub local server API", () => {
  it("auto-initializes a plain workspace as a git repo during validation", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const response = await client.post("/workspaces/validate", {
      rootPath: harness.workspacePath,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exists).toBe(true);
    expect(body.isDirectory).toBe(true);
    expect(body.isGitRepo).toBe(true);
    expect(fs.realpathSync(body.gitRoot)).toBe(fs.realpathSync(harness.workspacePath));
    expect(body.errors).toEqual([]);
    expect(fs.existsSync(`${harness.workspacePath}/.git`)).toBe(true);

    const head = execSync("git rev-parse --verify HEAD", {
      cwd: harness.workspacePath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    expect(head.length).toBeGreaterThan(0);
  });

  it("allows conversation creation when workspace validation includes only git warnings", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;
    const workspacesService = harness.server.app.locals.workspacesService;
    const originalValidate = workspacesService.validateWorkspacePath.bind(workspacesService);

    workspacesService.validateWorkspacePath = () => ({
      rootPath: harness.workspacePath,
      exists: true,
      isDirectory: true,
      isGitRepo: false,
      gitRoot: null,
      packageJsonExists: false,
      previewCapable: false,
      errors: ["Git initialization warning: simulated failure"],
    });

    const response = await client.post("/conversations/with-workspace", {
      title: "Auto Git",
      rootPath: harness.workspacePath,
    });

    workspacesService.validateWorkspacePath = originalValidate;

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.validation.errors).toEqual(["Git initialization warning: simulated failure"]);
    expect(body.workspace.root_path).toBe(harness.workspacePath);
  });

  it("creates a conversation, binds a workspace, starts a run, and persists events", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "Demo",
      type: "single",
    });
    expect(conversation.statusCode).toBe(201);

    const conversationBody = conversation.json();
    const workspace = await client.post(
      `/conversations/${conversationBody.id}/workspace`,
      { rootPath: harness.workspacePath },
    );
    expect(workspace.statusCode).toBe(201);

    const runResponse = await client.post(
      `/conversations/${conversationBody.id}/runs`,
      { prompt: "hello" },
    );
    expect(runResponse.statusCode).toBe(201);

    const runResponseBody = runResponse.json();
    const runId = runResponseBody.id;
    expect(runResponseBody.status).toBe("queued");

    await waitFor(async () => {
      const run = await client.get(`/runs/${runId}`);
      return run.json().status === "completed";
    });

    const run = await client.get(`/runs/${runId}`);
    expect(run.statusCode).toBe(200);
    const runBody = run.json();
    const conversationAfterRun = await client.get(`/conversations/${conversationBody.id}`);
    expect(conversationAfterRun.json().agent_session_id).toBeUndefined();
    expect(conversationAfterRun.json().session_status).toBeUndefined();
    expect(runBody.events.every((event: { payload_json: { agentId?: string; taskId?: string | null } }) =>
      typeof event.payload_json.agentId === "string" && "taskId" in event.payload_json,
    )).toBe(true);
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "tool_started")).toBe(true);
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "tool_completed")).toBe(true);
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "tool_result")).toBe(true);
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "text_delta")).toBe(true);
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "run_completed")).toBe(true);
  });

  it("rejects run creation when the conversation has no workspace", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "No Workspace",
      type: "single",
    });
    expect(conversation.statusCode).toBe(201);
    const conversationBody = conversation.json();

    const response = await client.post(
      `/conversations/${conversationBody.id}/runs`,
      { prompt: "hello" },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toContain("workspace");
  });

  it("blocks run creation when the bound workspace has uncommitted changes", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "Dirty Workspace",
      type: "single",
    });
    expect(conversation.statusCode).toBe(201);
    const conversationBody = conversation.json();

    const workspace = await client.post(
      `/conversations/${conversationBody.id}/workspace`,
      { rootPath: harness.workspacePath },
    );
    expect(workspace.statusCode).toBe(201);

    fs.writeFileSync(`${harness.workspacePath}/hellotest.txt`, "local change\n", "utf8");

    const response = await client.post(
      `/conversations/${conversationBody.id}/runs`,
      { prompt: "hello" },
    );

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "dirty_workspace_blocked",
      workspaceStatus: {
        state: "dirty",
        dirtyFilesCount: 1,
        dirtyFilesSample: ["hellotest.txt"],
      },
    });
    expect(response.json().detail).toContain("hellotest.txt");
  });

  it("interrupts a slow run", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "Interrupt",
      type: "single",
    });
    expect(conversation.statusCode).toBe(201);
    const conversationBody = conversation.json();

    const workspace = await client.post(
      `/conversations/${conversationBody.id}/workspace`,
      { rootPath: harness.workspacePath },
    );
    expect(workspace.statusCode).toBe(201);

    const runResponse = await client.post(
      `/conversations/${conversationBody.id}/runs`,
      { prompt: "slow hello" },
    );
    expect(runResponse.statusCode).toBe(201);

    const runId = runResponse.json().id;
    await waitFor(async () => {
      const run = await client.get(`/runs/${runId}`);
      return run.json().status === "running";
    });

    const interruptResponse = await client.post(`/runs/${runId}/interrupt`);
    expect(interruptResponse.statusCode).toBe(200);

    await waitFor(async () => {
      const run = await client.get(`/runs/${runId}`);
      return run.json().status === "interrupted";
    });

    const run = await client.get(`/runs/${runId}`);
    const runBody = run.json();
    expect(runBody.events.some((event: { event_type: string }) => event.event_type === "run_interrupted")).toBe(true);
  });

  it("supports concurrent runs for multiple agents in one conversation", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;
    const frontendAgentId = harness.createAgent("frontend-agent");
    const backendAgentId = harness.createAgent("backend-agent");
    const testerAgentId = harness.createAgent("tester-agent");

    const conversation = await client.post("/conversations", {
      title: "Multi Agent",
      type: "single",
    });
    const conversationBody = conversation.json();

    await client.post(`/conversations/${conversationBody.id}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const runResponses = await Promise.all([
      client.post(`/conversations/${conversationBody.id}/runs`, {
        prompt: "slow frontend task",
        agentId: frontendAgentId,
      }),
      client.post(`/conversations/${conversationBody.id}/runs`, {
        prompt: "slow backend task",
        agentId: backendAgentId,
      }),
      client.post(`/conversations/${conversationBody.id}/runs`, {
        prompt: "slow tester task",
        agentId: testerAgentId,
      }),
    ]);

    expect(runResponses.every((response) => response.statusCode === 201)).toBe(true);
    const runIds = runResponses.map((response) => response.json().id);

    await waitFor(async () => {
      const runs = await Promise.all(runIds.map((runId) => client.get(`/runs/${runId}`)));
      return runs.every((run) => {
        const body = run.json();
        return body.status === "running" || body.status === "completed";
      });
    });

    const runDetails = await Promise.all(runIds.map((runId) => client.get(`/runs/${runId}`)));
    const agentIds = runDetails.map((response) => response.json().agent_id);
    expect(new Set(agentIds).size).toBe(3);

    const listedRuns = await client.get(`/conversations/${conversationBody.id}/runs`);
    expect(listedRuns.statusCode).toBe(200);
    const listedBodies = listedRuns.json();
    expect(listedBodies).toHaveLength(3);
    expect(new Set(listedBodies.map((run: { id: string }) => run.id))).toEqual(new Set(runIds));
    expect(new Set(listedBodies.map((run: { agent_id: string }) => run.agent_id))).toEqual(
      new Set([frontendAgentId, backendAgentId, testerAgentId]),
    );
  });

  it("interrupts only the targeted run when multiple runs are active", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;
    const frontendAgentId = harness.createAgent("frontend-agent");
    const backendAgentId = harness.createAgent("backend-agent");

    const conversation = await client.post("/conversations", {
      title: "Interrupt Isolation",
      type: "single",
    });
    const conversationId = conversation.json().id;

    await client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const firstRun = await client.post(`/conversations/${conversationId}/runs`, {
      prompt: "slow frontend task",
      agentId: frontendAgentId,
    });
    const secondRun = await client.post(`/conversations/${conversationId}/runs`, {
      prompt: "slow backend task",
      agentId: backendAgentId,
    });
    const firstRunId = firstRun.json().id;
    const secondRunId = secondRun.json().id;

    await waitFor(async () => {
      const runs = await Promise.all([
        client.get(`/runs/${firstRunId}`),
        client.get(`/runs/${secondRunId}`),
      ]);
      return runs.every((run) => run.json().status === "running");
    }, 8000);

    const interruptResponse = await client.post(`/runs/${firstRunId}/interrupt`);
    expect(interruptResponse.statusCode).toBe(200);

    await waitFor(async () => {
      const current = await client.get(`/runs/${firstRunId}`);
      return current.json().status === "interrupted";
    }, 8000);

    const interruptedRun = await client.get(`/runs/${firstRunId}`);
    const unaffectedRun = await client.get(`/runs/${secondRunId}`);
    expect(interruptedRun.json().status).toBe("interrupted");
    expect(["running", "completed"]).toContain(unaffectedRun.json().status);
  });

  it("recovers automatically when the stored resume session is stale", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conversation = await client.post("/conversations", {
      title: "Invalid Resume",
      type: "single",
    });
    const conversationBody = conversation.json();

    await client.post(`/conversations/${conversationBody.id}/workspace`, {
      rootPath: harness.workspacePath,
    });
    const firstRun = await client.post(`/conversations/${conversationBody.id}/runs`, {
      prompt: "hello",
    });
    const firstRunId = firstRun.json().id;

    await waitFor(async () => {
      const currentRun = await client.get(`/runs/${firstRunId}`);
      return currentRun.json().status === "completed";
    });

    const defaultAgent = harness.server.app.locals.agentsService.getDefaultAgent();
    const latestSession = harness.server.app.locals.agentSessionsService.getLatestByConversationAgent(
      conversationBody.id,
      defaultAgent.id,
    );
    harness.server.app.locals.agentSessionsService.bindProviderSession(
      latestSession.id,
      "stale-session-id",
    );

    const recoveredRun = await client.post(`/conversations/${conversationBody.id}/runs`, {
      prompt: "hello again",
    });
    expect(recoveredRun.statusCode).toBe(201);
    const recoveredRunId = recoveredRun.json().id;

    await waitFor(async () => {
      const currentRun = await client.get(`/runs/${recoveredRunId}`);
      return currentRun.json().status === "completed";
    });

    const recoveredSession = harness.server.app.locals.agentSessionsService.getLatestByConversationAgent(
      conversationBody.id,
      defaultAgent.id,
    );
    expect(recoveredSession.status).toBe("active");
    expect(recoveredSession.provider_session_id).toBe("mock-session-1");
    expect(recoveredSession.provider_session_id).not.toBe("stale-session-id");

    const recoveredRunDetail = await client.get(`/runs/${recoveredRunId}`);
    expect(recoveredRunDetail.json().events.some(
      (event: { event_type: string }) => event.event_type === "run_completed",
    )).toBe(true);
  });

  it("reuses sessions only within the same conversation and agent pair", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;
    const backendAgentId = harness.createAgent("backend-agent");

    const firstConversation = await client.post("/conversations", {
      title: "Session Scope A",
      type: "single",
    });
    const secondConversation = await client.post("/conversations", {
      title: "Session Scope B",
      type: "single",
    });
    const firstConversationId = firstConversation.json().id;
    const secondConversationId = secondConversation.json().id;

    await client.post(`/conversations/${firstConversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });
    await client.post(`/conversations/${secondConversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const firstDefaultRun = await client.post(`/conversations/${firstConversationId}/runs`, {
      prompt: "hello default",
    });
    const firstDefaultRunId = firstDefaultRun.json().id;
    await waitFor(async () => {
      const run = await client.get(`/runs/${firstDefaultRunId}`);
      return run.json().status === "completed";
    });

    const secondDefaultRun = await client.post(`/conversations/${firstConversationId}/runs`, {
      prompt: "hello again default",
    });
    const secondDefaultRunId = secondDefaultRun.json().id;
    await waitFor(async () => {
      const run = await client.get(`/runs/${secondDefaultRunId}`);
      return run.json().status === "completed";
    });

    const backendRun = await client.post(`/conversations/${firstConversationId}/runs`, {
      prompt: "hello backend",
      agentId: backendAgentId,
    });
    const backendRunId = backendRun.json().id;
    await waitFor(async () => {
      const run = await client.get(`/runs/${backendRunId}`);
      return run.json().status === "completed";
    });

    const otherConversationRun = await client.post(`/conversations/${secondConversationId}/runs`, {
      prompt: "hello default elsewhere",
    });
    const otherConversationRunId = otherConversationRun.json().id;
    await waitFor(async () => {
      const run = await client.get(`/runs/${otherConversationRunId}`);
      return run.json().status === "completed";
    });

    const firstRunDetail = (await client.get(`/runs/${firstDefaultRunId}`)).json();
    const secondRunDetail = (await client.get(`/runs/${secondDefaultRunId}`)).json();
    const backendRunDetail = (await client.get(`/runs/${backendRunId}`)).json();
    const otherConversationRunDetail = (await client.get(`/runs/${otherConversationRunId}`)).json();

    expect(secondRunDetail.agent_session_id).toBe(firstRunDetail.agent_session_id);
    expect(backendRunDetail.agent_session_id).not.toBe(firstRunDetail.agent_session_id);
    expect(otherConversationRunDetail.agent_session_id).not.toBe(firstRunDetail.agent_session_id);
  });

  it("returns 404 for the removed conversation session reset route", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.post("/conversations/conv-1/session/reset");
    expect(response.statusCode).toBe(404);
  });

  it("returns conversation summary with counts and empty arrays", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Summary Test", type: "single" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });

    const summary = await client.get(`/conversations/${convBody.id}/summary`);
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.conversationId).toBe(convBody.id);
    expect(body.counts).toBeDefined();
    expect(body.counts.messages).toBe(0);
    expect(body.counts.runs).toBe(0);
    expect(body.tasks).toEqual([]);
    expect(body.runs).toEqual([]);
    expect(body.changedFiles).toEqual([]);
    expect(body.workspace).toBeDefined();
  });

  it("summary returns 404 for nonexistent conversation", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const summary = await harness.client.get("/conversations/nonexistent-id/summary");
    expect(summary.statusCode).toBe(404);
  });

  it("summary includes data after a completed run", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Run Summary", type: "single" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });

    const runRes = await client.post(`/conversations/${convBody.id}/runs`, { prompt: "create a test file" });
    const runBody = runRes.json();

    await waitFor(async () => {
      const r = await client.get(`/runs/${runBody.id}`);
      return r.json().status === "completed" || r.json().status === "failed";
    }, 8000);

    const summary = await client.get(`/conversations/${convBody.id}/summary`);
    expect(summary.statusCode).toBe(200);
    const inner = summary.json();
    expect(inner.counts.runs).toBeGreaterThanOrEqual(1);
  });

  it("timeline returns messages and runs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Timeline Test", type: "single" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });

    await client.post(`/conversations/${convBody.id}/messages`, { content: "hello" });

    const runRes = await client.post(`/conversations/${convBody.id}/runs`, { prompt: "test" });
    expect(runRes.statusCode).toBe(201);

    const timeline = await client.get(`/conversations/${convBody.id}/timeline`);
    expect(timeline.statusCode).toBe(200);
    const items = timeline.json();
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i: { type: string }) => i.type === "message")).toBe(true);
    expect(items.some((i: { type: string }) => i.type === "run")).toBe(true);
  });
});

describe("Conversation deletion", () => {
  const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

  afterEach(async () => {
    while (harnesses.length > 0) {
      const h = harnesses.pop();
      if (h) await h.close();
    }
  });

  it("deletes a conversation and returns 404 for subsequent GET", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "To Delete" });
    const convBody = conv.json();

    const del = await client.del(`/conversations/${convBody.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);

    const get = await client.get(`/conversations/${convBody.id}`);
    expect(get.statusCode).toBe(404);
  });

  it("returns 404 when deleting nonexistent conversation", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const del = await harness.client.del("/conversations/nonexistent");
    expect(del.statusCode).toBe(404);
  });

  it("cascades deletion to messages", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Cascade Msg" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/messages`, { content: "hello" });

    await client.del(`/conversations/${convBody.id}`);

    const msgs = await client.get(`/conversations/${convBody.id}/messages`);
    expect(msgs.statusCode).toBe(404);
  });

  it("cascades deletion to tasks and runs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Cascade Tasks" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });
    await client.post(`/conversations/${convBody.id}/runs`, { prompt: "test" });

    await client.del(`/conversations/${convBody.id}`);

    const runs = await client.get(`/conversations/${convBody.id}/runs`);
    expect(runs.statusCode).toBe(404);
  });

  it("does not delete base workspace files when cleanupRunWorkspaces is false", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Keep Base WS" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });

    const del = await client.del(`/conversations/${convBody.id}`, { cleanupRunWorkspaces: false });
    expect(del.statusCode).toBe(200);

    // Base workspace directory should still exist
    const fs = await import("node:fs");
    expect(fs.existsSync(harness.workspacePath)).toBe(true);
  });

  it("deletes with cleanupRunWorkspaces=true without error", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);
    const client = harness.client;

    const conv = await client.post("/conversations", { title: "Cleanup WS" });
    const convBody = conv.json();
    await client.post(`/conversations/${convBody.id}/workspace`, { rootPath: harness.workspacePath });

    const del = await client.del(`/conversations/${convBody.id}`, { cleanupRunWorkspaces: true });
    expect(del.statusCode).toBe(200);
    expect(del.json().ok).toBe(true);
  });
});
