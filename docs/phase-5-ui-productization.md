# Phase 5.1: Chat Workspace UI Productization

## Page Structure

Two-pane layout with collapsible right sidebar:

```
+----------+---------------------------+-----------+
| Sidebar  | Chat Workspace            | TaskPanel |
|          | +---------------------+   | (toggle)  |
| convs    | | TopBar              |   |           |
| new      | +---------------------+   | tasks     |
| ws info  | | MessageCard          |   | filter    |
|          | | PlanCard             |   | detail    |
|          | | RunCard              |   |           |
|          | | RunCard              |   |           |
|          | +---------------------+   |           |
|          | | ChatInput            |   |           |
|          | +---------------------+   |           |
+----------+---------------------------+-----------+
```

## Component Overview

### TopBar

- Conversation title
- Running count badge: "N running" / "idle"
- Connection status dot (green/red)
- Workspace path (truncated)
- Clean up link (muted, secondary)
- Agent count

### MessageCard

- User messages: right-aligned accent bubble with timestamp
- System/orchestrator/agent messages: left-aligned dark card with sender label
- Mentions rendered as markdown bold
- Timestamp shown at bottom-right of each bubble

### PlanCard

- Header: "Task Plan" + "N/M completed" progress
- Summary text below header
- Task items: index, title, agent name, status badge, View Task / View Run buttons
- Status colors: completed=green, running=amber, failed=red, cancelled=gray

### RunCard (RunTimeline)

- Header: agent name, short run ID, status badges, tool counts, interrupt
- Workspace mode badge: worktree (blue), clone (purple), legacy (gray), cleaned (red)
- Apply status badge: Applied (green), No changes (gray), Apply failed (red)
- Conflict panel: yellow warning with safe/conflict/skipped breakdown
- Footer actions: View Diff, Start Preview, Apply Changes, Clean workspace
- State-gated: cleaned hides Diff/Preview/Apply, applied hides Apply button

### DiffCard

- File-based diff panels with expand/collapse
- Best-effort warning for inferred diffs
- File list at top

### PreviewCard

- Local iframe preview (127.0.0.1)
- Open in new tab link
- Stop preview button
- Preview error display

### TaskPanel

- Slide-out right panel, toggled via "Tasks" button
- Tasks grouped by status (visual grouping via status badge)
- Each task: title, assigned agent, status, latest run status
- Click opens TaskDetailDrawer

### TaskDetailDrawer

- Task title, description, status
- Assignment info + agent
- Latest run ID and status
- Actions: View Run, Cancel Task, Rerun Task

### ChatInput

- Textarea with placeholder: "Ask agents to build, fix, review, or preview... (@agent-name, @orchestrator)"
- Enter to send, Shift+Enter for new line
- Send button with loading state
- Workspace binding warning if unset

## Status Display Rules

| Condition | RunCard Shows |
|-----------|--------------|
| running | Interrupt button, no Apply |
| completed + workspace ready | Diff, Preview, Apply Changes, Clean workspace |
| completed + cleaned workspace | "工作区已清理" message, no actions |
| completed + already applied | Applied badge + file count |
| conflict detected | Yellow ConflictPanel with breakdown |
| preview running | PreviewCard embedded |

## Known Limitations

- TaskPanel does not support status filtering yet
- No kanban board view
- No agent management page
- Preview iframe height: default 400px, min 240px, max 800px, drag handle resize
- DiffCard shows per-file conflict/skipped status when applyCheck is provided

## Phase 5.2: TaskPanel Filtering + Interaction Polish

### TaskPanel Filtering

- Filter tabs: All, Active, Completed, Failed, Cancelled
- Each tab shows count (e.g., "Active 3")
- Status mapping:
  - Active: pending, assigned, running, queued, in_progress
  - Completed: completed
  - Failed: failed, interrupted
  - Cancelled: cancelled
- Search box filters by task title, description, or assigned agent name
- Filter and search can be combined
- Empty state messages: "No active tasks", "No matching tasks"
- All filtering is client-side, no new API calls

### RunCard Action Grouping

- Primary actions: View Diff, Start Preview, Apply Changes (when completed)
- Secondary: Clean workspace
- Cleaned workspace shows message only, no action buttons
- All labels in English

### PreviewCard Resize

- Default height: 400px
- Min height: 240px, max height: 800px
- Drag handle with `role="separator"` and `aria-label="Resize preview height"`
- Height managed via component-local state

### DiffCard Conflict Awareness

- Accepts optional `applyCheck` prop
- Shows per-file status labels in file list: safe (green), conflict (red), skipped (gray)
- Conflict/skipped files show reason inline
- No changes to diff rendering logic

### Status Badge Colors (Unified)

| Status | Color | Use |
|--------|-------|-----|
| running/queued | #E3B341 amber | PlanCard, RunCard, TaskPanel |
| completed | #3FB950 green | PlanCard, RunCard, TaskPanel |
| failed/interrupted | #F85149 red | PlanCard, RunCard, TaskPanel |
| cancelled | #8B949E gray | PlanCard, RunCard, TaskPanel |
| applied | #3FB950 green | RunCard |
| conflict | #F85149 red | RunCard, DiffCard |
| cleaned | #F85149 red | RunCard |
| skipped | #8B949E gray | DiffCard |
