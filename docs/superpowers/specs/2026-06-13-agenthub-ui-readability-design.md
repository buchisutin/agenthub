# AgentHub UI Readability Redesign

Date: 2026-06-13

## 1. Goal

Improve the main frontend page readability without changing AgentHub's original product direction.

The page should let users understand two things within the first five seconds:

1. **Collaboration is happening**: which Agents are running, what tasks are in progress, and how far the whole plan has progressed.
2. **Artifacts are usable or not**: which file changes exist, whether they are merged/applied, whether Preview is available, and whether the user must handle a confirmation or conflict.

The redesign keeps AgentHub as an IM-style multi-Agent collaboration platform. It should not become a pure DAG dashboard or IDE clone.

## 2. Current Problem

The current UI has the right building blocks, but the information hierarchy is weak:

- `ChatArea` mixes messages, plans, run execution, tool calls, diff actions, preview actions, task detail actions, and rerun actions.
- `RunCard` carries too many responsibilities: execution summary, tool timeline, diff entry, preview entry, apply state, confirmation state, and workspace state.
- `PlanCard` shows task details, but it does not clearly answer "what is happening now" or "what is blocked".
- `TaskPanel` exists, but it is task-centered rather than artifact-centered.
- Diff and Preview are hidden inside individual RunCards, even though users think of them as session-level deliverables.

The result is that the user must scroll and inspect multiple cards to understand the collaboration state.

## 3. Design Principle

Separate the page into two mental zones:

```text
Collaboration process: what Agents are doing
Artifact workspace: what the produced result looks like and whether it can be accepted
```

Chat remains the main product surface. Artifacts become a dedicated workspace rather than being buried inside run cards.

## 4. Proposed Layout

```text
+----------+--------------------------------------+----------------------+
| Sidebar  | Main Collaboration Area              | Artifact Panel       |
|          |                                      |                      |
| sessions | TopBar                               | Current Result       |
|          | Collaboration Overview               | Tabs                 |
|          |                                      | [Tasks] [Diff]       |
|          | Chat Timeline                        | [Preview] [Summary]  |
|          |  - user message                      |                      |
|          |  - orchestrator plan                 | Task list / Diff /   |
|          |  - compact run summaries             | Preview / Summary    |
|          |  - confirmation cards                |                      |
|          |                                      |                      |
|          | Chat Input                           |                      |
+----------+--------------------------------------+----------------------+
```

The main area keeps the IM conversation. The right panel becomes the place where users inspect tasks and artifacts.

## 5. Collaboration Overview

Add a compact overview block below `TopBar` and above the chat timeline.

It answers:

- How many tasks are completed out of total tasks.
- How many Agents are running.
- Whether anything needs the user's attention.
- How many files have been produced or merged.

Example:

```text
Current Collaboration
3 / 5 tasks complete     2 agents running     1 needs confirmation     4 files changed

Now running
Frontend Agent   Build navigation shell       running
Test Agent       Add component tests          waiting for t1

Needs attention
Resolve conflict in src/App.tsx
```

### Data Source

Use existing frontend state first:

- `plansByConversation`
- `timeline`
- `activeRunIdsByConversation`
- task statuses from plan items
- run card summaries when available
- approval/confirmation items from timeline once surfaced

The first version can compute best-effort counts on the client. A later backend endpoint can provide a canonical conversation summary.

### Display Rules

- Hide the overview when no conversation is selected.
- Show an empty state when a workspace is bound but no run exists yet.
- Prioritize "needs attention" over progress if there are pending confirmations or conflicts.
- Do not show raw implementation terms like `agent_run` or `approval_request`.

## 6. Main Chat Timeline

The timeline should focus on collaboration narrative:

- User messages.
- Orchestrator planning state.
- PlanCard.
- Compact RunCard summaries.
- ConfirmationCard.

The timeline should not be the primary place for artifact inspection.

### Message Cards

Keep the current IM-style message display. Improve readability by making user intent easy to scan:

- User command text.
- Mention chips for `@orchestrator` and `@agent`.
- Timestamp secondary.

### PlanCard

PlanCard should become a readable "Orchestrator plan message", not a full workflow console.

It should show:

- Plan summary.
- Overall progress.
- Task list with concise status.
- Dependency hint only when useful.
- Open task action.
- Open artifact panel action when files or run exist.

Avoid showing too much per-task metadata by default. A task row should not show title, description, dependency, affected files, output summary, status, run link, and resume action all at once.

### RunCard

RunCard should default to a compact execution summary:

- Agent name.
- Linked task title or prompt.
- Status.
- Short final summary or running state.
- Tool count.
- Changed file count if known.
- Artifact state: merged / needs confirmation / conflict / no changes.

Tool calls stay collapsed by default. Diff and Preview buttons should move to the Artifact Panel.

RunCard can still provide:

- "View details" for tool timeline.
- "Focus artifacts" to select this run in the Artifact Panel.
- "Interrupt" while running.

## 7. Artifact Panel

Replace or evolve the current `TaskPanel` into an `ArtifactPanel`.

The panel is a session-level inspection area with tabs:

```text
[Tasks] [Diff] [Preview] [Summary]
```

It should be right-side and persistent on desktop. On narrow screens, it can become a drawer opened from the overview or toolbar.

### Panel Header

The header shows current result state:

```text
Result
4 files changed
2 merged
1 needs confirmation
0 conflicts
```

If a run or task is selected, show a scoped label:

```text
Inspecting: t2 Build navigation shell
```

### Tasks Tab

Tasks tab replaces the current task-only right drawer behavior while keeping its useful filtering.

It shows:

- status filters.
- search.
- compact task rows.
- selected task details inline or in a secondary drawer.

Each task row should answer:

- What task is this?
- Who owns it?
- What is its current state?
- Is it blocked by dependency, merge, confirmation, or failure?

### Diff Tab

Diff becomes a dedicated artifact view.

It should support:

- conversation-level list of changed files.
- run-scoped diff when the user selects a specific run.
- file list on top or left.
- selected file diff body.
- conflict/safe/skipped labels when apply check data exists.

Entry points:

- Overview "files changed" metric opens Diff tab.
- RunCard "Focus artifacts" opens Diff tab scoped to that run.
- PlanCard task row can open Diff tab if the task has a run with changes.

### Preview Tab

Preview becomes independent from RunCard.

It should support:

- selected run preview.
- start/stop preview controls.
- open in browser link.
- preview unavailable state.
- cleaned workspace state.

Entry points:

- Overview "Preview available" action.
- RunCard "Focus artifacts".
- Artifact Panel tab.

The user should not need to expand a RunCard to find Preview.

### Summary Tab

Summary becomes the report/export space.

It can reuse the current `SummaryModal` logic initially, but the product direction should be:

- summary visible in the panel.
- copy Markdown action.
- counts for tasks, runs, changed files, pending confirmations.
- final collaboration report.

The modal can remain for MVP if moving it inline is too large for one pass.

## 8. Interaction Model

### Selection

The UI should maintain a lightweight selected context:

```ts
selectedArtifactContext:
  | { type: 'conversation' }
  | { type: 'run'; runId: string }
  | { type: 'task'; taskId: string; runId?: string }
```

This context controls what the Artifact Panel shows.

Examples:

- Clicking a RunCard focuses that run's artifacts.
- Clicking a task row focuses the task and latest run.
- Clicking overview file count focuses conversation-level Diff.

### Attention State

The page should make pending user action visible:

- pending confirmation.
- conflict needing resolution.
- failed run blocking downstream.
- dirty workspace blocking new write task.
- runtime unavailable.

These states should appear in the overview and the Artifact Panel header, not only deep inside a RunCard.

## 9. Component Boundary

Keep existing product architecture, but clean responsibilities:

### `ChatArea`

Owns:

- conversation layout.
- chat input.
- timeline rendering.
- panel open/selection state.

Does not own:

- rendering diff bodies.
- preview iframe.
- full task inspection UI.
- artifact summary layout.

### `CollaborationOverview`

New component.

Owns:

- progress metrics.
- active agent/task summary.
- needs-attention summary.
- quick actions to open artifact tabs.

### `ArtifactPanel`

New or evolved component from `TaskPanel`.

Owns:

- Tasks tab.
- Diff tab.
- Preview tab.
- Summary tab.
- selected artifact context.

### `RunCard`

Owns:

- execution summary.
- compact status.
- tool details expansion.
- run-level action entry points.

Does not own:

- primary Diff UI.
- primary Preview UI.

### `PlanCard`

Owns:

- plan summary.
- concise task list.
- task status and selection entry points.

Does not own:

- deep artifact inspection.
- complex DAG/pipeline visualization.

## 10. Visual Direction

The visual change should improve hierarchy more than decoration.

Recommended style:

- Light, restrained operational UI.
- Keep current neutral palette, but reduce low-contrast gray-on-gray sections.
- Use fewer nested cards.
- Use clearer section labels.
- Keep cards radius around current 8px.
- Avoid decorative gradients or oversized hero elements.
- Make status colors consistent and sparse.

Specific readability improvements:

- Use one primary text line per row.
- Move secondary metadata into small chips.
- Avoid showing more than two lines of description in timeline cards.
- Make "needs attention" visually stronger than normal metadata.
- Make artifact actions consistent: Diff, Preview, Summary live in the panel.

## 11. Mobile Behavior

Desktop:

- Sidebar fixed left.
- Main chat center.
- Artifact Panel fixed right.

Tablet/mobile:

- Sidebar can remain existing behavior.
- Artifact Panel becomes drawer.
- Overview remains above timeline.
- Chat timeline remains primary.

Do not optimize for a fully new mobile navigation system in the first pass.

## 12. Implementation Scope

First implementation pass should include:

1. Add `CollaborationOverview`.
2. Add or refactor `ArtifactPanel` with tabs.
3. Move Diff and Preview entry points out of expanded RunCard into ArtifactPanel.
4. Simplify default RunCard view.
5. Simplify PlanCard task rows.
6. Keep existing API behavior.
7. Keep existing modal/report functionality if inline Summary is too large.

Out of scope for first pass:

- Full visual redesign of all colors.
- Backend conversation artifact summary endpoint.
- New deployment feature.
- New multi-user approval system.
- Full DAG graph visualization.
- Replacing socket or runtime architecture.

## 13. Acceptance Criteria

The redesign is successful if:

- On a conversation with an Orchestrator plan, the first viewport shows overall progress and active work.
- Pending confirmation/conflict is visible without expanding a RunCard.
- Diff can be opened from the Artifact Panel.
- Preview can be opened from the Artifact Panel.
- RunCard still lets users inspect tool calls, but tool calls are not the default visual focus.
- ChatArea still feels like an IM collaboration surface.
- Existing run creation, orchestration, apply, preview, and summary behavior remain available.

## 14. Risks

### Risk: Artifact Panel duplicates TaskPanel

Mitigation: evolve TaskPanel into ArtifactPanel rather than keeping two competing right panels.

### Risk: Conversation-level Diff is ambiguous

Mitigation: first version can default to selected run diff and show conversation-level changed file list as navigation. Canonical aggregation can come later.

### Risk: RunCard loses discoverability

Mitigation: keep clear "Focus artifacts" and "View details" actions.

### Risk: Too much changes at once

Mitigation: implement in small UI-only steps:

1. overview.
2. artifact panel shell.
3. move diff.
4. move preview.
5. simplify cards.

## 15. Final Direction

The page should read as:

```text
I asked a group of Agents to work.
I can immediately see who is working and what is blocked.
I can inspect the produced artifacts in one dedicated place.
The chat timeline remains the collaboration record.
```

This preserves the original AgentHub design while making the frontend easier to understand and more convincing for the contest.
