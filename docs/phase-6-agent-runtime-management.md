# Phase 6.1: Agent / Runtime Management MVP

## Agent fields

The `agents` table now supports:

- `id`: stable agent identifier
- `name`: display name
- `slug`: mention key used by chat input, for example `frontend-agent`
- `adapter_type`: runtime adapter key resolved through `RuntimeRegistry`
- `instructions`: optional agent guidance shown in management UI and passed as planner context summary
- `capabilities_json`: string array of lightweight capability tags
- `enabled`: disabled agents are hidden from mention fan-out and orchestrator selection
- `is_default`: marks the default agent used when a run is created without `agentId`
- `created_at`
- `updated_at`

Task orchestration metadata now also supports:

- `tasks.task_type`: `frontend | backend | test | docs | review | deploy | general`
- `tasks.expected_output`: lightweight expected deliverable summary used for plan restore and rerun prompts

## Default agent rules

- At most one enabled agent can be default at a time.
- Setting one agent as default clears `is_default` on the others.
- A disabled agent cannot be marked as default.
- The current default agent cannot be disabled directly. Pick another default first.
- Creating a run without `agentId` uses the enabled default agent.

## Enabled / disabled behavior

- `GET /agents` returns enabled agents only.
- `GET /agents?includeDisabled=true` returns all agents.
- Disabled agents do not appear in chat mention parsing.
- Disabled agents do not participate in orchestrator planning or assignment.
- Creating a run with a disabled `agentId` returns `400`.

## Mention parsing rules

- Chat mentions resolve against enabled agents only.
- Matching checks `@slug` first, then agent name.
- `@orchestrator` remains a built-in mention and is not stored in the agents table.
- If a user types the slug of a disabled agent manually, it is treated as an unknown mention and follows the existing fallback behavior.

## Orchestrator agent selection

The planner prompt only includes enabled agents and passes:

- `id`
- `name`
- `slug`
- `adapter_type`
- `capabilities`
- a short `instructions` summary

Matching priority after planning:

1. exact slug
2. exact name
3. slugified slug or name
4. partial match on slug or name
5. capability tag match
6. fallback to the enabled default agent

## Agent instructions in run prompts

When a run starts, AgentHub now builds a structured runtime prompt that includes:

- agent identity: `name` and `@slug`
- agent capabilities
- agent instructions
- linked task context:
  - task title
  - task description
  - expected output
- execution rules:
  - stay inside the run workspace
  - prefer small focused changes
  - explain blockers clearly
  - keep final summaries concise
- the original user request

The original user prompt is still preserved on the run record. The structured prompt is only used for runtime execution.

## Capabilities and planner quality

The orchestrator planning prompt now includes, for each enabled and runtime-available agent:

- `id`
- `name`
- `slug`
- `adapter_type`
- `capabilities`
- a short `instructions` summary

The planner is instructed to:

- prefer capability-aligned assignment
- produce concrete deliverables
- avoid vague tasks
- emit strict JSON only
- return 1 to 5 tasks, usually 2 to 4

Each planner task now carries:

- `task_type`
- `expected_output`
- `suggested_agent`
- `priority`

Fallback planning still works when the planner fails or returns invalid JSON. In that case the task defaults to:

- `task_type = general`
- `expected_output = "Complete the requested change and summarize the result."`

## task_type and expected_output rules

- `frontend`: UI or frontend code changes
- `backend`: API, service, or data-layer changes
- `test`: automated tests
- `docs`: documentation updates
- `review`: review or verification work
- `deploy`: deployment or rollout steps
- `general`: anything that does not fit the specialized buckets

These fields are persisted on `tasks`, returned through the timeline/plan APIs, shown in PlanCard and Task Detail, and reused when rerunning a task.

## Current limitations

- This is a local MVP with no multi-user permissions.
- There is no runtime health daemon or runtime telemetry UI.
- Agent management lives in a lightweight modal, not a dedicated page.
- Adapter validation is shallow: `adapter_type` must be non-empty, and runtime resolution still happens at run creation time.
- There is no agent marketplace, import/export, or historical analytics yet.
- This is not a skills, memory, or long-term knowledge system.
- There is no prompt-template management UI.
- There is no automatic prompt optimization or self-reflection loop.

## Runtime registry visibility

Runtime visibility is now exposed through:

- `GET /runtimes`
- `GET /runtimes/check`
- `GET /runtimes/:adapterType/check`

Each adapter reports two distinct concepts:

- `registered`: the adapter exists in `RuntimeRegistry`
- `available`: the current machine can actually use it

This distinction matters because an agent may be configured against a registered adapter before the required local CLI is installed.

## Claude CLI check

The `claude_cli` adapter uses a lightweight local command check:

- command: `<claudeCommand> --version`
- success: marks the adapter as `available=true`
- failure: returns `available=false` with the captured message

Checks are best-effort and never crash the server. A failing check only affects adapter availability status and run creation validation.

## Agent adapterType selection

- Agent create/edit forms now use a runtime-backed select instead of a free-text adapter field.
- Options come from `GET /runtimes`.
- Existing agents with stale or unregistered adapter types still render, but show an `unregistered` runtime state.
- A runtime may be selectable even when unavailable, which supports configuring agents ahead of local CLI installation.

## Runtime unavailable run behavior

- Creating a run with an unregistered adapter returns `400`.
- Creating a run with a registered but unavailable adapter returns `400` with the runtime diagnostic message.
- The orchestrator only considers agents that are:
  - enabled
  - backed by a registered adapter
  - backed by an available adapter

## Additional limitations

- Runtime availability is checked on demand; there is no background daemon or heartbeat loop.
- There is no automatic CLI installation or repair flow.
- Runtime checks are local-machine only; no remote runtimes or multi-host routing are supported.
