import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "./helpers.js";

const harnesses: Array<Awaited<ReturnType<typeof createTestHarness>>> = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await harness.close();
  }
});

async function bindWorkspace(beforeBind?: (workspacePath: string) => void) {
  const harness = await createTestHarness();
  harnesses.push(harness);
  const conversation = await harness.client.post("/conversations", {
    title: "Project artifacts",
    type: "single",
  });
  const conversationId = conversation.json().id as string;
  beforeBind?.(harness.workspacePath);
  const bound = await harness.client.post(
    `/conversations/${conversationId}/workspace`,
    { rootPath: harness.workspacePath },
  );
  return {
    harness,
    workspaceId: bound.json().id as string,
  };
}

describe("workspace artifacts API", () => {
  it("returns the bound workspace diff relative to HEAD", async () => {
    const { harness, workspaceId } = await bindWorkspace();
    const filePath = path.join(harness.workspacePath, "src", "new.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export const created = true;\n");

    const response = await harness.client.get(
      `/workspaces/${workspaceId}/file-changes`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      workspaceId,
      baseRef: "HEAD",
      files: [
        {
          filePath: "src/new.ts",
          changeType: "create",
          oldContent: "",
          newContent: "export const created = true;\n",
          confidence: "exact",
          source: "filesystem",
          additions: 1,
          deletions: 0,
          binary: false,
        },
      ],
      summary: { files: 1, additions: 1, deletions: 0 },
    });
  });

  it("returns 404 for an unknown workspace", async () => {
    const harness = await createTestHarness();
    harnesses.push(harness);

    const response = await harness.client.get(
      "/workspaces/does-not-exist/file-changes",
    );

    expect(response.statusCode).toBe(404);
  });

  it("returns edited and deleted tracked files", async () => {
    const { harness, workspaceId } = await bindWorkspace((workspacePath) => {
      fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
      fs.writeFileSync(path.join(workspacePath, "src", "edited.ts"), "before\n");
      fs.writeFileSync(path.join(workspacePath, "src", "deleted.ts"), "remove me\n");
    });
    fs.writeFileSync(path.join(harness.workspacePath, "src", "edited.ts"), "after\n");
    fs.rmSync(path.join(harness.workspacePath, "src", "deleted.ts"));

    const response = await harness.client.get(
      `/workspaces/${workspaceId}/file-changes`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().files).toEqual([
      expect.objectContaining({
        filePath: "src/deleted.ts",
        changeType: "delete",
        oldContent: "remove me\n",
        newContent: "",
      }),
      expect.objectContaining({
        filePath: "src/edited.ts",
        changeType: "edit",
        oldContent: "before\n",
        newContent: "after\n",
      }),
    ]);
    expect(response.json().summary).toEqual({ files: 2, additions: 1, deletions: 2 });
  });
});
