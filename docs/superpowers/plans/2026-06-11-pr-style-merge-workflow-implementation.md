# PR-Style Merge Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local PR-style merge pipeline so orchestrated tasks unlock DAG dependents only after their run output is merged into the real project workspace.

**Architecture:** Add a focused backend `MergeService` that compares `base workspace`, `run workspace`, and `main workspace` and drives auto-merge, conflict review, and approval completion. Wire Orchestrator to treat `run completed` as an intermediate state, then only mark the task complete and unblock downstream DAG tasks after merge success or approved conflict resolution.

**Tech Stack:** TypeScript, Express, SQLite, React, Socket.IO, Vitest

---

### Task 1: Define Merge Data Model And Service Boundaries

**Files:**
- Create: `server/src/modules/merge/merge.types.ts`
- Create: `server/src/modules/merge/merge.service.ts`
- Modify: `server/src/shared/types.ts`
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/db/client.ts`

- [ ] Add merge result, merge conflict, and merge record types for backend and frontend consumption.
- [ ] Add a `run_merges` table for merge lifecycle state and approval linkage.
- [ ] Add db backfill logic so existing databases can read the new schema without reset.
- [ ] Verify type names match the planned API fields: `status`, `conflicts`, `appliedFiles`, `blockedReason`, `approvalId`.

### Task 2: Implement MergeService Against Real Project Directory

**Files:**
- Create: `server/src/modules/merge/merge.service.ts`
- Modify: `server/src/modules/runs/run-change-application.service.ts`

- [ ] Reuse existing file-change extraction and safe path validation patterns from `run-change-application.service.ts`.
- [ ] Implement three-way file classification using `base`, `main`, and `run` versions.
- [ ] Auto-apply safe files directly into the bound workspace directory.
- [ ] Mark large files, binary files, delete conflicts, and unsupported conflicts as manual review.
- [ ] Keep LLM auto-resolve as an optional dependency hook; when unavailable or unsafe, fall back to manual review.

### Task 3: Rewire Orchestrator Completion Around Merge Success

**Files:**
- Modify: `server/src/modules/orchestrator/orchestrator.service.ts`
- Modify: `server/src/app.ts`

- [ ] Inject `MergeService` into Orchestrator and approval executor wiring.
- [ ] Replace watcher behavior that creates end-of-plan apply approvals with per-run merge handling.
- [ ] On run success, attempt merge immediately; only call `scheduler.notifyCompleted()` after merge success.
- [ ] On run failure, continue to call `scheduler.notifyFailed()` so downstream tasks block.
- [ ] Emit `conflict_review` messages and system progress updates for merge pending, merge success, and blocked states.

### Task 4: Connect Approval Actions To Merge Conflict Resolution

**Files:**
- Modify: `server/src/modules/approvals/approvals.routes.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/shared/types.ts`

- [ ] Extend conflict approval payload to support `use_run`, `use_base`, and `use_llm`.
- [ ] Route `resolve_conflicts` approvals through `MergeService`, not `RunChangeApplicationService`.
- [ ] After approved conflict resolution succeeds, complete the task and unlock DAG downstream tasks.
- [ ] If approval is rejected or merge cannot continue, keep the task blocked and preserve review state.

### Task 5: Render Conflict Review With Merge Context In Frontend

**Files:**
- Create: `frontend/src/components/ConflictReviewCard/index.tsx`
- Modify: `frontend/src/components/ChatArea/index.tsx`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] Move merge conflict review rendering into a dedicated card component.
- [ ] Show conflict reason, before/current/run content, and action choices.
- [ ] Support the new `use_llm` choice only when the backend marks it available.
- [ ] Keep using the existing approval fetch/approve/reject flow so no new transport layer is introduced.

### Task 6: Add Focused Regression Tests

**Files:**
- Create: `server/tests/merge.service.test.ts`
- Modify: `server/tests/orchestrator.test.ts`
- Modify: `frontend/src/components/ChatArea/index.test.tsx`

- [ ] Cover pure safe merge, conflict review creation, and approved conflict resolution in backend tests.
- [ ] Verify DAG downstream tasks do not start until merge success, even when the run itself has completed.
- [ ] Verify conflict review UI renders merge actions and submits approval payloads.
- [ ] Run targeted backend and frontend test commands plus build checks.
