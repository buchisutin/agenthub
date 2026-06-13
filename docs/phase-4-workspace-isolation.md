# Phase 4.1: Workspace / Worktree Isolation

## 为什么需要 Run Workspace 隔离

AgentHub 支持多 Agent 并行执行（fan-out、orchestrator 等），每个 run 可以在相同 conversation workspace 上操作文件。Phase 4.1 之前，所有 run 共享同一个目录：

- 多个 Agent 同时修改同名文件时会互相覆盖
- Diff / Preview 基于共享目录，无法准确区分哪个 run 改了什么
- rerun task 新旧 run 读写同一个目录，旧 run 的文件状态会污染新 run

Phase 4.1 的目标：每个 run 拥有独立的 execution workspace，彻底隔离多 Agent 并发写入。

---

## 数据模型

新增 `run_workspaces` 表，每个 run 创建时写入一条记录：

| 字段 | 说明 |
|------|------|
| `id` | UUID |
| `run_id` | 关联 `agent_runs.id` |
| `conversation_id` | 关联 `conversations.id` |
| `base_workspace_id` | 关联 `workspaces.id`（原始 conversation workspace）|
| `mode` | `git_worktree` 或 `git_clone` |
| `root_path` | run 的独立执行目录 |
| `branch_name` | git worktree 模式下创建的分支名 |
| `base_ref` | worktree 基于的 commit SHA |
| `status` | `creating` / `ready` / `failed` / `cleaned` |
| `error_message` | 创建失败原因 |

---

## git_worktree 模式

当 base workspace 是一个 git 仓库时（通过 `git rev-parse --show-toplevel` 判断），优先使用 git worktree：

1. 分支命名规则：`agenthub/<runId前8位>`（若已存在则追加时间戳）
2. worktree 路径：`<baseRootPath>/.agenthub/worktrees/<runId>`
3. 执行 `git worktree add -b <branch> <path> HEAD`
4. run 的所有文件修改都在该 worktree 中进行，不影响主工作树

好处：
- 文件隔离彻底
- 保留完整 git 历史，未来可对比/合并
- 磁盘占用相对较小（硬链接共享 .git/objects）

---

## non-git workspace

新 run 不再支持 copy fallback。

- 如果 base workspace 不是 git 仓库，run workspace 创建会直接失败
- workspace 应在绑定阶段完成 git 初始化与基线提交
- 历史 `copy` 记录仍保留读取与清理兼容

---

## Diff 如何基于 run workspace

`GET /runs/:runId/file-changes` 流程：

1. 先查询 `run_workspaces` 表中 status=ready 的记录
2. 如果存在且路径在磁盘上有效（目录存在），使用 `run_workspace.root_path` 作为 workspace 路径
3. 否则 fallback 到原始 `workspaces.root_path`（兼容旧 run）

这意味着：两个 run 修改了同名文件，各自的 `/file-changes` 接口返回各自 workspace 的内容，互不干扰。

---

## Preview 如何基于 run workspace

`POST /runs/:runId/preview/start` 流程：

1. 先查 `run_workspaces`，若 status=ready 且目录存在，用 run workspace 启动 preview 进程
2. 否则 fallback 到原始 workspace

preview 仍按 runId 注册，多个 run 各自启动独立 preview 进程，各自监听不同端口（3100-3199）。

---

## runtime cwd 改造

`RunManager.createRun` 流程（Phase 4.1 后）：

1. 创建 `agent_runs` 记录（status=queued）
2. 调用 `WorkspaceIsolationService.createForRun` 创建独立 workspace
   - 成功：用 `run_workspace.root_path` 作为 runtime 的 cwd
   - 失败（status=failed）：将 run 标记为 failed，不启动 runtime
3. 调用 `runtime.startRun({ workspacePath: run_workspace.root_path, ... })`

如果 `workspaceIsolationService` 未注入（例如旧版测试），RunManager 直接用 base workspace 路径，行为与 Phase 3 一致。

---

## API

### GET /runs/:runId/workspace

返回 run 的 workspace 信息：

```json
{
  "mode": "git_worktree" | "git_clone" | "legacy",
  "rootPath": "/path/to/run/workspace",
  "branchName": "agenthub/abc12345",
  "status": "ready",
  "errorMessage": null
}
```

- `legacy`：run 没有 run_workspace 记录（旧数据兼容）
- `status=failed`：run workspace creation failed

---

## 前端 RunCard

RunCard header 显示 workspace 模式 badge：

- `git_worktree` 模式：蓝色 badge，显示 `worktree:<branch短名>`
- `git_clone` 模式：紫色 badge，显示 `clone:<branch短名>`
- `legacy` 模式：灰色 badge，显示 `legacy`

`api.getRunWorkspace(runId)` 失败时，badge 不显示，不影响主流程。

---

## Phase 4.2: Workspace Lifecycle & Cleanup

### 手动清理

提供两种清理方式：

**单 run 清理**

`POST /runs/:runId/workspace/cleanup`

- 清理前检查：
  - run_workspace 必须存在
  - status 不能已是 cleaned
  - preview 不能正在运行（通过 `isPreviewRunning` 检查）
  - root_path 必须在 `.agenthub/worktrees`、`.agenthub/clones` 或历史 `.agenthub/copies` 下
- `git_worktree` 模式：执行 `git worktree remove --force <path>`
- `git_clone` 模式：递归删除 clone 目录
- 历史 `copy` 模式：递归删除 copy 目录
- 路径不存在时直接标记 cleaned（幂等）
- 成功后 `run_workspace.status` 设为 `cleaned`

**按 conversation 清理**

`POST /conversations/:conversationId/workspaces/cleanup`

- 找出该 conversation 下所有 run_workspaces
- 只清理已结束 run 的 workspace：`completed` / `failed` / `interrupted` / `cancelled`
- 跳过正在运行的 run（`running` / `queued`）
- 跳过有 active preview 的 run
- 返回 `{ cleaned: RunWorkspaceRecord[], skipped: Array<{ runId, reason }> }`

### 安全保护

- root_path 必须包含 `/.agenthub/worktrees/`、`/.agenthub/clones/` 或历史 `/.agenthub/copies/`
- 不允许删除 base workspace
- 不允许删除任意绝对路径
- active preview 存在时拒绝清理，返回 400
- running/queued run 的 workspace 不会被 conversation cleanup 触及

### cleaned 后 Diff / Preview 行为

| 操作 | cleaned 后行为 |
|------|---------------|
| `GET /runs/:runId/file-changes` | 返回 400：`Run workspace has been cleaned` |
| `POST /runs/:runId/preview/start` | 返回 400：`Run workspace has been cleaned` |

### 前端 UI

- `cleaned` 状态 workspace 在 RunCard 中显示红色 "cleaned" badge
- `ready` 状态 workspace 显示 "清理工作区" 按钮
- cleaned workspace 下不显示 Diff / Preview 按钮，改为显示 "工作区已清理，Diff / Preview 不可用"
- TopBar 提供 "清理完成的工作区" 按钮，点击后清理当前 conversation 所有结束 run 的工作区
- 清理结果通过浮动提示展示 cleaned / skipped 数量
- 清理失败时在对应 RunCard 显示错误信息

### 前端 API

```typescript
api.cleanupRunWorkspace(runId: string): Promise<RunWorkspace>
api.cleanupConversationWorkspaces(conversationId: string): Promise<{
  cleaned: RunWorkspace[],
  skipped: Array<{ runId: string, reason: string }>
}>
```

## Phase 4.3: Workspace Change Summary & Apply Back

### 数据模型

新增 `run_change_applications` 表：

| 字段 | 说明 |
|------|------|
| `id` | UUID |
| `run_id` | 关联 `agent_runs.id`（唯一约束） |
| `conversation_id` | 关联 `conversations.id` |
| `run_workspace_id` | 关联 `run_workspaces.id`（可为空） |
| `status` | `pending` / `applied` / `failed` / `skipped` |
| `applied_files_json` | 已应用文件列表 JSON 数组 |
| `skipped_files_json` | 跳过文件列表 JSON 数组 |
| `error_message` | 失败原因 |
| `applied_at` | 应用时间 |

### Apply Back 规则

`POST /runs/:runId/apply-changes` 流程：

1. 检查 run 是否存在且 status=completed
2. 检查 run_workspace 存在且未被 cleaned
3. 获取 base workspace root_path
4. 调用 `getFileChanges` 获取所有文件改动
5. 对每个 FileChange 进行安全检查和文件复制：
   - `create` / `edit`：从 run workspace 复制文件到 base workspace
   - `delete`：当前跳过（返回 skipped）
   - `unknown`：跳过
6. 写入 `run_change_applications` 记录
7. 状态：
   - `applied`：至少一个文件成功复制
   - `skipped`：无文件改动可应用
   - `failed`：所有文件都被跳过

### 安全策略

- filePath 不能是绝对路径
- filePath 不能包含 `../` 路径遍历
- source path（run workspace）和 target path（base workspace）均需路径解析后确认在各自根目录内
- 不能写入 `.agenthub` 目录
- source 文件不存在时跳过（而非崩溃）
- 文件逐个处理，单个文件失败不影响其他文件

### API

| 接口 | 说明 |
|------|------|
| `GET /runs/:runId/change-application` | 查询 run 的 apply 状态，返回 RunChangeApplication 或 null |
| `POST /runs/:runId/apply-changes` | 应用 run 的文件改动到 base workspace，幂等 |

### 前端 UI

- completed run 且 workspace ready 时显示 "Apply Changes" 按钮
- cleaned workspace 不显示 Apply Changes
- 已 applied 时显示绿色 "Applied" badge + 文件数量和 skipped 数量
- 已 skipped 时显示灰色 "No changes" badge
- 已 failed 时显示红色 "Apply failed" badge
- 点击 Apply Changes 后按钮变为禁用状态，成功/失败后更新状态
- apply 错误在 RunCard 中显示红色提示

## Phase 4.4: Apply Safety & Conflict Guard

### Dry-Run Check

`GET /runs/:runId/apply-check` 提供 apply 前的冲突检测，不修改任何文件。

返回 `ApplyCheckResult`:
```typescript
{
  runId: string;
  canApply: boolean;        // true if no conflicts
  files: ApplyCheckFile[];  // per-file status
  summary: {
    safe: number;           // can be applied safely
    conflict: number;       // blocked by conflict
    skipped: number;        // not applicable (delete, unknown, unsafe path)
  }
}
```

### Conflict Detection Rules

**create:**
- base 中目标文件不存在 → `safe`
- base 中目标文件存在且内容与 run 新内容相同 → `safe` (already applied)
- 否则 → `conflict` (target already exists)

**edit:**
- base 当前内容 === FileChange.oldContent → `safe` (base unchanged since run)
- base 当前内容 === FileChange.newContent → `safe` (already applied)
- oldContent 非空但 base 内容不同 → `conflict` (base file changed since run)
- oldContent 为空 → `conflict` (missing old content for safe edit)

**delete:**
- → `skipped` (delete not supported)

**unknown:**
- → `skipped` (unknown change type)

### Apply Changes Behavior Change

`POST /runs/:runId/apply-changes` 现在执行两阶段：

1. **Check phase**: 先执行 `checkRunChanges()` 进行冲突检测
2. **Apply phase**: 
   - 如果 `force=false`（默认）且有 conflict → 返回 **409**，body 包含 `{ detail, check: ApplyCheckResult }`
   - 仅复制 `status=safe` 的文件
   - skipped/conflict 文件写入 `skipped_files_json`

### 前端交互

- 点击 "Apply Changes" 先调用 `GET /runs/:runId/apply-check`（dry-run）
- 无冲突：自动调用 `POST /runs/:runId/apply-changes`，成功后显示 Applied badge
- 有冲突：显示黄色冲突摘要面板，包含：
  - `N safe / M conflict / K skipped` 统计
  - conflict 文件列表及 reason
  - "Apply disabled due to conflicts" 提示
- 冲突时 Apply Changes 按钮保持可见（用户可修复 base 文件后重试）
- 不支持 force apply UI

### API

| 接口 | 说明 |
|------|------|
| `GET /runs/:runId/apply-check` | Dry-run 冲突检测，返回 `ApplyCheckResult` |
| `POST /runs/:runId/apply-changes` | Apply changes（有冲突时返回 409 + check result） |
| `GET /runs/:runId/change-application` | 查询已记录的 apply 结果 |

---

## 当前限制

| 限制 | 说明 |
|------|------|
| 不做自动清理 | 无定时任务或 daemon，清理需用户手动触发 |
| 不创建 PR | worktree 分支不自动推送或发起 PR |
| 不做 git merge | 文件级复制，不产生 git commit |
| 不做冲突自动解决 | 有冲突时拒绝 apply，不尝试 merge |
| 不做 daemon/queue | 没有后台作业队列，run 同步启动 |
| 不同步远程仓库 | worktree 分支仅在本地，不推送 |
| 不做自动 GC | 无自动垃圾回收策略，需用户主动清理或脚本批量调用 |
| 不做 delete 文件 | delete 类型改动当前被 skipped |
| 不做文件选择 UI | 一次性 apply 全部文件，不支持部分选择 |
| 不做 force apply UI | 前端不暴露 force apply 选项 |
| 启用需显式配置 | `createAgentHubServer({ enableWorkspaceIsolation: true })` 默认在生产开启，测试默认关闭 |
