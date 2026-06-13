# Phase 3 Acceptance

## Phase 3 capability checklist

- `messages` persistence for user and orchestrator plan messages
- conversation timeline restore via `GET /conversations/:conversationId/timeline`
- `tasks` persistence for orchestrated plan items
- `task_assignments` persistence for task-to-agent ownership
- task rerun via `POST /tasks/:taskId/rerun`
- task cancel via `PATCH /tasks/:taskId/status`
- PlanCard restore from `tasks + assignments + latest runs`
- RunCard restore with diff and preview entrypoints intact

## Timeline ordering rules

Timeline restore follows these rules:

1. user and system messages sort by `messages.created_at`
2. plan messages sort by `messages.created_at`
3. run cards sort by `agent_runs.started_at`
4. if timestamps are identical, ordering is:
   - user/system message
   - plan message
   - run card
5. if multiple runs share the same timestamp, the fallback order is:
   - `started_at`
   - `run.id`

This keeps restore order stable across repeated requests and across frontend refreshes.

## Task / assignment / run status linkage

Current minimal linkage:

- run `running` -> assignment `running`, task `running`
- run `completed` -> assignment `completed`, task `completed`
- run `failed` -> assignment `failed`, task `failed`
- run `interrupted` -> assignment `interrupted`, task `interrupted`

Task operations:

- `cancel task`
  - allowed: `pending`, `assigned`, `failed`, `interrupted`
  - rejected: `completed`
  - rejected: `running` or queued latest run, user should interrupt run first
- `rerun task`
  - reuses the existing assignment
  - updates `assignment.latest_run_id`
  - keeps old runs visible in timeline
  - makes PlanCard “查看执行” point to the latest run

## Current limitations

- not a full Task Board yet
- one task still maps to one assignment and one `latest_run_id`
- preview is run-scoped in-memory state and does not survive backend restart
- diff is inferred from `run_events + workspace filesystem`
- no worktree isolation
- no daemon / queue / lease
- no approval enhancement
- no multi-assignment aggregation
- agent natural-language replies are still primarily rendered from run timeline blocks

## Manual acceptance script

1. Send a normal user message in an existing conversation.
   - refresh the page
   - confirm the `MessageCard` restores

2. Send a normal `@agent` fan-out message, for example:
   - `@frontend-agent @backend-agent 做一个首页`
   - confirm two `RunCard`s are created
   - refresh the page
   - confirm the user message and both runs restore in the same conversation

3. Send an `@orchestrator` message, for example:
   - `@orchestrator 做一个带登录的博客系统`
   - confirm a `PlanCard` appears
   - confirm plan items have matching `RunCard`s

4. Refresh the page after orchestration.
   - confirm `MessageCard -> PlanCard -> RunCard` ordering is restored
   - confirm `PlanCard` still points to the latest run for each task

5. Open `Tasks`.
   - confirm `TaskPanel` lists current conversation tasks
   - open one task
   - confirm `TaskDetail` shows task, assignment, and latest run

6. Cancel an eligible task.
   - use a `failed` or `interrupted` task
   - confirm `TaskPanel`, `TaskDetail`, and `PlanCard` all show `cancelled`

7. Rerun a task.
   - confirm a new `RunCard` appears
   - confirm the old run still remains in timeline
   - confirm `PlanCard` “查看执行” now targets the new run

8. Refresh the page after rerun.
   - confirm both old and new runs still exist
   - confirm `PlanCard` still points to the rerun `latest_run_id`

9. Open diff and preview from the rerun run.
   - click `查看代码改动`
   - confirm diff request is scoped to the rerun `runId`
   - click `启动预览`
   - confirm preview iframe is scoped to the rerun `runId`

10. Start multiple runs in parallel and interrupt one.
   - confirm `TopBar` running count updates correctly
   - confirm interrupting one run does not change the others
