# AgentHub

A local multi-agent collaboration platform that unifies Claude Code CLI and Codex CLI under a chat interface. Send one message, get multiple AI agents working in parallel on your codebase — with real-time visibility into every tool call, file change, and merge conflict.

**Stack:** TypeScript · React · Vite · Tailwind CSS · Node.js · Express · Socket.IO · SQLite

---

## Why

Claude Code and Codex are powerful but isolated. Switching between them means losing context, duplicating work, and manually reconciling changes. AgentHub wires them together: one conversation, multiple agents, one workspace.

---

## How It Works

### Orchestrator → DAG → Parallel Runs

When you send a message, a Planner Agent (OpenAI function-calling) breaks it into a dependency graph of tasks. Tasks with no shared dependencies run in parallel; downstream tasks receive upstream output summaries injected into their prompts.

```
User: "add auth + write tests for it"

Orchestrator plans:
  t1: implement JWT auth endpoint   → assigned to Claude Code
  t2: implement refresh token logic → assigned to Codex        (parallel with t1)
  t3: write auth tests              → depends on t1, t2

t3 prompt includes: "Upstream outputs: t1 added /api/auth/login returning JWT..."
```

### Workspace Isolation

Each agent run gets its own `git worktree` + branch, sharing the `.git` object store but with a fully isolated working directory. No agent can overwrite another's in-progress work.

```
.agenthub/worktrees/
  <run-id-1>/   ← Claude Code works here (branch: agenthub/run-abc)
  <run-id-2>/   ← Codex works here      (branch: agenthub/run-def)
```

### Three-Way Merge

When a run completes, AgentHub performs a three-way comparison:

| Version | Meaning |
|---------|---------|
| **base** | File content when the run started |
| **run** | Agent's output |
| **current** | Main workspace now (may have changed) |

If `current == base`, the change auto-merges. If another agent already modified the file, a conflict is surfaced for manual resolution — with all three versions visible side by side.

### Tool Approval Unified in Web UI

Claude Code and Codex each pop their own terminal approval prompts for dangerous operations. AgentHub installs a `PreToolUse` hook that intercepts every tool call across all agents and routes the approval request to the web UI. One interface for all agents.

### Real-Time Event Stream

The server parses the `stream-json` output from each CLI process and emits structured events over Socket.IO. The frontend reconstructs the full execution timeline in real time — 14 event types including `text_delta`, `tool_started`, `tool_completed`, `run_completed`, and `approval_required`.

---

## Key Engineering Details

**Message queue** — prompts sent while a plan is executing are queued and automatically drained when the current DAG completes, preserving order without blocking the user.

**Conflict prediction** — at planning time, the orchestrator scans `affected_files` across all parallel tasks and pre-flags likely conflicts before any agent starts running.

**Crash recovery** — plan state is persisted to SQLite on every status change. On server restart, the orchestrator rebuilds in-flight plans from the database and continues pending tasks.

**`@slug` direct routing** — prefix a message with `@agent-name` to bypass the orchestrator and route directly to a specific agent, skipping planning overhead.

**Preview + Deploy** — after a run completes, auto-detect `package.json` scripts and launch a dev server from the worktree for in-browser preview before merging.

---

## Quick Start

```bash
# Install dependencies
cd server && npm install
cd ../frontend && npm install

# Start backend (terminal 1)
cd server && npm run dev

# Start frontend (terminal 2)
cd frontend && npm run dev
```

Open `http://localhost:5173`, bind a local project directory, and start a collaboration session.

To enable the LLM planner, set these in `server/.env`:

```
PLANNER_API_URL=https://api.openai.com/v1
PLANNER_API_KEY=sk-...
PLANNER_MODEL=gpt-4o
```

Without them, the orchestrator falls back to single-task execution.

---

## Architecture

```
frontend/                   React + Vite + Tailwind
  components/
    ChatArea/               Main conversation view
    PlanCard/               DAG visualization + task status
    ProjectArtifactPanel/   Per-run output artifacts
    ToolApprovalCard/       Unified tool approval UI

server/
  modules/
    orchestrator/           Planner Agent + DAG scheduler
    merge/                  Three-way merge + conflict resolution
    workspaces/             git worktree lifecycle
    approvals/              PreToolUse hook → web UI bridge
    deploy/ preview/        Dev server management
  runtime/
    claude/                 Claude Code CLI adapter + event parser
    codex/                  Codex CLI adapter + event parser
    base/                   Abstract AgentRuntime interface
```

---

## Research Notes

Before settling on the current merge approach, I surveyed ~20 open-source multi-agent projects (git-lanes, Weave, Wit, STORM, Maestro-AI, Taskplane, etc.) and 3 academic papers. Key conclusions:

- Git worktree isolation + three-way merge is the industry baseline
- LLM-based merging is not mainstream — deterministic approaches (Weave's Tree-sitter entity-level merge) eliminate 95% of false conflicts at zero token cost
- The real token cost is in encoding + context retransmission, not the merge step
- LLM value in merge pipelines is in **self-repair after CI failure**, not in resolving diffs

The `use_llm` merge strategy is stubbed as a reserved interface with the intent to gate it behind a token budget and only activate it when deterministic resolution fails.
