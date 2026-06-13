# Phase 8: Project / Workspace Setup MVP

AgentHub 是单用户本地 IM 式多 Agent 编程协作平台。

## 设计动机

当前系统功能完整但缺少清晰入口。用户首次进入时需要明确的"选择项目 → 开始协作"流程。

## Workspace 验证规则

`POST /workspaces/validate` 返回 `WorkspaceValidationResult`：

| 字段 | 含义 | 条件 |
|------|------|------|
| exists | 路径存在 | `fs.existsSync(path)` |
| isDirectory | 是目录 | `fs.statSync(path).isDirectory()` |
| isGitRepo | 是 Git 仓库 | `git rev-parse --show-toplevel` 成功 |
| gitRoot | Git 根路径 | git rev-parse 输出 |
| packageJsonExists | 存在 package.json | `fs.existsSync(path/package.json)` |
| previewCapable | 支持预览 | package.json scripts.dev/start 或 index.html 存在 |
| errors | 错误信息 | 绝对路径检查、存在性、目录检查 |

限制：
- rootPath 必须是绝对路径
- 不支持相对路径
- 不支持远程 URL

## API

### POST /workspaces/validate

请求：`{ rootPath: string }`
响应：`WorkspaceValidationResult`

### POST /conversations/with-workspace

请求：`{ title?: string, rootPath: string }`

流程：
1. 调用 `workspacesService.validateWorkspacePath(rootPath)`
2. 如果有 validation errors，返回 400
3. 创建 conversation
4. 绑定 workspace（`workspacesService.bindWorkspace`）
5. 返回 `{ conversation, workspace, validation }`

相同 rootPath 可以创建多个 conversation，每个通过 `bindWorkspace` 的 ON CONFLICT 逻辑绑定。

## WorkspaceSetup UI

### 全屏模式（无 conversation 时）

- 标题："Start with a local project"
- 输入框：local project path（有 placeholder）
- Validate 按钮
- 验证结果展示（✓/✗ 列表）
- Create conversation 按钮（验证通过后出现）
- Runtime status 面板（默认 agent + Claude CLI 检查）

### 紧凑模式（有 conversation 但无 workspace 时）

- 简化的路径输入 + Validate + Create 行
- 验证结果简化展示
- Runtime status 面板

## Conversation + Workspace 创建链路

1. 用户输入 rootPath
2. 点击 Validate → `POST /workspaces/validate` → 显示验证结果
3. 点击 Create conversation → `POST /conversations/with-workspace`
4. 服务端：验证路径 → 创建 conversation → 绑定 workspace
5. 前端：add conversation → set workspace → select conversation → load timeline
6. 进入 Chat Workspace

## TopBar / Sidebar 增强

- **Sidebar**: "New workspace conversation" 按钮 → 取消选中 conversation → 显示 WorkspaceSetup
- **TopBar**: workspace 路径旁显示 git badge（绿色 "git" 或灰色 "no git"）

## 当前限制

- 不支持远程 Git clone
- 不支持 GitHub OAuth
- 不支持文件浏览器（只有文本输入）
- 不支持多项目权限
- 不支持 project dashboard
- 不支持 daemon/queue
- 不支持云端同步
