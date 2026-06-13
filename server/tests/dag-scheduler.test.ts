import { describe, expect, it, vi } from "vitest";
import {
  buildDagPreview,
  DagScheduler,
  findDagCycle,
  type PlannedTask,
} from "../src/modules/orchestrator/dag-scheduler.js";

function makeTask(
  id: string,
  dependsOn: string[] = [],
): PlannedTask {
  return {
    id,
    title: id.toUpperCase(),
    description: id.toUpperCase(),
    task_type: "general",
    expected_output: "",
    affected_files: [],
    suggested_agent: null,
    priority: 1,
    depends_on: dependsOn,
  };
}

describe("DagScheduler", () => {
  it("starts all root tasks immediately", async () => {
    const started: string[] = [];
    const scheduler = new DagScheduler(
      [makeTask("a"), makeTask("b")],
      async (task) => {
        started.push(task.id);
      },
      vi.fn(),
      vi.fn(),
    );

    await scheduler.start();

    expect(started.sort()).toEqual(["a", "b"]);
  });

  it("unlocks dependent tasks only after dependencies complete", async () => {
    const started: string[] = [];
    const scheduler = new DagScheduler(
      [
        makeTask("a"),
        makeTask("b", ["a"]),
        makeTask("c", ["a"]),
        makeTask("d", ["b", "c"]),
      ],
      async (task) => {
        started.push(task.id);
      },
      vi.fn(),
      vi.fn(),
    );

    await scheduler.start();
    expect(started).toEqual(["a"]);

    await scheduler.notifyCompleted("a");
    expect(started).toEqual(["a", "b", "c"]);

    await scheduler.notifyCompleted("b");
    expect(started).toEqual(["a", "b", "c"]);

    await scheduler.notifyCompleted("c");
    expect(started).toEqual(["a", "b", "c", "d"]);
  });

  it("builds readable DAG levels for CLI plan previews", () => {
    const preview = buildDagPreview([
      makeTask("t1"),
      makeTask("t2"),
      makeTask("t3", ["t1", "t2"]),
      makeTask("t4", ["t3"]),
    ]);

    expect(preview.levels.map((level) => level.map((task) => task.id))).toEqual([
      ["t1", "t2"],
      ["t3"],
      ["t4"],
    ]);
    expect(preview.text).toContain("Layer 1");
    expect(preview.text).toContain("t1");
    expect(preview.text).toContain("depends on t1,t2");
  });

  it("blocks direct and transitive dependents after failure", async () => {
    const blocked: Array<{ id: string; reason: string }> = [];
    const scheduler = new DagScheduler(
      [makeTask("a"), makeTask("b", ["a"]), makeTask("c", ["b"])],
      async () => undefined,
      vi.fn(),
      (task, reason) => {
        blocked.push({ id: task.id, reason });
      },
    );

    await scheduler.start();
    await scheduler.notifyFailed("a");

    expect(blocked.map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(blocked[0]?.reason).toContain("a");
  });

  it("reports cycles instead of silently falling back to sequential execution", () => {
    expect(findDagCycle([makeTask("a", ["b"]), makeTask("b", ["a"])])).toEqual([
      "a",
      "b",
      "a",
    ]);
    expect(() => {
      new DagScheduler(
        [makeTask("a", ["b"]), makeTask("b", ["a"])],
        async () => undefined,
        vi.fn(),
        vi.fn(),
      );
    }).toThrow("cyclic dependency detected: a -> b -> a");
  });
});
