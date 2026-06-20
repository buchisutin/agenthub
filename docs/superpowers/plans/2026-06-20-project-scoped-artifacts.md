# Project-Scoped Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate task-level work logs from workspace-level code changes, preview, and deployment so the top toolbar always operates on the bound project.

**Architecture:** Keep run-scoped APIs for compatibility, then add workspace-scoped services and routes alongside them. Split the current mixed `ArtifactPanel` into a run-backed `TaskWorkLogPanel` and a workspace-backed `ProjectArtifactPanel`; `ChatArea` owns the two independent selections so choosing a task cannot retarget project operations.

**Tech Stack:** TypeScript 6, Express 5, SQLite, Node child processes and Git CLI, React 19, Vitest, Testing Library, Socket.IO, Tailwind CSS.

---

## File Structure

### Server

- Create `server/src/modules/workspaces/workspace-diff.service.ts`: compute Git `HEAD` versus working-tree changes for one persisted workspace.
- Modify `server/src/modules/workspaces/workspaces.routes.ts`: expose the workspace Diff endpoint.
- Modify `server/src/modules/preview/preview.service.ts`: add workspace-keyed preview lifecycle while retaining run methods.
- Modify `server/src/modules/preview/preview.routes.ts`: expose workspace preview start and stop routes.
- Modify `server/src/modules/deploy/deploy.service.ts`: add workspace-keyed scripts, deploy start, and deploy status methods.
- Modify `server/src/modules/deploy/deploy.routes.ts`: expose workspace deployment routes.
- Modify `server/src/modules/merge/merge.types.ts`: add the merged-workspace callback dependency.
- Modify `server/src/modules/merge/merge.service.ts`: notify after a successful merge changes the base workspace.
- Modify `server/src/sockets/socket-server.ts`: emit `workspace_changed` to the conversation room.
- Modify `server/src/app.ts`: construct the new service and connect merge notifications to realtime.
- Modify `server/src/shared/types.ts`: add project Diff, workspace deploy, and workspace-change contracts.
- Create `server/tests/workspace-artifacts.test.ts`: exercise workspace Diff, preview, deploy, invalid paths, and task-selection independence at the API boundary.
- Modify `server/tests/preview.test.ts` and `server/tests/deploy.test.ts`: cover workspace service lifecycle and concurrency.

### Frontend

- Modify `frontend/src/types/index.ts`: mirror project artifact response and event types.
- Modify `frontend/src/services/api.ts`: add workspace-scoped API methods.
- Create `frontend/src/services/api.test.ts`: verify workspace endpoint paths and payloads.
- Modify `frontend/src/services/socket.ts`: receive `workspace_changed`.
- Modify `frontend/src/store/appState.ts`: store a per-workspace revision counter.
- Modify `frontend/src/store/AppContext.tsx`: bump the revision when the workspace changes.
- Create `frontend/src/hooks/useProjectDiff.ts`: fetch one workspace Diff and refresh when its revision changes.
- Create `frontend/src/components/TaskWorkLogPanel/index.tsx`: task/run-only drawer around `RunLogPanel`.
- Create `frontend/src/components/TaskWorkLogPanel/index.test.tsx`: prove the drawer only loads logs.
- Create `frontend/src/components/ProjectArtifactPanel/index.tsx`: resizable project artifact shell.
- Create `frontend/src/components/ProjectArtifactPanel/ProjectDiffView.tsx`: project summary, file list, and selected unified Diff.
- Create `frontend/src/components/ProjectArtifactPanel/ProjectPreviewView.tsx`: workspace preview controls and frame.
- Create `frontend/src/components/ProjectArtifactPanel/ProjectDeployView.tsx`: workspace script picker, deploy action, and logs.
- Create `frontend/src/components/ProjectArtifactPanel/index.test.tsx`: cover all workspace tabs and states.
- Modify `frontend/src/components/PlanCard/index.tsx`: task cards emit work-log selection for every task with a run.
- Modify `frontend/src/components/PlanCard/index.test.tsx`: prove task clicks open logs, never Diff.
- Modify `frontend/src/components/TopBar/index.tsx`: use the explicit `diff | preview | deploy` project tabs and show the workspace file-count badge.
- Modify `frontend/src/components/TopBar/index.test.tsx`: cover project tab routing and the badge.
- Modify `frontend/src/components/ChatArea/index.tsx`: own separate task-log and project-artifact state and wire workspace refresh.
- Modify `frontend/src/components/ChatArea/index.test.tsx`: cover the complete user flow and selection isolation.
- Remove `frontend/src/components/ArtifactPanel/index.tsx` and its test after all consumers use the two focused panels.

---

### Task 1: Add workspace Diff contracts and service

**Files:**
- Create: `server/src/modules/workspaces/workspace-diff.service.ts`
- Modify: `server/src/shared/types.ts`
- Modify: `server/src/modules/workspaces/workspaces.routes.ts`
- Modify: `server/src/app.ts`
- Create: `server/tests/workspace-artifacts.test.ts`

- [ ] **Step 1: Write the failing workspace Diff API tests**

Create a Git-backed harness, bind its workspace, then edit a tracked file, create an untracked file, and delete a tracked file. Assert that only changes in the base workspace are returned:

```ts
it("returns the bound workspace diff relative to HEAD", async () => {
  const harness = await createTestHarness();
  harnesses.push(harness);
  const conversation = await harness.client.post("/conversations", {
    title: "Project diff",
    type: "single",
  });
  const conversationId = conversation.json().id;
  const bound = await harness.client.post(
    `/conversations/${conversationId}/workspace`,
    { rootPath: harness.workspacePath },
  );
  const workspaceId = bound.json().id;

  fs.mkdirSync(path.join(harness.workspacePath, "src"), { recursive: true });
  fs.writeFileSync(path.join(harness.workspacePath, "src", "new.ts"), "new\n");

  const response = await harness.client.get(
    `/workspaces/${workspaceId}/file-changes`,
  );

  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(expect.objectContaining({
    workspaceId,
    baseRef: "HEAD",
    files: [expect.objectContaining({
      filePath: "src/new.ts",
      changeType: "create",
      newContent: "new\n",
    })],
    summary: expect.objectContaining({ files: 1 }),
  }));
});

it("returns 404 for an unknown workspace", async () => {
  const harness = await createTestHarness();
  harnesses.push(harness);
  const response = await harness.client.get(
    "/workspaces/missing/file-changes",
  );
  expect(response.statusCode).toBe(404);
});
```

Add assertions for edited and deleted files. Represent a rename as one delete plus one create by using `git diff --no-renames`; this keeps the existing `FileChange.changeType` contract intact.

- [ ] **Step 2: Run the test and verify the route is missing**

Run:

```bash
cd server
npm test -- --run tests/workspace-artifacts.test.ts
```

Expected: FAIL because `GET /workspaces/:workspaceId/file-changes` returns 404.

- [ ] **Step 3: Add the response contracts**

Add to `server/src/shared/types.ts`:

```ts
export interface ProjectFileChange extends FileChange {
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface WorkspaceDiffResponse {
  workspaceId: string;
  baseRef: "HEAD";
  files: ProjectFileChange[];
  summary: {
    files: number;
    additions: number;
    deletions: number;
  };
}
```

- [ ] **Step 4: Implement `WorkspaceDiffService`**

Use `execFileSync("git", args, { cwd })`, never interpolate the workspace path into a shell command. Resolve the workspace from `WorkspacesService`, validate that the persisted root exists, use `git diff --name-status --no-renames HEAD` for tracked files and `git ls-files --others --exclude-standard` for untracked files, reuse `loadIgnorePatterns` and `filterRelativePaths`, and reject paths escaping the workspace root.

The public API is:

```ts
export class WorkspaceDiffService {
  constructor(private readonly workspacesService: WorkspacesService) {}

  getFileChanges(workspaceId: string): WorkspaceDiffResponse {
    const workspace = this.workspacesService.getById(workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const root = path.resolve(workspace.root_path);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error("Workspace path is invalid");
    }
    this.runGit(root, ["rev-parse", "--verify", "HEAD"]);

    const files = this.collectChanges(root);
    return {
      workspaceId,
      baseRef: "HEAD",
      files,
      summary: files.reduce(
        (sum, file) => ({
          files: sum.files + 1,
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { files: 0, additions: 0, deletions: 0 },
      ),
    };
  }
}
```

For tracked files, read old content with `git show HEAD:src/example.ts` using the actual relative file path and read new content from disk. For untracked files, use empty old content. Mark files containing NUL bytes as binary and return empty textual content for the binary side. Count additions and deletions with `git diff --numstat HEAD -- src/example.ts`, substituting the actual relative file path; for untracked files count non-empty new lines.

- [ ] **Step 5: Register the route and service**

Change `createWorkspacesRouter` to receive `workspaceDiffService`, then add:

```ts
router.get("/workspaces/:workspaceId/file-changes", (req, res) => {
  try {
    res.json(workspaceDiffService.getFileChanges(req.params.workspaceId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load workspace changes";
    const status = /not found/i.test(message) ? 404 : /git|workspace path/i.test(message) ? 400 : 500;
    res.status(status).json({ detail: message });
  }
});
```

Instantiate `WorkspaceDiffService` in `server/src/app.ts`, expose it through `app.locals`, and pass it to `createWorkspacesRouter`.

- [ ] **Step 6: Run the workspace artifact tests**

Run:

```bash
cd server
npm test -- --run tests/workspace-artifacts.test.ts
```

Expected: PASS for create, edit, delete, rename-as-delete-plus-create, untracked, ignored, binary, missing workspace, invalid path, and clean workspace cases.

- [ ] **Step 7: Commit the workspace Diff slice**

```bash
git add server/src/shared/types.ts server/src/modules/workspaces/workspace-diff.service.ts server/src/modules/workspaces/workspaces.routes.ts server/src/app.ts server/tests/workspace-artifacts.test.ts
git commit -m "feat: add workspace-level project diff"
```

### Task 2: Add workspace preview lifecycle

**Files:**
- Modify: `server/src/modules/preview/preview.service.ts`
- Modify: `server/src/modules/preview/preview.routes.ts`
- Modify: `server/tests/preview.test.ts`

- [ ] **Step 1: Write failing service and route tests**

Add a test that binds a workspace with a `dev` script, calls the workspace route, and asserts the child process working directory is the base workspace rather than a run workspace:

```ts
it("starts and reuses one preview per workspace", async () => {
  const first = await previewService.startPreviewForWorkspace("ws-1");
  const second = await previewService.startPreviewForWorkspace("ws-1");

  expect(first).toEqual(second);
  expect(spawnProcessMock).toHaveBeenCalledTimes(1);
  expect(spawnProcessMock.mock.calls[0][2].cwd).toBe(workspacePath);
});
```

Add route coverage for `POST /workspaces/:workspaceId/preview/start`, `POST /workspaces/:workspaceId/preview/stop`, and unknown workspace errors.

- [ ] **Step 2: Run the preview tests and verify failure**

```bash
cd server
npm test -- --run tests/preview.test.ts
```

Expected: FAIL because `startPreviewForWorkspace` and the workspace routes do not exist.

- [ ] **Step 3: Refactor preview storage to use a target key**

Change the internal record to:

```ts
interface PreviewRecord {
  targetKey: string;
  workspaceId: string;
  port: number;
  url: string;
  process: ChildProcess;
  workspacePath: string;
  startedAt: string;
}
```

Extract the existing spawn and readiness logic into:

```ts
private async startPreview(
  targetKey: string,
  workspaceId: string,
  workspacePath: string,
): Promise<PreviewStartResponse>;
```

Keep `startPreviewForRun(runId)` by resolving its current workspace path and calling the helper with `run:${runId}`. Add:

```ts
async startPreviewForWorkspace(workspaceId: string): Promise<PreviewStartResponse> {
  const workspace = this.workspacesService.getById(workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  const workspacePath = path.resolve(workspace.root_path);
  if (!fileExists(workspacePath) || !isDirectory(workspacePath)) {
    throw new Error("Workspace path is invalid");
  }
  return this.startPreview(`workspace:${workspaceId}`, workspaceId, workspacePath);
}

async stopPreviewForWorkspace(workspaceId: string): Promise<{ ok: true }> {
  return this.stopPreview(`workspace:${workspaceId}`);
}
```

- [ ] **Step 4: Add workspace preview routes**

```ts
router.post("/workspaces/:workspaceId/preview/start", async (req, res) => {
  try {
    res.json(await previewService.startPreviewForWorkspace(req.params.workspaceId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start preview";
    res.status(/not found/i.test(message) ? 404 : /workspace|previewed|ports available|invalid/i.test(message) ? 400 : 500)
      .json({ detail: message });
  }
});

router.post("/workspaces/:workspaceId/preview/stop", async (req, res) => {
  try {
    res.json(await previewService.stopPreviewForWorkspace(req.params.workspaceId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop preview";
    res.status(500).json({ detail: message });
  }
});
```

- [ ] **Step 5: Run preview tests**

```bash
cd server
npm test -- --run tests/preview.test.ts
```

Expected: PASS for both existing run preview behavior and new workspace preview behavior.

- [ ] **Step 6: Commit the preview slice**

```bash
git add server/src/modules/preview/preview.service.ts server/src/modules/preview/preview.routes.ts server/tests/preview.test.ts
git commit -m "feat: preview bound workspaces"
```

### Task 3: Add workspace deployment lifecycle

**Files:**
- Modify: `server/src/shared/types.ts`
- Modify: `server/src/modules/deploy/deploy.service.ts`
- Modify: `server/src/modules/deploy/deploy.routes.ts`
- Modify: `server/tests/deploy.test.ts`

- [ ] **Step 1: Write failing workspace deployment tests**

```ts
it("runs deployment from the bound workspace", () => {
  const scripts = deployService.getScriptsForWorkspace("ws-1");
  const deploy = deployService.startDeployForWorkspace("ws-1", "build");

  expect(scripts).toEqual({
    workspaceId: "ws-1",
    scripts: ["build"],
    defaultScript: "build",
  });
  expect(deploy.workspaceId).toBe("ws-1");
  expect(spawnProcessMock.mock.calls[0][2].cwd).toBe(workspacePath);
});

it("does not start a second concurrent deploy for one workspace", () => {
  deployService.startDeployForWorkspace("ws-1", "build");
  deployService.startDeployForWorkspace("ws-1", "build");
  expect(spawnProcessMock).toHaveBeenCalledTimes(1);
});
```

Add API coverage for scripts, start, status, missing workspace, missing scripts, and invalid requested script.

- [ ] **Step 2: Run deploy tests and verify failure**

```bash
cd server
npm test -- --run tests/deploy.test.ts
```

Expected: FAIL because workspace deploy methods and routes do not exist.

- [ ] **Step 3: Add workspace deploy contracts**

```ts
export interface WorkspaceDeployScriptsResponse {
  workspaceId: string;
  scripts: string[];
  defaultScript: string | null;
}

export type WorkspaceDeployRecord = Omit<DeployRecord, "runId"> & {
  workspaceId: string;
};
```

- [ ] **Step 4: Add workspace methods without removing run compatibility**

Key workspace deploy records by `workspace:${workspaceId}`. Add:

```ts
getScriptsForWorkspace(workspaceId: string): WorkspaceDeployScriptsResponse;
startDeployForWorkspace(workspaceId: string, script?: string): WorkspaceDeployRecord;
getDeployForWorkspace(workspaceId: string): WorkspaceDeployRecord | null;
```

Resolve the workspace only through `workspacesService.getById(workspaceId)`, call `path.resolve` on the persisted root, validate it with `isDirectory`, and pass that directory as `cwd`. Reuse the existing script selection, process logging, exit status, and cleanup code through private target-key helpers.

- [ ] **Step 5: Add workspace deployment routes**

Add these handlers beside the run routes:

```ts
router.get("/workspaces/:workspaceId/deploy/scripts", (req, res) => {
  try {
    res.json(deployService.getScriptsForWorkspace(req.params.workspaceId));
  } catch (error) {
    respondDeployError(res, error, "Failed to load deploy scripts");
  }
});

router.post("/workspaces/:workspaceId/deploy/start", (req, res) => {
  try {
    const script = typeof req.body?.script === "string" ? req.body.script : undefined;
    res.json(deployService.startDeployForWorkspace(req.params.workspaceId, script));
  } catch (error) {
    respondDeployError(res, error, "Failed to start deploy");
  }
});

router.get("/workspaces/:workspaceId/deploy", (req, res) => {
  try {
    res.json(deployService.getDeployForWorkspace(req.params.workspaceId));
  } catch (error) {
    respondDeployError(res, error, "Failed to load deploy");
  }
});
```

Define the shared route error helper in the same file:

```ts
function respondDeployError(res: Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = /not found/i.test(message)
    ? 404
    : /workspace|package|script/i.test(message)
      ? 400
      : 500;
  res.status(status).json({ detail: message });
}
```

- [ ] **Step 6: Run deploy tests**

```bash
cd server
npm test -- --run tests/deploy.test.ts
```

Expected: PASS for existing run routes and new workspace routes.

- [ ] **Step 7: Commit the deployment slice**

```bash
git add server/src/shared/types.ts server/src/modules/deploy/deploy.service.ts server/src/modules/deploy/deploy.routes.ts server/tests/deploy.test.ts
git commit -m "feat: deploy bound workspaces"
```

### Task 4: Add frontend workspace artifact API contracts

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/services/api.test.ts`

- [ ] **Step 1: Write failing API path tests**

Stub `fetch` and assert every project operation uses `workspaceId`, not `runId`:

```ts
it("calls workspace artifact endpoints", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  vi.stubGlobal("fetch", fetchMock);

  await api.getWorkspaceFileChanges("ws-1");
  await api.startWorkspacePreview("ws-1");
  await api.stopWorkspacePreview("ws-1");
  await api.getWorkspaceDeployScripts("ws-1");
  await api.startWorkspaceDeploy("ws-1", "build");
  await api.getWorkspaceDeploy("ws-1");

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    expect.stringEndingWith("/workspaces/ws-1/file-changes"),
    expect.stringEndingWith("/workspaces/ws-1/preview/start"),
    expect.stringEndingWith("/workspaces/ws-1/preview/stop"),
    expect.stringEndingWith("/workspaces/ws-1/deploy/scripts"),
    expect.stringEndingWith("/workspaces/ws-1/deploy/start"),
    expect.stringEndingWith("/workspaces/ws-1/deploy"),
  ]);
});
```

- [ ] **Step 2: Run the API test and verify failure**

```bash
cd frontend
npm test -- --run src/services/api.test.ts
```

Expected: FAIL because the workspace methods do not exist.

- [ ] **Step 3: Mirror the server types**

Add `ProjectFileChange`, `WorkspaceDiffResponse`, `WorkspaceDeployScriptsResponse`, and `WorkspaceDeployRecord` to `frontend/src/types/index.ts` with fields identical to the server contracts from Tasks 1 and 3.

- [ ] **Step 4: Add the API methods**

```ts
async getWorkspaceFileChanges(workspaceId: string): Promise<WorkspaceDiffResponse> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/file-changes`));
},

async startWorkspacePreview(workspaceId: string): Promise<PreviewStartResponse> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/preview/start`, { method: "POST" }));
},

async stopWorkspacePreview(workspaceId: string): Promise<{ ok: true }> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/preview/stop`, { method: "POST" }));
},

async getWorkspaceDeployScripts(workspaceId: string): Promise<WorkspaceDeployScriptsResponse> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy/scripts`));
},

async startWorkspaceDeploy(workspaceId: string, script?: string): Promise<WorkspaceDeployRecord> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
  }));
},

async getWorkspaceDeploy(workspaceId: string): Promise<WorkspaceDeployRecord | null> {
  return handleResponse(await fetch(`${BASE_URL}/workspaces/${workspaceId}/deploy`));
},
```

- [ ] **Step 5: Run the API tests**

```bash
cd frontend
npm test -- --run src/services/api.test.ts
```

Expected: PASS with six workspace-scoped requests and no run-scoped request.

- [ ] **Step 6: Commit the frontend contracts**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/services/api.test.ts
git commit -m "feat: add project artifact api client"
```

### Task 5: Build the project artifact panel

**Files:**
- Create: `frontend/src/hooks/useProjectDiff.ts`
- Create: `frontend/src/components/ProjectArtifactPanel/index.tsx`
- Create: `frontend/src/components/ProjectArtifactPanel/ProjectDiffView.tsx`
- Create: `frontend/src/components/ProjectArtifactPanel/ProjectPreviewView.tsx`
- Create: `frontend/src/components/ProjectArtifactPanel/ProjectDeployView.tsx`
- Create: `frontend/src/components/ProjectArtifactPanel/index.test.tsx`
- Reuse: `frontend/src/components/DiffCard/index.tsx`

- [ ] **Step 1: Write failing project panel tests**

Cover these behaviors in focused tests:

```ts
const workspace: Workspace = {
  id: "ws-1",
  conversation_id: "conv-1",
  root_path: "/tmp/project",
  mode: "direct",
  created_at: "2026-06-20T00:00:00.000Z",
  updated_at: "2026-06-20T00:00:00.000Z",
};

it("loads the whole workspace diff and selects the first file", async () => {
  render(<ProjectArtifactPanel open activeTab="diff" workspace={workspace} onClose={vi.fn()} />);
  await waitFor(() => expect(api.getWorkspaceFileChanges).toHaveBeenCalledWith("ws-1"));
  expect(screen.getByText("整个项目")).toBeTruthy();
  expect(screen.getByText("当前工作区 vs HEAD")).toBeTruthy();
  expect(screen.getByText("src/App.tsx")).toBeTruthy();
  expect(screen.getByText("+ after")).toBeTruthy();
});

it("starts preview and deploy with the workspace id", async () => {
  const { rerender } = render(
    <ProjectArtifactPanel open activeTab="preview" workspace={workspace} onClose={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "启动预览" }));
  await waitFor(() => expect(api.startWorkspacePreview).toHaveBeenCalledWith("ws-1"));

  rerender(<ProjectArtifactPanel open activeTab="deploy" workspace={workspace} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "部署" }));
  await waitFor(() => expect(api.startWorkspaceDeploy).toHaveBeenCalledWith("ws-1", "build"));
});
```

Also test clean workspace text, API error with retry, binary file metadata, and large Diff loading.

- [ ] **Step 2: Run the tests and verify failure**

```bash
cd frontend
npm test -- --run src/components/ProjectArtifactPanel/index.test.tsx
```

Expected: FAIL because the component files do not exist.

- [ ] **Step 3: Implement the workspace Diff hook**

```ts
interface ProjectDiffState {
  data: WorkspaceDiffResponse | null;
  loading: boolean;
  error: string | null;
}

export function useProjectDiff(workspaceId: string | null, revision = 0) {
  const [state, setState] = useState<ProjectDiffState>({
    data: null,
    loading: false,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!workspaceId) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await api.getWorkspaceFileChanges(workspaceId);
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "加载项目 Diff 失败",
      });
    }
  }, [workspaceId]);

  useEffect(() => { void reload(); }, [reload, revision]);
  return { ...state, reload };
}
```

- [ ] **Step 4: Implement the resizable project shell**

Use `ProjectArtifactTab = "diff" | "preview" | "deploy"`, default width 620 px, minimum 480 px, maximum 960 px. The header always shows the workspace path and `整个项目`. Do not accept or derive a run identifier.

```ts
interface ProjectArtifactPanelProps {
  open: boolean;
  activeTab: ProjectArtifactTab;
  workspace: Workspace;
  revision?: number;
  width?: number;
  onClose: () => void;
  onWidthChange?: (width: number) => void;
}
```

- [ ] **Step 5: Implement the three focused views**

`ProjectDiffView` renders the summary, a 220 px file list, and one selected `FileDiffBlock`. Its empty message is exactly `当前项目没有未提交的代码改动`.

`ProjectPreviewView` calls `startWorkspacePreview` and `stopWorkspacePreview`, displays the URL and an iframe titled `Project preview`, and never accepts a run identifier.

`ProjectDeployView` loads `getWorkspaceDeployScripts` and `getWorkspaceDeploy`, keeps the selected script in local state, starts deployment with `startWorkspaceDeploy`, and polls status every second only while status is `running`.

- [ ] **Step 6: Run project panel tests**

```bash
cd frontend
npm test -- --run src/components/ProjectArtifactPanel/index.test.tsx
```

Expected: PASS for Diff, preview, deploy, empty, loading, error, retry, binary, and large-file cases.

- [ ] **Step 7: Commit the project panel**

```bash
git add frontend/src/hooks/useProjectDiff.ts frontend/src/components/ProjectArtifactPanel
git commit -m "feat: add project artifact panel"
```

### Task 6: Make task cards open only work logs

**Files:**
- Create: `frontend/src/components/TaskWorkLogPanel/index.tsx`
- Create: `frontend/src/components/TaskWorkLogPanel/index.test.tsx`
- Modify: `frontend/src/components/PlanCard/index.tsx`
- Modify: `frontend/src/components/PlanCard/index.test.tsx`
- Reuse: `frontend/src/components/RunLogPanel/index.tsx`

- [ ] **Step 1: Write failing task-click tests**

```ts
const completedRun: ChatTimelineItem = {
  id: "run-1",
  conversationId: "conv-1",
  runId: "run-1",
  taskId: "task-1",
  agentId: "agent-1",
  agentName: "builder",
  agentSessionId: null,
  prompt: "Create GET /health endpoint",
  status: "completed",
  startedAt: "2026-06-20T00:00:00.000Z",
  finishedAt: "2026-06-20T00:01:00.000Z",
  blocks: [],
  error: null,
};

const completedPlan = makePlan({
  items: [{
    index: 1,
    title: "Create GET /health endpoint",
    description: "Create the health endpoint",
    assignedAgentId: "agent-1",
    assignedAgentName: "builder",
    taskId: "task-1",
    assignmentId: "assignment-1",
    runId: "run-1",
    status: "completed",
    dependsOn: [],
  }],
});

it("opens work logs when a completed task card is clicked", () => {
  const onOpenWorkLog = vi.fn();
  render(<PlanCard plan={completedPlan} timeline={[completedRun]} onOpenWorkLog={onOpenWorkLog} />);
  fireEvent.click(screen.getByText("Create GET /health endpoint"));
  expect(onOpenWorkLog).toHaveBeenCalledWith("run-1");
});

it("does not expose task-level diff, preview, or deploy actions", () => {
  render(<PlanCard plan={completedPlan} timeline={[completedRun]} onOpenWorkLog={vi.fn()} />);
  expect(screen.queryByText("查看 Diff")).toBeNull();
  expect(screen.queryByText("网页预览")).toBeNull();
  expect(screen.queryByText("部署")).toBeNull();
});
```

Add a `TaskWorkLogPanel` test that verifies `api.getRun(runId)` may be called but no workspace or run artifact API is called.

- [ ] **Step 2: Run the tests and verify failure**

```bash
cd frontend
npm test -- --run src/components/PlanCard/index.test.tsx src/components/TaskWorkLogPanel/index.test.tsx
```

Expected: FAIL because `onOpenWorkLog` and `TaskWorkLogPanel` do not exist.

- [ ] **Step 3: Replace `onOpenDiff` with `onOpenWorkLog`**

Update `PlanCard` and `TaskKanbanCard` props:

```ts
onOpenWorkLog?: (runId: string) => void;
```

Every task card with `runData` gets:

```ts
const handleClick = runData && onOpenWorkLog
  ? () => onOpenWorkLog(runData.run.runId)
  : undefined;
```

Keep pending cards without a run non-interactive. Do not add a fallback that chooses another run.

- [ ] **Step 4: Implement `TaskWorkLogPanel`**

Create a resizable drawer with a task-scoped header and `RunLogPanel` body:

```tsx
export function TaskWorkLogPanel({
  open,
  item,
  taskTitle,
  onClose,
  onInterrupt,
}: TaskWorkLogPanelProps) {
  if (!open) return null;
  return (
    <aside aria-label="工作日志" className="absolute inset-y-0 right-0 z-20 flex w-[420px] flex-col bg-white">
      <header>
        <div className="text-sm font-medium">{taskTitle}</div>
        <div className="text-xs text-[var(--app-text-secondary)]">
          @{item?.agentName ?? "Agent"} · {item?.status ?? "waiting"}
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <RunLogPanel
        item={item}
        isActive={item?.status === "queued" || item?.status === "running"}
        onInterrupt={onInterrupt}
      />
    </aside>
  );
}
```

- [ ] **Step 5: Run task-log tests**

```bash
cd frontend
npm test -- --run src/components/PlanCard/index.test.tsx src/components/TaskWorkLogPanel/index.test.tsx src/components/RunLogPanel/index.test.tsx
```

Expected: PASS and no artifact API call from task selection.

- [ ] **Step 6: Commit the task-log slice**

```bash
git add frontend/src/components/PlanCard frontend/src/components/TaskWorkLogPanel frontend/src/components/RunLogPanel
git commit -m "feat: open work logs from task cards"
```

### Task 7: Refresh project artifacts after merges

**Files:**
- Modify: `server/src/shared/types.ts`
- Modify: `server/src/modules/merge/merge.types.ts`
- Modify: `server/src/modules/merge/merge.service.ts`
- Modify: `server/src/sockets/socket-server.ts`
- Modify: `server/src/app.ts`
- Modify: `server/tests/merge.service.test.ts`
- Modify: `server/tests/socket.test.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/socket.ts`
- Modify: `frontend/src/store/appState.ts`
- Modify: `frontend/src/store/AppContext.tsx`
- Modify: `frontend/src/store/AppContext.test.ts`

- [ ] **Step 1: Write failing merge notification tests**

Assert that a successful merge produces one workspace event and a conflict does not:

```ts
expect(onWorkspaceChanged).toHaveBeenCalledWith({
  type: "workspace_changed",
  conversationId: "conv-1",
  workspaceId: "ws-1",
  reason: "merge_completed",
});
```

Add a reducer/context test that receiving the event increments only `workspaceRevisionById["ws-1"]`.

- [ ] **Step 2: Run focused event tests and verify failure**

```bash
cd server
npm test -- --run tests/merge.service.test.ts tests/socket.test.ts
cd ../frontend
npm test -- --run src/store/AppContext.test.ts
```

Expected: FAIL because `workspace_changed` is not defined or emitted.

- [ ] **Step 3: Add the cross-layer event contract**

Add identical server and frontend types:

```ts
export interface WorkspaceChangedEvent {
  type: "workspace_changed";
  conversationId: string;
  workspaceId: string;
  reason: "merge_completed";
}
```

- [ ] **Step 4: Emit only after successful base-workspace mutation**

Extend `MergeServiceDeps`:

```ts
onWorkspaceChanged?: (event: WorkspaceChangedEvent) => void;
```

After `mergeRunToMain` or `resolveConflicts` persists a `merged` result, call the callback with the run's conversation and workspace identifiers. Do not emit for `needs_approval` or failed merges.

Add to `RealtimeServer`:

```ts
emitWorkspaceChanged(event: WorkspaceChangedEvent): void {
  this.io.to(conversationRoom(event.conversationId)).emit(event.type, event);
}
```

Wire the merge dependency in `server/src/app.ts` through a closure that calls `realtimeServer.emitWorkspaceChanged(event)` after the realtime server has been initialized.

- [ ] **Step 5: Receive and reduce the revision**

Add `onWorkspaceChanged` to `SocketEventHandler`, register the socket event, and add an action:

```ts
| { type: "BUMP_WORKSPACE_REVISION"; payload: { workspaceId: string } }
```

The reducer returns:

```ts
workspaceRevisionById: {
  ...state.workspaceRevisionById,
  [action.payload.workspaceId]:
    (state.workspaceRevisionById[action.payload.workspaceId] ?? 0) + 1,
},
```

`AppContext` dispatches the action from `onWorkspaceChanged`.

- [ ] **Step 6: Run merge and frontend state tests**

```bash
cd server
npm test -- --run tests/merge.service.test.ts tests/socket.test.ts
cd ../frontend
npm test -- --run src/store/AppContext.test.ts
```

Expected: PASS with one refresh signal per successful merge.

- [ ] **Step 7: Commit the refresh slice**

```bash
git add server/src/shared/types.ts server/src/modules/merge server/src/sockets/socket-server.ts server/src/app.ts server/tests/merge.service.test.ts server/tests/socket.test.ts frontend/src/types/index.ts frontend/src/services/socket.ts frontend/src/store
git commit -m "feat: refresh project artifacts after merge"
```

### Task 8: Integrate independent task and project panels

**Files:**
- Modify: `frontend/src/components/TopBar/index.tsx`
- Modify: `frontend/src/components/TopBar/index.test.tsx`
- Modify: `frontend/src/components/ChatArea/index.tsx`
- Modify: `frontend/src/components/ChatArea/index.test.tsx`
- Remove: `frontend/src/components/ArtifactPanel/index.tsx`
- Remove: `frontend/src/components/ArtifactPanel/index.test.tsx`

- [ ] **Step 1: Write failing integration tests**

```ts
it("keeps project artifacts bound to the workspace when task selection changes", async () => {
  const run = makeRunItem("run-1");
  const plan: PlanCardModel = {
    id: "plan-1",
    conversationId: "conv-1",
    prompt: "Create a health endpoint",
    summary: "One task",
    createdAt: "2026-06-20T00:00:00.000Z",
    items: [{
      index: 1,
      title: "Create GET /health endpoint",
      description: "Create the health endpoint",
      assignedAgentId: run.agentId,
      assignedAgentName: run.agentName ?? "builder",
      taskId: "task-1",
      assignmentId: "assignment-1",
      runId: run.runId,
      status: "completed",
      dependsOn: [],
    }],
  };
  renderChatArea({
    agents,
    timeline: { "conv-1": [run] },
    plansByConversation: { "conv-1": [plan] },
  });
  fireEvent.click(screen.getByRole("button", { name: "代码改动" }));
  await waitFor(() => expect(api.getWorkspaceFileChanges).toHaveBeenCalledWith("ws-1"));

  fireEvent.click(screen.getByText("Create GET /health endpoint"));
  expect(screen.getByRole("complementary", { name: "工作日志" })).toBeTruthy();
  expect(api.getWorkspaceFileChanges).toHaveBeenLastCalledWith("ws-1");
  expect(api.getRunFileChanges).not.toHaveBeenCalled();
});

it("routes all top controls to project tabs", () => {
  const onOpenProjectArtifact = vi.fn();
  render(<TopBar onOpenProjectArtifact={onOpenProjectArtifact} projectFileCount={3} />);
  fireEvent.click(screen.getByRole("button", { name: /代码改动/ }));
  fireEvent.click(screen.getByRole("button", { name: "网页预览" }));
  fireEvent.click(screen.getByRole("button", { name: "部署" }));
  expect(onOpenProjectArtifact.mock.calls).toEqual([["diff"], ["preview"], ["deploy"]]);
});
```

Add a test that a workspace revision refreshes the badge and an open Diff panel without changing the selected task log.

- [ ] **Step 2: Run the integration tests and verify failure**

```bash
cd frontend
npm test -- --run src/components/TopBar/index.test.tsx src/components/ChatArea/index.test.tsx
```

Expected: FAIL because `TopBar` still maps deploy to `logs` and `ChatArea` still uses one mixed panel state.

- [ ] **Step 3: Give `TopBar` project-only semantics**

Replace the artifact type with:

```ts
export type ProjectArtifactTab = "diff" | "preview" | "deploy";
```

Use props:

```ts
interface TopBarProps {
  onOpenProjectArtifact: (tab: ProjectArtifactTab) => void;
  projectPanelOpen?: boolean;
  activeProjectTab?: ProjectArtifactTab;
  projectFileCount?: number;
}
```

Render `代码改动 ${projectFileCount}` only when the count is positive. Keep the compact 8 px corners and 0.5 px borders already approved.

- [ ] **Step 4: Split `ChatArea` state**

Use independent state:

```ts
const [selectedLogRunId, setSelectedLogRunId] = useState<string | null>(null);
const [projectPanelOpen, setProjectPanelOpen] = useState(false);
const [projectTab, setProjectTab] = useState<ProjectArtifactTab>("diff");
const [projectPanelWidth, setProjectPanelWidth] = useState(620);
```

Task selection sets only `selectedLogRunId`. Top-toolbar selection sets only `projectPanelOpen` and `projectTab`. Opening one drawer may close the other for screen-space clarity, but it must not erase or retarget the other drawer's selection.

Resolve `selectedLogItem` from the timeline by `selectedLogRunId`. Pass `workspace.id` and `workspaceRevisionById[workspace.id]` to the project panel. Pass the Diff summary count to `TopBar`.

- [ ] **Step 5: Remove the mixed panel**

Delete the old `ArtifactPanel` and its tests after `ChatArea` imports `TaskWorkLogPanel` and `ProjectArtifactPanel`. Remove `selectedArtifactRunId`, `getSelectedRunId`, `BottomConsole`, and any run-derived Diff/preview/deploy fallback.

Keep the old run-scoped API client methods because server compatibility remains intentional; there must be no top-toolbar call site for them.

- [ ] **Step 6: Run the frontend integration tests**

```bash
cd frontend
npm test -- --run src/components/TopBar/index.test.tsx src/components/PlanCard/index.test.tsx src/components/TaskWorkLogPanel/index.test.tsx src/components/ProjectArtifactPanel/index.test.tsx src/components/ChatArea/index.test.tsx
```

Expected: PASS with task clicks loading logs and top controls loading only workspace artifacts.

- [ ] **Step 7: Commit the integration slice**

```bash
git add frontend/src/components/TopBar frontend/src/components/ChatArea frontend/src/components/PlanCard frontend/src/components/TaskWorkLogPanel frontend/src/components/ProjectArtifactPanel frontend/src/components/ArtifactPanel
git commit -m "feat: separate task logs from project artifacts"
```

### Task 9: Run full verification and manual acceptance

**Files:**
- Modify only files required to fix regressions introduced by Tasks 1 through 8.

- [ ] **Step 1: Run server tests and build**

```bash
cd server
npm test
npm run build
```

Expected: all server tests pass and TypeScript exits with code 0.

- [ ] **Step 2: Run frontend tests, lint, and build**

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all frontend tests pass, ESLint exits with code 0, and Vite production build completes.

- [ ] **Step 3: Verify the user flow in the in-app browser**

At `http://localhost:5173/`:

1. Open a conversation with a bound Git workspace.
2. Click a completed task and verify only the work-log panel opens.
3. Click `代码改动` and verify the panel says `整个项目` and `当前工作区 vs HEAD`.
4. Select a different task and verify the project Diff target remains the same workspace.
5. Start preview and verify the iframe loads the bound project.
6. Start deployment and verify the displayed command runs from the bound workspace.
7. Complete and merge another task and verify the toolbar file count and open Diff refresh.

- [ ] **Step 4: Inspect the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only planned files remain changed.

- [ ] **Step 5: Commit verification fixes, if any**

If Step 1 or Step 2 required an in-scope correction, stage only tracked modifications under the planned source and test directories:

```bash
git add -u server/src server/tests frontend/src
git commit -m "fix: complete project artifact verification"
```

If no correction was required, do not create an empty commit.
