# Inline Run Status Design

## Goal

Reduce noise in the conversation timeline by replacing expandable RunCard logs with a compact status pill. Full execution details move into the existing right-side Review panel.

## Scope

This change covers:

- one-line Run status pills in the conversation timeline;
- an execution-log tab in the existing ArtifactPanel;
- retry behavior for failed orchestrated and direct runs;
- focused automated and browser verification.

This change does not alter DeployCard, Diff, Preview, Apply, orchestration prompts, or backend run execution semantics.

## Interaction Model

Each Run renders as a single clickable row containing:

- Agent avatar and display name;
- a concise status message;
- a small status indicator;
- an icon-only retry action when the Run failed.

Clicking the row opens the existing ArtifactPanel on the `logs` tab and selects that Run. It never expands content inside the conversation timeline.

The retry button stops click propagation so retrying does not open the log panel.

## Status Copy

- `queued`: `Waiting to start`
- `running`: use the latest running tool when available, for example `Running Bash npm install`; otherwise use `Running`
- `completed`: `Completed · N actions · duration`
- `failed`: concise error text, falling back to `Execution failed`
- `interrupted`: `Interrupted`

Long commands and errors truncate in the pill and remain available in the log panel.

## Visual Design

The pill follows the existing warm-neutral AgentHub palette instead of introducing a separate Vercel theme.

- Default surface: transparent or `var(--card-subtle)`.
- Hover surface: `var(--card-strong)`.
- Text: `var(--app-text)` and `var(--app-text-secondary)`.
- Running: thin spinner using `var(--status-running)`.
- Completed: 6px solid dot using `var(--status-success)`.
- Failed: very light danger-tinted surface with icon and text using `var(--status-danger)`.
- Interrupted: `var(--status-warning)`.
- Retry: transparent icon button with a subtle danger-tinted hover state, tooltip, and `aria-label`.

There are no gradients, heavy borders, or new theme colors.

## Component Changes

### RunCard

RunCard becomes a status-only component. It no longer renders:

- inline tool-call trees;
- Agent long-form output;
- terminal content;
- expandable detail state;
- file-change and merge footers.

It receives two callbacks:

- `onOpenLogs(runId)`
- `onRetry(item)`

It may continue loading lightweight Run metadata only if needed for status copy; full execution detail is owned by the log panel.

### ChatArea

ChatArea maps a Run pill click to:

- open ArtifactPanel;
- select the Run;
- switch to the `logs` tab.

Retry branches by Run origin:

- task Run: call `api.rerunTask(taskId)`, insert the new Run, update the Plan item, mark active, and subscribe to socket events;
- direct Run: call the existing `startRun` helper with the original conversation, prompt, and Agent, without replacing the failed Run.

Retry failures remain associated with the failed pill as concise inline feedback.

### ArtifactPanel

ArtifactPanel adds `logs` to `ArtifactTab`. The tab displays the selected Run only.

The log view:

- uses timeline blocks immediately when details are already loaded;
- calls `api.getRun(runId)` when full events are missing;
- converts events through the existing `applyRunDetail` function;
- shows prompt, Agent output, tool input previews, tool results, approval events, and final errors;
- uses dark terminal blocks only for raw shell output, while the rest of the panel stays on `var(--panel-bg)`.

Changing the selected Run resets stale loading and error state.

## Error Handling

- Log loading errors show a compact retry action inside the log tab.
- Run retry errors appear beside the failed pill without replacing the original execution error.
- A retry always creates a new Run, preserving the failed Run for auditability.
- Running Runs retain interruption capability in the log panel; the pill remains visually compact.

## Testing

### RunCard

- renders one-line status copy for queued, running, completed, failed, and interrupted Runs;
- never renders Agent long output or tool result content;
- opens logs on pill click;
- shows retry only for failed Runs;
- retry click does not open logs.

### ArtifactPanel

- exposes the execution-log tab;
- selects and loads the requested Run;
- renders Agent text, tool input, tool result, and error content;
- reloads after a detail-fetch failure.

### ChatArea

- pill click opens `logs` for the correct Run;
- task retry uses `rerunTask` and updates timeline and Plan state;
- direct retry uses `startRun` with the original Agent and prompt;
- retry errors remain scoped to the relevant Run.

### Browser Verification

At `http://localhost:5173/` verify:

- the conversation timeline contains compact single-line pills;
- clicking pills changes the selected right-side log content;
- no inline log expansion remains;
- failed pills have the intended danger treatment and retry action;
- the layout remains readable with the existing right panel at its minimum and default widths.
