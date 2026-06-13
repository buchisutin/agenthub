# Orchestrator DAG Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DAG-aware orchestration so planner tasks can declare `depends_on`, initial root tasks start in parallel, downstream tasks wait for dependencies, and failures block dependent tasks.

**Architecture:** Extend planner task normalization with stable task IDs and dependency lists, persist dependency metadata on tasks and plan items, and introduce an in-memory `DagScheduler` that orchestrator instances use to start ready tasks and propagate failures. Keep backward compatibility by defaulting missing `depends_on` to `[]`, and fall back to sequential scheduling when dependency graphs are cyclic.

**Tech Stack:** Node.js, TypeScript, Express, Socket.IO, SQLite, Vitest, React

---

### Task 1: Add failing DAG scheduler unit tests

**Files:**
- Create: `server/tests/dag-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { DagScheduler } from "../src/modules/orchestrator/dag-scheduler.js";

describe("DagScheduler", () => {
  it("starts all root tasks immediately", async () => {
    const started: string[] = [];
    const scheduler = new DagScheduler(
      [
        { id: "a", title: "A", description: "A", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: [] },
        { id: "b", title: "B", description: "B", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: [] },
      ],
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
        { id: "a", title: "A", description: "A", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: [] },
        { id: "b", title: "B", description: "B", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["a"] },
        { id: "c", title: "C", description: "C", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["a"] },
        { id: "d", title: "D", description: "D", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["b", "c"] },
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

  it("blocks direct and transitive dependents after failure", async () => {
    const blocked: Array<{ id: string; reason: string }> = [];
    const scheduler = new DagScheduler(
      [
        { id: "a", title: "A", description: "A", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: [] },
        { id: "b", title: "B", description: "B", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["a"] },
        { id: "c", title: "C", description: "C", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["b"] },
      ],
      async () => undefined,
      vi.fn(),
      (task, reason) => {
        blocked.push({ id: task.id, reason });
      },
    );

    await scheduler.start();
    await scheduler.notifyFailed("a");

    expect(blocked.map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  it("falls back to sequential start order when graph has a cycle", async () => {
    const started: string[] = [];
    const scheduler = new DagScheduler(
      [
        { id: "a", title: "A", description: "A", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["b"] },
        { id: "b", title: "B", description: "B", task_type: "general", expected_output: "", affected_files: [], suggested_agent: null, priority: 1, depends_on: ["a"] },
      ],
      async (task) => {
        started.push(task.id);
      },
      vi.fn(),
      vi.fn(),
    );

    await scheduler.start();

    expect(started).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- tests/dag-scheduler.test.ts`
Expected: FAIL with module-not-found or missing `DagScheduler` export.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/modules/orchestrator/dag-scheduler.ts` with:

```ts
export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  task_type: TaskType;
  expected_output: string;
  affected_files: string[];
  suggested_agent: string | null;
  priority: number;
  depends_on: string[];
}

export class DagScheduler {
  // track pending/running/completed/failed/blocked
  // detect cycles with DFS
  // on cycle: console.warn + start first not-yet-started task only
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- tests/dag-scheduler.test.ts`
Expected: PASS

### Task 2: Add failing orchestrator integration tests

**Files:**
- Modify: `server/tests/orchestrator.test.ts`
- Modify: `server/tests/tasks-assignments.test.ts`

- [ ] **Step 1: Write the failing test**

Add orchestrator tests covering:
- mixed DAG scheduling: only root run exists immediately, downstream runs appear after predecessor completion
- failure propagation: dependent tasks become `blocked`
- backward compatibility: planner task without `depends_on` still fans out in parallel
- persistence: created tasks keep dependency metadata for timeline/task detail

Use a stub runtime whose completion promise is manually resolved per run so tests can control ordering.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npm test -- tests/orchestrator.test.ts tests/tasks-assignments.test.ts`
Expected: FAIL because orchestrator still eagerly starts all runs and tasks lack dependency metadata.

- [ ] **Step 3: Write minimal implementation**

Update:
- `server/src/modules/orchestrator/orchestrator.service.ts`
- `server/src/modules/tasks/tasks.service.ts`
- `server/src/shared/types.ts`
- `server/src/db/schema.ts`
- `server/src/db/client.ts`

Implementation points:
- planner task types accept `id` and `depends_on`
- normalization fills defaults and validates IDs
- task records persist `depends_on`
- plan items carry `dependsOn`
- orchestration creates all task/assignment rows up front with status `pending`
- scheduler starts only ready tasks and triggers downstream starts from run status changes
- blocked tasks update DB state and plan metadata

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npm test -- tests/orchestrator.test.ts tests/tasks-assignments.test.ts`
Expected: PASS

### Task 3: Add failing frontend plan-card tests

**Files:**
- Modify: `frontend/src/components/PlanCard/index.test.tsx`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Write the failing test**

Add a test that renders a plan with:
- one root task
- one task depending on the root
- one blocked task depending on two upstream tasks

Assert the card shows:
- dependency labels like `等待任务1` or `等待任务1, 任务2`
- blocked/pending/running/completed labels
- assigned agent line remains intact

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/PlanCard/index.test.tsx`
Expected: FAIL because `dependsOn` is not in types or UI.

- [ ] **Step 3: Write minimal implementation**

Update:
- `frontend/src/types/index.ts`
- `frontend/src/components/PlanCard/index.tsx`
- any state-mapping code that constructs `PlanCardModel` items

Implementation points:
- add `dependsOn: string[]`
- render simple dependency text per task
- preserve existing layout and status badges

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/components/PlanCard/index.test.tsx`
Expected: PASS

### Task 4: Run focused verification

**Files:**
- No code changes

- [ ] **Step 1: Run backend test suite for touched areas**

Run: `cd server && npm test -- tests/dag-scheduler.test.ts tests/orchestrator.test.ts tests/tasks-assignments.test.ts`
Expected: PASS

- [ ] **Step 2: Run frontend test suite for touched areas**

Run: `cd frontend && npm test -- src/components/PlanCard/index.test.tsx src/components/ChatArea/index.test.tsx`
Expected: PASS

- [ ] **Step 3: Run lightweight type/build verification**

Run: `cd server && npm run build`
Expected: exit 0

Run: `cd frontend && npm run build`
Expected: exit 0
