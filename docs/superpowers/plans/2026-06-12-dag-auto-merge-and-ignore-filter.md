# DAG Auto-Merge And Ignore Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DAG tasks ignore generated directories, auto-merge on completion, and avoid UI lockups from large conflict lists while preserving manual apply for non-DAG runs.

**Architecture:** Add one shared ignore-filter path matcher used by `RunsService` and `MergeService`, then thread explicit `mergeMode` and `mergeStatus` through run card summaries so the frontend can cleanly split DAG and non-DAG behavior. Keep orchestration semantics strict: only merge success completes a DAG task and unlocks downstream tasks.

**Tech Stack:** TypeScript, Express, SQLite, React, Vitest

---

### Task 1: Add Shared Ignore Filtering For Run File Changes

**Files:**
- Create: `server/src/modules/runs/path-ignore.ts`
- Modify: `server/src/modules/runs/runs.service.ts`
- Test: `server/tests/runs.service.test.ts`

- [ ] **Step 1: Write the failing backend tests for ignore filtering**

Add tests to `server/tests/runs.service.test.ts` that build a temp workspace with:

```ts
fs.mkdirSync(path.join(baseRoot, 'node_modules/pkg'), { recursive: true });
fs.mkdirSync(path.join(runRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(runRoot, 'node_modules/pkg/index.js'), 'ignored');
fs.writeFileSync(path.join(runRoot, 'dist/app.js'), 'ignored');
fs.writeFileSync(path.join(runRoot, 'package-lock.json'), '{}');
fs.writeFileSync(path.join(runRoot, 'src/app.ts'), 'changed');
fs.writeFileSync(path.join(baseRoot, '.gitignore'), 'coverage/\ncustom-cache/\n');
fs.writeFileSync(path.join(runRoot, 'coverage/out.txt'), 'ignored');
fs.writeFileSync(path.join(runRoot, 'custom-cache/tmp.txt'), 'ignored');
```

Assert that `getFileChanges(runId)` only returns:

```ts
expect(changes.map((change) => change.filePath)).toEqual(['src/app.ts']);
```

Add a second test without `.gitignore` that still ignores:

```ts
expect(changes.some((change) => change.filePath.includes('node_modules'))).toBe(false);
expect(changes.some((change) => change.filePath === 'package-lock.json')).toBe(false);
```

- [ ] **Step 2: Run the targeted backend test and verify it fails**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/runs.service.test.ts
```

Expected: FAIL because ignored paths are still returned in `FileChange[]`.

- [ ] **Step 3: Implement the shared ignore matcher**

Create `server/src/modules/runs/path-ignore.ts` with focused helpers:

```ts
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.cache/',
  '.turbo/',
  'coverage/',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
];

export function loadIgnorePatterns(rootPath: string): string[] { /* read .gitignore if present */ }
export function shouldIgnoreRelativePath(filePath: string, patterns: string[]): boolean { /* posix matching */ }
export function filterRelativePaths(filePaths: string[], patterns: string[]): string[] {
  return filePaths.filter((filePath) => !shouldIgnoreRelativePath(filePath, patterns));
}
```

Update `RunsService.getFileChanges()` so both the non-git scan path and the git diff path call this filter before producing `FileChange[]`.

- [ ] **Step 4: Run the targeted backend test and verify it passes**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/runs.service.test.ts
```

Expected: PASS with ignored paths removed from results.

### Task 2: Make MergeService Consume Filtered Changes And Support DAG Auto-Merge Semantics

**Files:**
- Modify: `server/src/modules/merge/merge.service.ts`
- Modify: `server/src/modules/merge/merge.types.ts`
- Modify: `server/src/shared/types.ts`
- Test: `server/tests/merge.service.test.ts`

- [ ] **Step 1: Write the failing merge tests for zero-change, ignored-change, and needs-approval behavior**

Extend `server/tests/merge.service.test.ts` with:

```ts
it('treats a DAG run with only ignored/generated files as auto merged with zero applied files', () => {
  expect(result.status).toBe('merged');
  expect(result.merge.status).toBe('auto_merged');
  expect(result.merge.appliedFiles).toEqual([]);
});

it('returns needs_approval when filtered business files still conflict', () => {
  expect(result.status).toBe('needs_approval');
  expect(result.merge.conflicts.map((item) => item.filePath)).toEqual(['src/app.ts']);
});
```

Also add an assertion that merge records expose summary fields needed by the frontend:

```ts
expect(result.merge.status).toBe('auto_merged');
expect(result.merge.conflicts).toEqual([]);
```

- [ ] **Step 2: Run merge tests and verify the new cases fail**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/merge.service.test.ts
```

Expected: FAIL because merge summaries and zero-change semantics are incomplete.

- [ ] **Step 3: Update merge types and service logic minimally**

Add explicit summary fields in `server/src/shared/types.ts`:

```ts
export interface RunCardSummary {
  workspace: RunWorkspaceSummary;
  changeApplication: RunChangeApplication | null;
  fileChanges: FileChange[];
  mergeMode: 'auto' | 'manual';
  mergeStatus: RunMergeStatus | null;
  merge: RunMerge | null;
}
```

Update `MergeService` so:

```ts
if (changes.length === 0) {
  return { status: 'merged', merge: persistAutoMerged([]) };
}
```

and ensure it only reasons over the already-filtered `deps.getFileChanges(runId)` output.

- [ ] **Step 4: Run merge tests and verify they pass**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/merge.service.test.ts
```

Expected: PASS with the new auto-merge and conflict cases green.

### Task 3: Gate DAG Completion On Merge Success And Keep Manual Apply For Non-DAG Runs

**Files:**
- Modify: `server/src/modules/orchestrator/orchestrator.service.ts`
- Modify: `server/src/modules/runs/runs.routes.ts`
- Modify: `server/src/modules/tasks/tasks.service.ts`
- Test: `server/tests/orchestrator.test.ts`
- Test: `server/tests/tasks-assignments.test.ts`

- [ ] **Step 1: Write failing orchestration tests for auto-merge before downstream unlock**

Add a test in `server/tests/orchestrator.test.ts` that simulates:

```ts
tasks: [
  { id: 't1', title: 'health endpoint', depends_on: [] },
  { id: 't2', title: 'tests', depends_on: ['t1'] },
]
```

Then assert:

```ts
pending.get(rootRunId)?.resolve({ status: 'completed', exitCode: 0 });
await waitFor(async () => {
  const timeline = await harness.client.get(`/conversations/${conversationId}/timeline`);
  const plan = timeline.json().find((item: { type: string }) => item.type === 'plan');
  return plan.plan.items[1].runId;
});
```

and verify the system message contains:

```ts
expect(systemMessages.some((msg) => msg.content.includes('已完成并自动合并'))).toBe(true);
```

Add a negative case asserting that unresolved conflicts keep task 2 pending.

- [ ] **Step 2: Run orchestrator tests and verify the new cases fail**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/orchestrator.test.ts tests/tasks-assignments.test.ts
```

Expected: FAIL because runs complete before merge-aware unlock behavior is exposed cleanly.

- [ ] **Step 3: Implement merge-mode plumbing and DAG/manual split**

Update `server/src/modules/runs/runs.routes.ts` card summary response to compute:

```ts
const merge = mergeService.getByRunId(runId);
const mergeMode = run.task_id && tasksService.getById(run.task_id)?.plan_message_id ? 'auto' : 'manual';

const summary: RunCardSummary = {
  workspace,
  changeApplication,
  fileChanges,
  mergeMode,
  mergeStatus: merge?.status ?? null,
  merge: merge ?? null,
};
```

Update `OrchestratorService.pollOrchestratedRuns()` so DAG tasks:

```ts
if (mergeRecord.status === 'auto_merged' || mergeRecord.status === 'conflict_resolved') {
  tasksService.updateTaskStatus(taskId, 'completed');
  scheduler.notifyCompleted(plannerTaskId);
}
```

and unresolved conflicts keep:

```ts
tasksService.updateTaskStatus(taskId, 'in_review');
```

while non-plan runs keep existing manual apply behavior untouched.

- [ ] **Step 4: Re-run orchestrator tests and verify they pass**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/orchestrator.test.ts tests/tasks-assignments.test.ts
```

Expected: PASS with downstream tasks only unlocking after merge success.

### Task 4: Hide Manual Apply UI For DAG Runs

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/RunCard/index.tsx`
- Test: `frontend/src/components/RunCard/index.test.tsx`

- [ ] **Step 1: Write failing RunCard tests for mergeMode split**

Add tests in `frontend/src/components/RunCard/index.test.tsx` for:

```ts
mockedGetRunCardSummary.mockResolvedValue({
  ...baseSummary,
  mergeMode: 'auto',
  mergeStatus: 'auto_merged',
});
```

Assert:

```ts
expect(screen.queryByText('应用到项目')).toBeNull();
expect(screen.queryByText('应用并提交')).toBeNull();
expect(screen.getByText('已自动合并到项目')).toBeTruthy();
```

Add a second test for `mergeMode: 'manual'` asserting the existing buttons still appear.

- [ ] **Step 2: Run the RunCard tests and verify they fail**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm test -- src/components/RunCard/index.test.tsx
```

Expected: FAIL because `RunCardSummary` and `RunCard` do not yet handle merge mode.

- [ ] **Step 3: Implement minimal RunCard branching**

Update frontend types:

```ts
export interface RunCardSummary {
  workspace: RunWorkspace;
  changeApplication: RunChangeApplication | null;
  fileChanges: FileChange[];
  mergeMode: 'auto' | 'manual';
  mergeStatus: 'pending' | 'auto_merged' | 'conflict_resolved' | 'needs_approval' | 'failed' | null;
  merge: RunMerge | null;
}
```

Update `RunCard` logic so:

```ts
const isAutoMergeRun = summary.mergeMode === 'auto';
const hasActionBar = canShowActions && hasFileChanges && !isAutoMergeRun && !isApplied && !isCleaned;
```

and render status text for auto-merge modes instead of the yellow “隔离工作区” warning.

- [ ] **Step 4: Re-run the RunCard tests and verify they pass**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm test -- src/components/RunCard/index.test.tsx
```

Expected: PASS with manual runs unchanged and DAG runs showing auto-merge status.

### Task 5: Add Defensive Conflict List Rendering

**Files:**
- Modify: `frontend/src/components/ConflictReviewCard/index.tsx`
- Test: `frontend/src/components/ConflictReviewCard/index.test.tsx`

- [ ] **Step 1: Write failing conflict review tests for truncation, warning, and expansion**

Add test data with `60` conflict entries:

```ts
const conflictFiles = Array.from({ length: 60 }, (_, index) => ({
  filePath: `src/file-${index}.ts`,
  reason: 'Conflict',
  baseContent: 'base',
  currentContent: 'current',
  runContent: 'run',
  llmAvailable: false,
}));
```

Assert:

```ts
expect(screen.getByText('检测到大量冲突文件（60 个），可能是未排除生成目录导致，请检查 .gitignore 配置')).toBeTruthy();
expect(screen.getAllByText(/src\/file-/).length).toBe(20);
expect(screen.getByRole('button', { name: '显示更多' })).toBeTruthy();
```

After clicking “显示更多”, assert more files appear. Also assert that file contents are hidden until expanding an individual row.

- [ ] **Step 2: Run the conflict review tests and verify they fail**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm test -- src/components/ConflictReviewCard/index.test.tsx
```

Expected: FAIL because the card currently renders every conflict eagerly.

- [ ] **Step 3: Implement limited initial rendering and per-file expansion**

Refactor `ConflictReviewCard` state to:

```ts
const [visibleCount, setVisibleCount] = useState(20);
const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
const visibleConflicts = conflictFiles.slice(0, visibleCount);
```

Render only path + reason in the default row body, and only render:

```tsx
{expandedFiles[filePath] && (
  <div className="mt-3 grid gap-3 md:grid-cols-3">
    <PreviewPane title="Base" content={...} />
    <PreviewPane title="Current" content={...} />
    <PreviewPane title="Run" content={...} />
  </div>
)}
```

Add the large-conflict warning banner when `conflictFiles.length > 50`.

- [ ] **Step 4: Re-run the conflict review tests and verify they pass**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm test -- src/components/ConflictReviewCard/index.test.tsx
```

Expected: PASS with capped initial rendering and explicit expansion.

### Task 6: Run End-To-End Regression Verification

**Files:**
- Test: `server/tests/runs.service.test.ts`
- Test: `server/tests/merge.service.test.ts`
- Test: `server/tests/orchestrator.test.ts`
- Test: `server/tests/tasks-assignments.test.ts`
- Test: `frontend/src/components/RunCard/index.test.tsx`
- Test: `frontend/src/components/ConflictReviewCard/index.test.tsx`

- [ ] **Step 1: Run the full targeted backend suite**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm test -- tests/runs.service.test.ts tests/merge.service.test.ts tests/orchestrator.test.ts tests/tasks-assignments.test.ts
```

Expected: PASS with ignore filtering, merge semantics, and DAG unlock behavior green.

- [ ] **Step 2: Run the full targeted frontend suite**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm test -- src/components/RunCard/index.test.tsx src/components/ConflictReviewCard/index.test.tsx src/components/PlanCard/index.test.tsx
```

Expected: PASS with manual/auto split and conflict list protection green.

- [ ] **Step 3: Run build verification for both apps**

Run:

```bash
cd /Users/buchisu/Downloads/实习/agenthub/server && npm run build
cd /Users/buchisu/Downloads/实习/agenthub/frontend && npm run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable if no new build errors appear.

- [ ] **Step 4: Manual validation checklist**

Use the app to validate:

```text
@orchestrator 写一个 GET /health 接口，然后写测试
```

Confirm:

```text
1. Task 1 starts first, Task 2 waits.
2. Task 1 completes and auto-merges without manual apply buttons.
3. A success system message announces automatic merge.
4. Task 2 automatically starts after Task 1 merge success.
5. node_modules/dist/lock files do not appear in diff or conflict views.
6. If a real conflict is forced, the conflict review list is capped and expandable.
```
