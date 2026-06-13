# AgentHub 演示指南

AgentHub 是一个单用户本地 IM 式多 Agent 编程协作平台。在本地聊天界面中通过 @agent 和 @orchestrator 让多个 AI Agent 并行执行编程任务。

## 环境准备

### 前置依赖

- Node.js 22+
- npm
- Claude CLI（Claude Code）已安装并可用

验证 Claude CLI：

```bash
claude --version
```

如果提示 `command not found`，请先安装 Claude Code。

### 安装项目

```bash
cd server && npm install
cd ../frontend && npm install
```

## 启动命令

终端 1 — 启动后端：

```bash
cd server
npm run dev
```

终端 2 — 启动前端：

```bash
cd frontend
npm run dev
```

前端默认运行在 `http://localhost:5173`。

## 演示步骤

### 1. 打开系统

浏览器打开 `http://localhost:5173`，进入 AgentHub。

### 2. 输入本地项目路径

在 WorkspaceSetup 页面，输入你要演示的本地项目绝对路径，例如：

```
/Users/you/projects/my-blog
```

### 3. 验证 Workspace

点击「验证项目」按钮。

系统会检测：
- 路径是否存在
- 是否为有效目录
- 是否为 Git 仓库
- 是否支持 Preview

验证通过后显示「项目已准备就绪」。

### 4. 创建协作会话

点击「创建协作会话」按钮。系统会创建一个绑定该 Workspace 的 Conversation。

### 5. 配置 Agent（可选）

如果默认 Agent 未配置或 Runtime 不可用：

1. 点击 TopBar 的「Agents」按钮
2. 确保至少有一个 agent 的 `enabled` 为 true
3. 确保 `adapter_type` 为 `claude_cli`
4. 确保 Runtime 状态为 `available`

### 6. 使用 @orchestrator

在输入框中输入：

```
@orchestrator 请检查当前项目结构，并帮我实现一个 TODO 列表功能
```

按 Enter 发送。Orchestrator 会：
1. 分析项目结构
2. 拆解任务
3. 创建 TaskPlan
4. 分配给合适的 Agent
5. 启动并行 Run

### 7. 查看 PlanCard

ChatArea 中会出现 PlanCard，展示：
- 任务拆解摘要
- 每个子任务的标题、类型、分配 Agent
- 子任务执行状态

### 8. 查看 RunCard

每个 Agent Run 显示为 RunCard：
- Agent 名称
- 执行的 tool calls（Read、Write、Edit、Bash 等）
- 运行状态（running / completed / failed）
- 操作按钮

### 9. 查看 Diff

Run 完成后，点击「View Diff」查看 Agent 所做的文件变更：
- 文件路径
- 变更类型（create / edit）
- 新旧内容对比

### 10. 启动 Preview

如果项目支持 Preview，点击「Start Preview」启动本地预览服务。

### 11. Apply Check

点击「Apply Changes」，系统会：
1. 执行冲突检测（conflict guard）
2. 无冲突时创建确认卡片
3. 显示「Needs confirmation」

### 12. Confirm Apply

点击「Confirm」执行 Apply。Agent 的变更会回写到 base workspace。

### 13. Cleanup Workspace

任务完成后，点击「Clean workspace」清理临时工作区。

### 14. 查看协作总结

点击 TopBar 右侧的「查看总结」按钮。

SummaryModal 展示：
- **统计概览**：消息数、任务数、Run 数、已完成/失败/中断数、已 Apply 数、已清理数、待确认数
- **工作目录**：Workspace 路径、Git 状态、Preview 支持
- **任务列表**：每个任务的标题、状态、分配 Agent
- **Run 列表**：每个 Run 的状态、Agent、文件变更数、Apply/清理状态
- **修改文件**：所有 Run 修改的文件路径和变更类型
- **待确认事项**：pending 的 confirmation 列表

#### 复制 Markdown

点击「复制 Markdown」按钮，将总结内容以 Markdown 格式复制到剪贴板，可直接粘贴到文档或 PR 描述中。

#### 演示建议

在一轮协作结束后：
1. 点击「查看总结」
2. 截图统计概览区域
3. 用修改文件列表说明实际产出
4. 复制 Markdown 粘贴到验收文档

## 推荐演示 Prompt

### 快速验证

```
@orchestrator 请检查当前项目结构，列出项目的技术栈、主要目录和可以改进的地方
```

### 前端任务

```
@orchestrator 请为我的项目实现一个响应式导航栏组件，支持移动端菜单展开
```

### 后端任务

```
@orchestrator 请为我的 API 添加错误处理中间件和日志记录
```

### 重构任务

```
@orchestrator 请将 src/utils 目录中的函数重构为 TypeScript，并补充类型定义
```

### 测试任务

```
@orchestrator 请为 src/components 目录中所有组件补充单元测试
```

## 常见问题

### Runtime 不可用

**表现**：TopBar 显示"Runtime 不可用"，Run 创建失败。

**原因**：Claude CLI 未安装或不在 PATH 中。

**解决**：
1. 确认 `claude --version` 可用
2. 在 Agents 面板中检查 agent 的 adapter_type 为 `claude_cli`
3. 重启 server

### 项目不支持 Preview

**表现**：WorkspaceSetup 验证结果显示 Preview 未通过。

**原因**：项目没有 `package.json` 中 `dev`/`start` 脚本，也没有 `index.html`。

**解决**：Preview 功能可选，不影响其他功能使用。可以通过 `npx serve` 等工具手动预览。

### 检测到冲突

**表现**：Apply Changes 显示 conflict。

**原因**：base workspace 中的文件在 Agent Run 期间被外部修改。

**解决**：先处理冲突文件，再重新点击 Apply Changes。

### Workspace 已清理后 Diff / Preview 不可用

**表现**：RunCard 显示"Workspace cleaned. Diff / Preview unavailable"。

**原因**：Workspace 清理后，临时文件和预览服务被销毁。

**解决**：重新 rerun 该任务以获取新的 Workspace。

### Agent 没有响应

**表现**：Run 卡在 queued 或 running 状态不动。

**解决**：
1. 检查 server 日志
2. 确认 Claude CLI 正常
3. 点击「中断」按钮中止 Run
4. 重新发送 prompt
