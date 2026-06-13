# AgentHub UI Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main AgentHub page immediately show collaboration progress and artifact usability while preserving the IM-style collaboration design.

**Architecture:** Add a lightweight `CollaborationOverview` above the timeline and evolve the existing right-side task drawer into an `ArtifactPanel` with `Tasks`, `Diff`, `Preview`, and `Summary` tabs. Keep orchestration, run creation, merge, preview, and summary APIs unchanged; this is a frontend information architecture pass.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing AgentHub API service and component patterns.

---

## File Structure

- Create: `frontend/src/components/CollaborationOverview/index.tsx`
  - Computes and renders conversation-level progress, active work, needs-attention, and artifact counts from existing frontend state.
- Create: `frontend/src/components/CollaborationOverview/index.test.tsx`
  - Tests progress, active run, and attention rendering.
- Create: `frontend/src/components/ArtifactPanel/index.tsx`
  - Replaces the visual role of `TaskPanel` as the right-side session artifact workspace.
  - Owns tabs: `Tasks`, `Diff`, `Preview`, `Summary`.
- Create: `frontend/src/components/ArtifactPanel/index.test.tsx`
  - Tests tab switching, task selection, diff loading, and preview controls.
- Modify: `frontend/src/components/ChatArea/index.tsx`
  - Adds selected artifact state.
  - Renders `CollaborationOverview`.
  - Renders `ArtifactPanel` instead of `TaskPanel` for the right-side panel.
  - Passes focus-artifact callbacks to PlanCard and RunCard.
- Modify: `frontend/src/components/RunCard/index.tsx`
  - Keeps tool details and apply/confirmation state.
  - Removes Diff and Preview as primary expanded-card actions.
  - Adds a `Focus artifacts` entry point.
- Modify: `frontend/src/components/RunCard/index.test.tsx`
  - Updates expectations from inline Diff/Preview actions to artifact focus.
- Modify: `frontend/src/components/PlanCard/index.tsx`
  - Simplifies default task row metadata.
  - Adds artifact focus entry when a task has a run.
- Modify: `frontend/src/components/PlanCard/index.test.tsx`
  - Updates assertions for concise task rows and artifact focus.
- Modify: `frontend/src/components/TaskPanel/index.tsx`
  - Keep `TaskDetailDrawer` export.
  - Either keep `TaskPanel` for compatibility or stop using it from ChatArea.
- Modify: `frontend/src/components/TaskPanel/index.test.tsx`
  - Keep existing drawer/task tests if the component remains exported.

---

## Task 1: CollaborationOverview

**Files:**
- Create: `frontend/src/components/CollaborationOverview/index.tsx`
- Create: `frontend/src/components/CollaborationOverview/index.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/CollaborationOverview/index.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CollaborationOverview } from './index';
import type { ChatTimelineItem, PlanCardModel } from '../../types';

const plan: PlanCardModel = {
  id: 'plan-1',
  conversationId: 'conv-1',
  prompt: 'build feature',
  summary: 'Build the feature in stages',
  createdAt: '2026-06-13T00:00:00.000Z',
  items: [
    {
      index: 1,
      plannerTaskId: 't1',
      title: 'Backend API',
      description: 'Build API',
      assignedAgentId: 'agent-back',
      assignedAgentName: 'backend-agent',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      runId: 'run-1',
      status: 'completed',
      dependsOn: [],
    },
    {
      index: 2,
      plannerTaskId: 't2',
      title: 'Frontend UI',
      description: 'Build UI',
      assignedAgentId: 'agent-front',
      assignedAgentName: 'frontend-agent',
      taskId: 'task-2',
      assignmentId: 'assignment-2',
      runId: 'run-2',
      status: 'running',
      dependsOn: ['t1'],
    },
  ],
};

const runningRun: ChatTimelineItem = {
  id: 'run-2',
  conversationId: 'conv-1',
  runId: 'run-2',
  taskId: 'task-2',
  agentId: 'agent-front',
  agentName: 'frontend-agent',
  agentSessionId: null,
  prompt: 'Build UI',
  status: 'running',
  startedAt: '2026-06-13T00:00:00.000Z',
  finishedAt: null,
  blocks: [],
  error: null,
};

describe('CollaborationOverview', () => {
  it('shows task progress and active work', () => {
    render(
      <CollaborationOverview
        plans={[plan]}
        timeline={[runningRun]}
        activeRunIds={['run-2']}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('当前协作')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('任务完成')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('Agent 运行中')).toBeTruthy();
    expect(screen.getByText('Frontend UI')).toBeTruthy();
    expect(screen.getByText('@frontend-agent')).toBeTruthy();
  });

  it('shows an empty state before any plan or run exists', () => {
    render(
      <CollaborationOverview
        plans={[]}
        timeline={[]}
        activeRunIds={[]}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('还没有协作任务')).toBeTruthy();
    expect(screen.getByText('发送 @orchestrator 或 @agent 开始。')).toBeTruthy();
  });

  it('surfaces failed runs as needs attention', () => {
    render(
      <CollaborationOverview
        plans={[plan]}
        timeline={[{ ...runningRun, status: 'failed', error: 'Runtime failed' }]}
        activeRunIds={[]}
        onOpenArtifacts={() => {}}
      />,
    );

    expect(screen.getByText('需要处理')).toBeTruthy();
    expect(screen.getByText('Frontend UI 失败')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd frontend
npm test -- src/components/CollaborationOverview/index.test.tsx
```

Expected: fail because `CollaborationOverview` does not exist.

- [ ] **Step 3: Implement `CollaborationOverview`**

Create `frontend/src/components/CollaborationOverview/index.tsx`:

```tsx
import type { ChatTimelineItem, PlanCardModel } from '../../types';
import { Badge } from '../ui/Badge';
import { getStatusLabel, getStatusVariant } from '../ui/status';

type ArtifactTab = 'tasks' | 'diff' | 'preview' | 'summary';

interface CollaborationOverviewProps {
  plans: PlanCardModel[];
  timeline: ChatTimelineItem[];
  activeRunIds: string[];
  onOpenArtifacts: (tab: ArtifactTab) => void;
}

function latestPlan(plans: PlanCardModel[]) {
  return [...plans].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] ?? null;
}

function countChangedRuns(timeline: ChatTimelineItem[]) {
  return timeline.filter((item) => item.status === 'completed').length;
}

export function CollaborationOverview({
  plans,
  timeline,
  activeRunIds,
  onOpenArtifacts,
}: CollaborationOverviewProps) {
  const plan = latestPlan(plans);
  const totalTasks = plan?.items.length ?? 0;
  const completedTasks = plan?.items.filter((item) => item.status === 'completed').length ?? 0;
  const activeRuns = timeline.filter((item) => activeRunIds.includes(item.runId));
  const failedRuns = timeline.filter((item) => item.status === 'failed' || item.status === 'interrupted');
  const completedRuns = countChangedRuns(timeline);

  if (!plan && timeline.length === 0) {
    return (
      <section className="agenthub-card px-5 py-4">
        <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
          当前协作
        </div>
        <div className="mt-2 text-sm" style={{ color: 'var(--app-text-secondary)' }}>
          还没有协作任务
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--app-text-secondary)' }}>
          发送 @orchestrator 或 @agent 开始。
        </div>
      </section>
    );
  }

  return (
    <section className="agenthub-card px-5 py-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
            当前协作
          </div>
          {plan && (
            <div className="mt-1 text-xs line-clamp-1" style={{ color: 'var(--app-text-secondary)' }}>
              {plan.summary}
            </div>
          )}
        </div>
        {failedRuns.length > 0 ? <Badge variant="failed">需要处理</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <button type="button" onClick={() => onOpenArtifacts('tasks')} className="rounded-lg px-3 py-2 text-left" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
          <div className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>{completedTasks} / {totalTasks}</div>
          <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>任务完成</div>
        </button>
        <button type="button" onClick={() => onOpenArtifacts('tasks')} className="rounded-lg px-3 py-2 text-left" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
          <div className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>{activeRuns.length}</div>
          <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>Agent 运行中</div>
        </button>
        <button type="button" onClick={() => onOpenArtifacts('diff')} className="rounded-lg px-3 py-2 text-left" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
          <div className="text-base font-semibold" style={{ color: 'var(--app-text)' }}>{completedRuns}</div>
          <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>已完成 Run</div>
        </button>
        <button type="button" onClick={() => onOpenArtifacts('summary')} className="rounded-lg px-3 py-2 text-left" style={{ backgroundColor: failedRuns.length > 0 ? '#FEF2F2' : 'var(--card-subtle)', border: failedRuns.length > 0 ? '0.5px solid #FECACA' : '0.5px solid var(--app-border)' }}>
          <div className="text-base font-semibold" style={{ color: failedRuns.length > 0 ? '#991B1B' : 'var(--app-text)' }}>{failedRuns.length}</div>
          <div className="text-xs" style={{ color: failedRuns.length > 0 ? '#991B1B' : 'var(--app-text-secondary)' }}>需要处理</div>
        </button>
      </div>

      {activeRuns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: 'var(--app-text)' }}>正在进行</div>
          {activeRuns.slice(0, 3).map((run) => {
            const linkedTask = plan?.items.find((item) => item.runId === run.runId);
            return (
              <div key={run.runId} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--card-subtle)', border: '0.5px solid var(--app-border)' }}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: 'var(--app-text)' }}>{linkedTask?.title ?? run.prompt}</div>
                  <div className="text-xs" style={{ color: 'var(--app-text-secondary)' }}>@{run.agentName ?? run.agentId}</div>
                </div>
                <Badge variant={getStatusVariant(run.status)}>{getStatusLabel(run.status)}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {failedRuns.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: '#991B1B' }}>需要处理</div>
          {failedRuns.slice(0, 2).map((run) => {
            const linkedTask = plan?.items.find((item) => item.runId === run.runId);
            return (
              <div key={run.runId} className="rounded-lg px-3 py-2 text-sm" style={{ backgroundColor: '#FEF2F2', color: '#991B1B', border: '0.5px solid #FECACA' }}>
                {linkedTask?.title ?? run.prompt} {run.status === 'failed' ? '失败' : '已中断'}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
cd frontend
npm test -- src/components/CollaborationOverview/index.test.tsx
```

Expected: pass.

---

## Task 2: ArtifactPanel Shell With Tasks, Diff, Preview, Summary Tabs

**Files:**
- Create: `frontend/src/components/ArtifactPanel/index.tsx`
- Create: `frontend/src/components/ArtifactPanel/index.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/ArtifactPanel/index.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactPanel } from './index';
import { api } from '../../services/api';
import type { Agent, ChatTimelineItem, PlanCardModel } from '../../types';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getRunFileChanges: vi.fn().mockResolvedValue([
        {
          filePath: 'src/App.tsx',
          changeType: 'edit',
          oldContent: 'before',
          newContent: 'after',
          confidence: 'exact',
          source: 'tool_event',
        },
      ]),
      startRunPreview: vi.fn().mockResolvedValue({ runId: 'run-1', port: 5174, url: 'http://127.0.0.1:5174', status: 'running' }),
    },
  };
});

const agent: Agent = {
  id: 'agent-1',
  name: 'frontend-agent',
  slug: 'frontend-agent',
  platform: 'claude',
  adapter_type: 'claude_cli',
  instructions: null,
  status: 'active',
  capabilities: null,
  config_json: null,
  enabled: true,
  is_default: true,
  created_at: '2026-06-13T00:00:00.000Z',
  updated_at: '2026-06-13T00:00:00.000Z',
};

const plan: PlanCardModel = {
  id: 'plan-1',
  conversationId: 'conv-1',
  prompt: 'build ui',
  summary: 'Build UI',
  createdAt: '2026-06-13T00:00:00.000Z',
  items: [
    {
      index: 1,
      plannerTaskId: 't1',
      title: 'Frontend UI',
      description: 'Build UI',
      assignedAgentId: 'agent-1',
      assignedAgentName: 'frontend-agent',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      runId: 'run-1',
      status: 'completed',
      dependsOn: [],
    },
  ],
};

const run: ChatTimelineItem = {
  id: 'run-1',
  conversationId: 'conv-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'agent-1',
  agentName: 'frontend-agent',
  agentSessionId: null,
  prompt: 'Build UI',
  status: 'completed',
  startedAt: '2026-06-13T00:00:00.000Z',
  finishedAt: '2026-06-13T00:01:00.000Z',
  blocks: [],
  error: null,
};

describe('ArtifactPanel', () => {
  it('renders task artifacts by default', () => {
    render(
      <ArtifactPanel
        open
        activeTab="tasks"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    expect(screen.getByText('成果面板')).toBeTruthy();
    expect(screen.getByText('Frontend UI')).toBeTruthy();
    expect(screen.getByText('@frontend-agent')).toBeTruthy();
  });

  it('loads diff files when Diff tab is active', async () => {
    render(
      <ArtifactPanel
        open
        activeTab="diff"
        selectedRunId="run-1"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    await waitFor(() => {
      expect(api.getRunFileChanges).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('src/App.tsx')).toBeTruthy();
    });
  });

  it('starts preview from the Preview tab', async () => {
    render(
      <ArtifactPanel
        open
        activeTab="preview"
        selectedRunId="run-1"
        plans={[plan]}
        timeline={[run]}
        agents={[agent]}
        onClose={() => {}}
        onTabChange={() => {}}
        onOpenTask={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '启动预览' }));

    await waitFor(() => {
      expect(api.startRunPreview).toHaveBeenCalledWith('run-1');
      expect(screen.getByText('http://127.0.0.1:5174')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
cd frontend
npm test -- src/components/ArtifactPanel/index.test.tsx
```

Expected: fail because `ArtifactPanel` does not exist.

- [ ] **Step 3: Implement `ArtifactPanel`**

Create `frontend/src/components/ArtifactPanel/index.tsx` with focused tab rendering. Use existing `Badge`, `DiffCard`, and `PreviewCard` only where practical. For the first pass, render a simple file list in Diff tab using `api.getRunFileChanges`, and start preview with `api.startRunPreview`.

- [ ] **Step 4: Verify tests pass**

Run:

```bash
cd frontend
npm test -- src/components/ArtifactPanel/index.test.tsx
```

Expected: pass.

---

## Task 3: Wire Overview And ArtifactPanel Into ChatArea

**Files:**
- Modify: `frontend/src/components/ChatArea/index.tsx`
- Modify: `frontend/src/components/ChatArea/index.test.tsx`

- [ ] **Step 1: Write or update failing ChatArea tests**

Add tests that render a conversation with one plan/run and assert:

- `当前协作` appears above timeline.
- `成果面板` appears when tasks/artifacts are opened.
- clicking a run artifact action opens the Diff tab.

- [ ] **Step 2: Implement ChatArea state**

Add state:

```ts
type ArtifactTab = 'tasks' | 'diff' | 'preview' | 'summary';

const [showArtifactPanel, setShowArtifactPanel] = useState(false);
const [artifactTab, setArtifactTab] = useState<ArtifactTab>('tasks');
const [selectedArtifactRunId, setSelectedArtifactRunId] = useState<string | null>(null);
```

Add helper:

```ts
function openArtifacts(tab: ArtifactTab, runId?: string | null) {
  setShowArtifactPanel(true);
  setArtifactTab(tab);
  setSelectedArtifactRunId(runId ?? null);
}
```

- [ ] **Step 3: Render overview and panel**

Render `CollaborationOverview` above the feed entries and `ArtifactPanel` on the right side when open.

- [ ] **Step 4: Verify ChatArea tests**

Run:

```bash
cd frontend
npm test -- src/components/ChatArea/index.test.tsx
```

Expected: pass.

---

## Task 4: Simplify RunCard And Move Artifact Entry Points

**Files:**
- Modify: `frontend/src/components/RunCard/index.tsx`
- Modify: `frontend/src/components/RunCard/index.test.tsx`

- [ ] **Step 1: Update RunCard contract**

Add optional prop:

```ts
onFocusArtifacts?: (runId: string, tab: 'diff' | 'preview' | 'summary') => void;
```

- [ ] **Step 2: Update tests**

Change expectations:

- expanded completed RunCard no longer needs `View Diff` and `Start Preview`.
- completed RunCard shows `查看产物`.
- clicking `查看产物` calls `onFocusArtifacts(runId, 'diff')`.

- [ ] **Step 3: Implement minimal RunCard change**

Keep existing apply/confirmation state intact. Replace primary `View Diff` / `Start Preview` buttons with:

```tsx
{onFocusArtifacts && hasFileChanges && (
  <button type="button" onClick={() => onFocusArtifacts(item.runId, 'diff')}>
    查看产物
  </button>
)}
```

Keep `PreviewCard` support only if needed as temporary fallback, but do not expose it as the primary action.

- [ ] **Step 4: Verify RunCard tests**

Run:

```bash
cd frontend
npm test -- src/components/RunCard/index.test.tsx
```

Expected: pass.

---

## Task 5: Simplify PlanCard Rows And Add Artifact Focus

**Files:**
- Modify: `frontend/src/components/PlanCard/index.tsx`
- Modify: `frontend/src/components/PlanCard/index.test.tsx`

- [ ] **Step 1: Update PlanCard contract**

Add optional prop:

```ts
onFocusArtifacts?: (runId: string, tab: 'diff' | 'preview' | 'summary') => void;
```

- [ ] **Step 2: Update tests**

Assert that task row still shows:

- planner task id or task index.
- task title.
- assigned agent.
- status.

Assert that verbose fields like affected files are not default required assertions anymore.

- [ ] **Step 3: Implement concise rows**

Default row should show:

```text
t1  Frontend UI       @frontend-agent       running
等待 t0
```

Move affected files, long description, and output summary out of the default visual path.

- [ ] **Step 4: Verify PlanCard tests**

Run:

```bash
cd frontend
npm test -- src/components/PlanCard/index.test.tsx
```

Expected: pass.

---

## Task 6: Full Frontend Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted component tests**

Run:

```bash
cd frontend
npm test -- src/components/CollaborationOverview/index.test.tsx src/components/ArtifactPanel/index.test.tsx src/components/ChatArea/index.test.tsx src/components/RunCard/index.test.tsx src/components/PlanCard/index.test.tsx src/components/TaskPanel/index.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
cd frontend
npm test
```

Expected: all pass.

- [ ] **Step 3: Build frontend**

Run:

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Manual browser check**

Run dev server:

```bash
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173/` and verify:

- overview appears after workspace/conversation is selected.
- timeline still reads as chat.
- right Artifact Panel opens.
- Tasks/Diff/Preview/Summary tabs are visible.
- Diff and Preview are no longer buried as the primary RunCard actions.

---

## Self-Review

Spec coverage:

- A+B first-five-seconds readability: Task 1.
- Diff and Preview independent: Task 2, Task 3, Task 4.
- Preserve IM main line: Task 3, Task 4, Task 5.
- Keep backend unchanged: all tasks are frontend-only.
- Avoid full redesign: visual scope limited to overview, panel, and card hierarchy.

Placeholder scan:

- No TBD/TODO placeholders.
- Task 2 allows focused implementation detail because the exact component code should follow existing `DiffCard`/`PreviewCard` patterns and tests define required behavior.

Type consistency:

- Artifact tab type is consistently `'tasks' | 'diff' | 'preview' | 'summary'`.
- Run artifact focus callback consistently passes `(runId, tab)`.
