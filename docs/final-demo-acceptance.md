# AgentHub 最终演示验收文档

本文档提供完整的演示链路验收脚本，确保 AgentHub 可以稳定演示。

## 环境准备

### 前置依赖

- Node.js 22+
- npm
- Claude CLI（Claude Code）已安装并可用
- 一个本地 Git 项目用于演示（推荐包含 package.json 的前端项目）

### 验证 Claude CLI

```bash
claude --version
# 应输出版本号，如 "Claude Code X.Y.Z"
```

如果提示 `command not found`，请先安装 Claude Code。

### 安装项目

```bash
cd server && npm install
cd ../frontend && npm install
```

## 启动命令

终端 1 — 后端（端口 8000）：

```bash
cd server
npm run dev
```

终端 2 — 前端（端口 5173）：

```bash
cd frontend
npm run dev
```

浏览器打开 `http://localhost:5173`。

## 推荐测试项目结构

建议使用满足以下条件的本地项目：
- Git 仓库
- 包含 `package.json`
- `package.json` 中有 `dev` 或 `start` 脚本（可选，用于测试 Preview）
- 包含一些可修改的源文件（`.ts`、`.tsx`、`.js` 等）

如果没有合适的项目，可以创建一个最小测试项目：

```bash
mkdir ~/demo-project
cd ~/demo-project
git init
echo '{"name":"demo","scripts":{"dev":"echo hello"}}' > package.json
echo "console.log('hello');" > index.js
git add . && git commit -m "init"
```

## 推荐 Agent 配置

在 Agents 面板中确保：
- 至少有一个 agent 的 `enabled` 为 `true`
- `adapter_type` 为 `claude_cli`
- Runtime 状态为 `available`（绿色圆点）
- 该 agent 的 `is_default` 为 `true`

## 推荐 Demo Prompt

```
@orchestrator 请检查当前项目结构，并新建一个简单的 README.md 说明项目用途
```

## 逐步演示脚本

### 步骤 1：打开系统

浏览器打开 `http://localhost:5173`。

**预期**：显示 WorkspaceSetup 页面，标题"开始使用本地项目"。

### 步骤 2：输入本地项目路径

在输入框中输入项目绝对路径，例如 `/Users/you/demo-project`。

点击「验证项目」。

**预期**：
- 显示 ✓ 路径存在、是有效目录、Git 仓库
- 显示"项目已准备就绪"
- 如果检测到 Git："检测到 Git 仓库，后续 Run 会优先使用独立 worktree 隔离执行。"
- 如果 Preview 可用：✓ 支持 Preview

### 步骤 2b：验证失败情况

输入不存在的路径如 `/nonexistent/path`，点击「验证项目」。

**预期**：
- 显示"项目路径不可用"
- 显示错误信息"Path does not exist"
- 「创建协作会话」按钮不出现

### 步骤 3：创建协作会话

点击「创建协作会话」。

**预期**：
- 进入 Chat Workspace 页面
- TopBar 显示项目名称和 git badge
- ChatArea 显示"开始和 Agent 协作"引导卡片和快捷 prompt 按钮

### 步骤 4：检查 Runtime / Agent 状态

查看 TopBar 右侧：
- 显示 agent 数量和默认 agent slug
- 如果没有红色"Runtime 不可用"badge，说明 Runtime 正常

**如果显示 Runtime 不可用**：见常见问题。

### 步骤 5：输入 @orchestrator 任务

在输入框中输入：
```
@orchestrator 请检查当前项目结构，并新建一个简单的 README.md 说明项目用途
```

按 Enter 发送。

**预期**：
- 用户消息卡片出现在 ChatArea
- Orchestrator 处理中（短暂延迟）
- 出现 PlanCard（任务计划卡片），包含拆解的子任务
- PlanCard 每个子任务显示标题、类型、分配 Agent、状态

### 步骤 6：查看 RunCard

PlanCard 中的子任务启动后，ChatArea 出现 RunCard。

**预期**：
- RunCard 显示 Agent 名称、Run ID 前缀、tool calls 数量
- tool calls 逐步出现（Read、Write、Edit 等）
- Run 运行中显示 loading 动画
- Run 完成后状态变为 completed

### 步骤 7：查看 Diff

Run 完成后，点击 RunCard 下的「View Diff」。

**预期**：
- 展开 DiffCard，显示变更文件路径
- 显示文件变更类型（create / edit）
- 显示新旧内容对比

### 步骤 8：启动 Preview

点击 RunCard 下的「Start Preview」。

**预期**：
- 如果项目支持 Preview：显示 Preview 面板（内嵌 iframe 或服务已启动提示）
- 按钮变为「Preview running」
- 如果项目不支持：Preview 可能启动失败，显示错误信息

### 步骤 9：Apply Check

点击 RunCard 下的「Apply Changes」。

**预期**：
- 系统执行 apply-check（conflict guard）
- 无冲突时：出现 ConfirmationCard，黄色边框，"Needs confirmation" 徽章，Confirm / Cancel 按钮
- 有冲突时：出现 conflict panel，显示冲突文件列表和原因

### 步骤 10：Confirm Apply

在 ConfirmationCard 上点击「Confirm」。

**预期**：
- 按钮变为"Confirming..."
- 执行完成后 ConfirmationCard 变为绿色边框，显示"Executed"
- RunCard 显示"Applied"徽章和文件数
- Apply Changes 按钮隐藏

### 步骤 10b：Cancel Apply

如果点击「Cancel」。

**预期**：
- ConfirmationCard 变为灰色边框，显示"Cancelled"
- 不执行 Apply
- Apply Changes 按钮重新出现

### 步骤 11：Clean Workspace

点击 RunCard 下的「Clean workspace」。

**预期**：
- 出现 ConfirmationCard（cleanup_workspace）
- 点击 Confirm 后 workspace 状态变为 cleaned
- RunCard 显示"Workspace cleaned. Diff / Preview unavailable"
- Diff / Preview / Apply / Clean 按钮全部隐藏
- 仅显示 cleaned badge 和说明文字

### 步骤 11b：Cancel Cleanup

如果点击「Cancel」。

**预期**：
- ConfirmationCard 显示"Cancelled"
- workspace 保持 ready 状态
- Clean workspace 按钮重新出现

### 步骤 12：查看协作总结

点击 TopBar 右侧「查看总结」按钮。

**预期**：
- 弹出 SummaryModal
- 显示统计概览：消息数、任务数、Run 数、已完成、已 Apply 等
- 显示工作目录信息（路径、Git、Preview）
- 显示任务列表（标题、状态、分配 Agent）
- 显示 Run 列表（状态、文件变更数、apply/清理状态）
- 显示修改文件列表
- 如有待确认事项，显示"待确认事项"section

### 步骤 13：复制 Markdown Summary

在 SummaryModal 中点击「复制 Markdown」。

**预期**：
- 按钮变为"已复制"（2 秒后恢复）
- 粘贴到文本编辑器，可见格式化的中文 Markdown 总结

## 常见失败情况与处理

### Runtime 不可用

**表现**：TopBar 显示红色"Runtime 不可用"badge。Run 创建时提示错误。

**原因**：Claude CLI 未安装或不在 PATH 中。

**处理**：
1. 终端执行 `claude --version` 验证
2. 在 Agents 面板中确保有 enabled agent
3. 确保 agent 的 `adapter_type` 为 `claude_cli`
4. 重启 server

### Workspace 路径无效

**表现**：验证时显示"项目路径不可用"。

**处理**：
1. 确认路径是绝对路径（以 `/` 或 `C:\` 开头）
2. 确认路径存在且为目录
3. 使用 `pwd` 获取当前目录的绝对路径

### Preview 不可用

**表现**：WorkspaceSetup 验证显示 Preview 未通过。Start Preview 后显示错误。

**处理**：
1. 如果项目不需要 Preview，跳过此步骤
2. 检查 package.json 中是否有 `dev` 或 `start` scripts
3. 检查是否有 `index.html`

### Apply Conflict

**表现**：Apply Changes 显示 conflict panel 和"Apply disabled due to conflicts"。

**处理**：
1. 检查 base workspace 中的文件是否在 Run 期间被外部修改
2. 确认冲突原因
3. 解决冲突后重新 Apply

### Workspace 已清理后功能不可用

**表现**：RunCard 显示"Workspace cleaned. Diff / Preview unavailable"。

**处理**：
1. 这是正常行为，Workspace 清理后临时文件被销毁
2. 需要 Diff 或 Preview 时，rerun 该任务

## 最终演示检查清单

- [ ] 系统正常启动，可以打开前端页面
- [ ] Workspace 验证成功，可以创建协作会话
- [ ] TopBar 显示 workspace 路径、git badge、agent 信息
- [ ] Runtime 状态正常，无红色 warning
- [ ] @orchestrator 可以生成 PlanCard 和 RunCard
- [ ] Run 可以正常执行（tool calls 可见）
- [ ] Diff 可以正常显示文件变更
- [ ] Preview 可以启动（或显示合理的错误提示）
- [ ] Apply Check 可以正常检测冲突
- [ ] Apply Changes 无冲突时可以创建 ConfirmationCard
- [ ] Confirm 后 Apply 执行成功
- [ ] Cancel 后 Apply 不执行
- [ ] Clean Workspace 可以创建 ConfirmationCard
- [ ] Confirm cleanup 后 workspace 状态变为 cleaned
- [ ] SummaryModal 可以正常打开，数据正确
- [ ] 复制 Markdown 可以正常工作
- [ ] Agent 设置面板可以正常打开和编辑
- [ ] 关闭系统后可以重新打开，会话和 timeline 不丢失

## 文档索引

- [demo-guide.md](./demo-guide.md) — 演示指南（13 步详细流程）
- [phase-4-workspace-isolation.md](./phase-4-workspace-isolation.md) — Workspace 隔离
- [phase-6-agent-runtime-management.md](./phase-6-agent-runtime-management.md) — Agent / Runtime 管理
- [phase-7-dangerous-action-confirmation.md](./phase-7-dangerous-action-confirmation.md) — 危险操作确认
- [phase-8-workspace-setup.md](./phase-8-workspace-setup.md) — Workspace 设置
