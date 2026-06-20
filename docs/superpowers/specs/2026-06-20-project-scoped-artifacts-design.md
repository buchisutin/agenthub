# Project-Scoped Artifacts Design

## Context

AgentHub currently uses a selected run to power execution logs, code changes, preview, and deployment. This mixes two different user concepts:

- A task or run describes how one Agent performed a piece of work.
- Code changes, preview, and deployment describe the current state of the whole bound project.

The UI must make that boundary explicit. Selecting a task must never silently change which project version is reviewed, previewed, or deployed.

## Goals

- Make task cards open only task-specific work logs.
- Make code changes, preview, and deployment operate on the bound project workspace.
- Ensure the same project state is used for Diff, preview, and deployment.
- Make the scope of every panel visible to the user.
- Preserve existing run-level execution, approval, retry, and merge behavior.

## Non-Goals

- Aggregating unmerged Agent workspaces into one synthetic Diff.
- Adding staging, committing, reverting, or inline editing features.
- Redesigning Agent configuration or task scheduling.
- Replacing the existing run merge workflow.

## Product Model

The interface has two levels:

| Level | User question | Entry point | Scope |
| --- | --- | --- | --- |
| Task | What did this Agent do? | Task card | One task and its run |
| Project | What does the project look like now? | Top toolbar | Bound workspace |

The top toolbar contains `代码改动`, `网页预览`, `部署`, and `Agents`. Task cards do not expose Diff, preview, or deploy actions.

## User Flow

1. The user selects a task card.
2. A work-log panel opens for that task's run. It contains execution steps, tool activity, errors, elapsed time, and task-level actions such as stop, retry, or approval.
3. When an Agent's work is merged into the bound workspace, the UI reports the number of project files changed.
4. The top-level `代码改动` control refreshes its file-count badge.
5. The user opens the project Diff and reviews the workspace relative to Git `HEAD`.
6. The user opens project preview. Preview runs from that same bound workspace.
7. The user deploys from that same bound workspace.

Unmerged Agent workspace changes remain visible through task state and logs. They do not appear in the project Diff until merge succeeds.

## Task Work-Log Panel

Clicking anywhere on a task card selects its run and opens the work-log panel.

The panel header shows:

- Task title
- Agent slug
- Current task/run status

The body shows execution logs and tool activity. Task-specific controls remain available where relevant. The panel has no tabs for code changes, preview, or deployment.

If a task has no run yet, the panel shows a waiting state instead of selecting a different run.

## Project Diff Panel

The project Diff is opened only from the top toolbar. It does not depend on the selected task or run.

### Header

- Title: `代码改动`
- Scope badge: `整个项目`
- Comparison label: `当前工作区 vs HEAD`
- Summary: changed-file count, added lines, and deleted lines

The toolbar button may show the changed-file count, for example `代码改动 3`.

### Layout

The panel defaults to approximately 620 px wide and remains resizable.

- A roughly 220 px file list shows relative paths, change type, and line counts.
- The remaining area shows the selected file's unified Diff.
- Added, modified, and deleted files have distinct subdued status treatments.
- Large Diffs load on demand.

### States

- Loading: skeleton rows and a loading Diff surface.
- Empty: `当前项目没有未提交的代码改动`.
- Not a Git repository: explain that project Diff requires Git and keep preview/deploy independent where possible.
- Binary file: show metadata without attempting a text Diff.
- Error: keep the panel open and offer a retry action.

## Project Preview and Deployment

Preview and deployment are project-level operations opened from the top toolbar.

- Preview starts in the bound workspace root.
- Deployment scripts are detected in the bound workspace root.
- Deployment runs in the bound workspace root.
- Selecting another task does not restart or change either operation.
- Changing conversations or bound workspaces stops displaying state from the previous workspace.

The panels display the workspace path so the execution target is explicit.

## Frontend Boundaries

The current mixed artifact panel should be separated by responsibility:

- `TaskWorkLogPanel` accepts a selected task/run and renders only logs and task-level controls.
- `ProjectArtifactPanel` accepts a workspace identifier and renders project Diff, preview, or deployment.
- `TaskBoard` emits `onOpenWorkLog(runId)` when a task card is clicked.
- `TopBar` emits `onOpenProjectArtifact('diff' | 'preview' | 'deploy')`.

Project artifact state must be keyed by workspace, not by selected run. A task selection must not mutate the active project artifact target.

## Backend API

Add workspace-scoped endpoints:

```text
GET  /workspaces/:workspaceId/file-changes
POST /workspaces/:workspaceId/preview/start
POST /workspaces/:workspaceId/preview/stop
GET  /workspaces/:workspaceId/deploy/scripts
POST /workspaces/:workspaceId/deploy/start
GET  /workspaces/:workspaceId/deploy
```

`GET /workspaces/:workspaceId/file-changes` compares the bound workspace working tree with Git `HEAD`. It returns relative paths, change types, old/new content where appropriate, and line counts.

Preview and deploy services resolve the workspace record server-side and use its canonical root path. The client must not submit an arbitrary filesystem path for these operations.

Existing run-scoped endpoints may remain temporarily for compatibility and internal run workflows, but the top toolbar must stop calling them.

## Refresh and Data Flow

1. A run completes and its changes are merged into the bound workspace.
2. The server emits or returns a merge-completed signal containing the workspace identifier.
3. The frontend invalidates the workspace Diff summary.
4. The toolbar badge and any open project Diff panel refresh.
5. Preview and deployment continue to target the workspace itself, so no selected-run synchronization is required.

Polling is acceptable as an initial fallback, but merge-triggered invalidation is preferred.

## Safety and Error Handling

- Resolve and validate workspace paths on the server.
- Reject preview or deployment when the workspace no longer exists.
- Keep at most one managed preview process per workspace.
- Keep deploy status scoped to a workspace and prevent duplicate concurrent deploy starts.
- Stop or detach preview state cleanly when a workspace is deleted.
- Return explicit errors for missing Git repositories, unavailable scripts, and process startup failures.

## Testing

### Frontend

- Clicking a task card opens work logs and does not request Diff, preview, or deploy data.
- Clicking each top toolbar control calls a workspace-scoped API without a run identifier.
- Changing task selection does not change the active project artifact target.
- The project Diff renders loading, empty, error, binary, and large-Diff states.
- A merge-completed event refreshes the Diff summary badge.

### Backend

- Workspace Diff reports created, modified, deleted, and renamed files relative to `HEAD`.
- Workspace lookup rejects missing or invalid workspaces.
- Preview and deployment execute from the canonical workspace root.
- Preview lifecycle and deploy concurrency are isolated by workspace.
- Run-scoped operations cannot accidentally become the target of top-level project actions.

### End-to-End

- Complete and merge two tasks, then verify the project Diff includes both merged results.
- Select either task and verify the task panel shows only that task's logs.
- Start preview and deploy after switching task selection, then verify both still target the same bound workspace.

## Acceptance Criteria

- Task-card selection can only open task-specific work logs.
- Project Diff, preview, and deployment work without a selected run.
- Project Diff contains only changes present in the bound workspace.
- Unmerged Agent changes do not appear in the project Diff.
- Preview and deployment execute from the same bound workspace represented by the project Diff.
- The UI visibly labels task-level and project-level scope.
