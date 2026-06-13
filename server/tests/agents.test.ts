import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

describe("agent management", () => {
  it("returns only enabled agents by default and all agents with includeDisabled=true", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const enabledId = harness.createAgent("frontend-agent");
    const disabled = await harness.client.post("/agents", {
      name: "disabled-agent",
      slug: "disabled-agent",
      adapterType: "claude_cli",
      enabled: false,
    });
    expect(disabled.statusCode).toBe(201);

    const enabledOnly = await harness.client.get("/agents");
    expect(enabledOnly.statusCode).toBe(200);
    expect(enabledOnly.json().some((agent: { id: string }) => agent.id === enabledId)).toBe(true);
    expect(enabledOnly.json().some((agent: { id: string }) => agent.id === disabled.json().id)).toBe(false);

    const all = await harness.client.get("/agents?includeDisabled=true");
    expect(all.statusCode).toBe(200);
    expect(all.json().some((agent: { id: string }) => agent.id === disabled.json().id)).toBe(true);
  });

  it("creates and updates agents with capabilities and instructions", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const created = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
      capabilities: ["frontend", "react", "ui"],
      instructions: "Focus on React and UI polish.",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().slug).toBe("frontend-agent");
    expect(created.json().capabilities).toEqual(["frontend", "react", "ui"]);
    expect(created.json().instructions).toBe("Focus on React and UI polish.");

    const updated = await harness.client.patch(`/agents/${created.json().id}`, {
      capabilities: ["frontend", "tailwind"],
      instructions: "Prefer Tailwind and existing components.",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().capabilities).toEqual(["frontend", "tailwind"]);
    expect(updated.json().instructions).toBe("Prefer Tailwind and existing components.");
  });

  it("rejects duplicate slugs", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const first = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
    });
    expect(first.statusCode).toBe(201);

    const second = await harness.client.post("/agents", {
      name: "another front",
      slug: "frontend-agent",
      adapterType: "claude_cli",
    });
    expect(second.statusCode).toBe(400);
  });

  it("rejects unregistered adapter types on create and update", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const created = await harness.client.post("/agents", {
      name: "invalid-agent",
      slug: "invalid-agent",
      adapterType: "missing_adapter",
    });
    expect(created.statusCode).toBe(400);

    const valid = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
    });
    expect(valid.statusCode).toBe(201);

    const updated = await harness.client.patch(`/agents/${valid.json().id}`, {
      adapterType: "missing_adapter",
    });
    expect(updated.statusCode).toBe(400);
  });

  it("sets a single default agent and prevents disabled defaults", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const agentA = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
    });
    const agentB = await harness.client.post("/agents", {
      name: "backend-agent",
      slug: "backend-agent",
      adapterType: "claude_cli",
    });
    expect(agentA.statusCode).toBe(201);
    expect(agentB.statusCode).toBe(201);

    const setDefault = await harness.client.post(`/agents/${agentA.json().id}/default`);
    expect(setDefault.statusCode).toBe(200);
    expect(setDefault.json().is_default).toBe(true);

    const swapDefault = await harness.client.post(`/agents/${agentB.json().id}/default`);
    expect(swapDefault.statusCode).toBe(200);
    expect(swapDefault.json().is_default).toBe(true);

    const all = await harness.client.get("/agents?includeDisabled=true");
    const currentDefault = all.json().filter((agent: { is_default: boolean }) => agent.is_default);
    expect(currentDefault).toHaveLength(1);
    expect(currentDefault[0].id).toBe(agentB.json().id);

    const disabled = await harness.client.post("/agents", {
      name: "disabled-agent",
      slug: "disabled-agent",
      adapterType: "claude_cli",
      enabled: false,
    });
    const disabledDefault = await harness.client.post(`/agents/${disabled.json().id}/default`);
    expect(disabledDefault.statusCode).toBe(400);
  });

  it("prevents disabling the default agent", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const created = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
      isDefault: true,
    });
    expect(created.statusCode).toBe(201);

    const disabled = await harness.client.post(`/agents/${created.json().id}/disable`);
    expect(disabled.statusCode).toBe(400);
  });

  it("uses the enabled default agent when creating runs without agentId and rejects disabled agents", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const defaultAgent = await harness.client.post("/agents", {
      name: "frontend-agent",
      slug: "frontend-agent",
      adapterType: "claude_cli",
      isDefault: true,
    });
    const disabledAgent = await harness.client.post("/agents", {
      name: "backend-agent",
      slug: "backend-agent",
      adapterType: "claude_cli",
      enabled: false,
    });
    expect(defaultAgent.statusCode).toBe(201);
    expect(disabledAgent.statusCode).toBe(201);

    const conversation = await harness.client.post("/conversations", {
      title: "Run Default Agent",
      type: "single",
    });
    const conversationId = conversation.json().id;
    await harness.client.post(`/conversations/${conversationId}/workspace`, {
      rootPath: harness.workspacePath,
    });

    const run = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "do work",
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().agent_id).toBe(defaultAgent.json().id);

    const disabledRun = await harness.client.post(`/conversations/${conversationId}/runs`, {
      prompt: "do disabled work",
      agentId: disabledAgent.json().id,
    });
    expect(disabledRun.statusCode).toBe(400);
  });
});
