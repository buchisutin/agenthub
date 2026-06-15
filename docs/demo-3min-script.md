# AgentHub 3 分钟演示脚本

本文是参赛演示的唯一主线。后续打磨优先服务这条路径；不在这条路径上的产品化功能暂不处理。

## 演示目标

3 分钟内让评委看懂：

1. 用户像在群聊里向 `@orchestrator` 发开发任务。
2. Orchestrator 把需求拆成可并行的多 Agent DAG。
3. Claude / Codex 等异构 Agent 在隔离工作区内执行。
4. 用户查看 Diff、Preview、Deploy 结果。
5. 用户确认 Apply，系统输出协作总结。

核心叙事：

> AgentHub 是一个本地 IM 式多 Agent 编程协作平台，用统一 Runtime Adapter 接入 Claude Code / Codex CLI，用 Orchestrator 编排任务，用 workspace 隔离和 Diff / Preview / Deploy / Apply 闭环保障代码交付。

## 演示前置环境

- AgentHub 前端已启动：`http://localhost:5173`
- AgentHub 后端已启动：`http://localhost:8000`
- 准备一个 React / Vite 示例项目。
- 示例项目是 Git 仓库。
- 示例项目 `package.json` 至少包含：
  - `dev`
  - `build`
- Claude Code CLI 可用。
- Codex CLI 可用。
- AgentHub 内至少有两个 enabled agents：
  - `@codex-cli`
  - `@claude-code`
- Runtime 状态显示 available。

## 备用方案

`1:30 - 2:00` 的真实 Agent 执行最不可控，可能受 API、网络、模型速度影响。

准备两套演示路径：

- 正常路径：现场真实运行 Claude / Codex。
- 备用路径：提前录制多 Agent 执行阶段屏幕录像。现场如果调用变慢，就切到录像讲解，再回到真实 UI 展示 Diff / Preview / Deploy / Apply。

备用录像只覆盖执行等待阶段，不替代完整产品演示。

## 时间轴

### 0:00 - 0:20 进入本地项目

用户操作：

1. 打开 `http://localhost:5173`。
2. 在 WorkspaceSetup 输入 React 示例项目绝对路径。
3. 点击「验证项目」。

预期画面：

- 页面标题是「开始使用本地项目」。
- 路径校验成功。
- 显示 Git 仓库状态。
- 显示支持 Preview / Deploy 的提示。
- 出现「创建协作会话」按钮。

讲解要点：

- AgentHub 运行在开发者本机。
- Agent 操作的是用户自己的本地项目。
- 后续每个 Agent Run 都会在隔离工作区中执行。

### 0:20 - 0:40 进入群聊工作区

用户操作：

1. 点击「创建协作会话」。

预期画面：

- 左侧 Sidebar 出现当前会话。
- 顶部 TopBar 显示：
  - 项目名称。
  - workspace 路径。
  - runtime 状态。
  - 当前可用 Agent。
- 主区域是 IM 聊天界面。
- 输入框提示可使用 `@orchestrator` 或 `@agent`。

讲解要点：

- 这是类似飞书 / 微信的协作入口。
- Claude Code / Codex CLI 不是用户入口，而是后端 Runtime。
- 用户通过聊天触发编程协作。

### 0:40 - 1:00 发起协作任务

用户输入：

```text
@orchestrator 请为这个 React 项目增加一个用户反馈表单，包含姓名、邮箱、反馈内容、输入校验、提交状态，并在完成后运行构建验证。
```

预期画面：

- 用户消息进入聊天流。
- Orchestrator 出现 planning 状态。
- 页面显示「正在拆解任务」或类似状态提示。

讲解要点：

- 用户只描述目标，不手动拆任务。
- Orchestrator 负责把需求转成可执行计划。

### 1:00 - 1:30 展示并行 DAG 计划

预期画面：

出现 PlanCard，内容表达为：

```text
Orchestrator 协作计划

Task 1：实现 FeedbackForm 组件
分配给 @codex-cli
能力：frontend / react
状态：running

Task 2：页面集成和样式调整
分配给 @claude-code
能力：ui / integration
状态：running

Task 3：运行 build 验证并修复问题
分配给 @claude-code
能力：test / build
状态：pending

依赖关系：
Task 1 和 Task 2 可并行
Task 3 依赖 Task 1 + Task 2
```

截图级视觉要求：

- 每个 Agent 有头像或颜色标识。
- 每个任务显示 Agent 名称。
- 每个任务显示能力标签。
- Task 1 / Task 2 能看出是并行。
- Task 3 能看出等待上游完成。

讲解要点：

- AgentHub 不是简单地让多个 Agent 同时聊天。
- Orchestrator 输出的是带依赖关系的执行图。
- 前两个任务并行，第三个任务汇合验证，体现 DAG 调度能力。

### 1:30 - 2:00 多 Agent 执行

正常路径用户操作：

- 等待 RunCard 实时更新。

备用路径用户操作：

- 如果现场执行慢，切到提前录制的执行阶段视频。
- 讲解完成后切回真实 UI。

预期画面：

- `@codex-cli` RunCard：
  - 标题：`@codex-cli 正在执行：实现 FeedbackForm 组件`
  - 状态从 running 到 completed。
  - 显示 tool calls / 文件变更数量。
- `@claude-code` RunCard：
  - 标题：`@claude-code 正在执行：页面集成和样式调整`
  - 状态从 running 到 completed。
  - 显示修改 App / CSS 等文件。
- 第三个 `@claude-code` RunCard：
  - 标题：`@claude-code 正在执行：运行 build 验证`
  - 等前两个任务完成后启动。

讲解要点：

- 每个 Agent Run 都有独立状态和执行记录。
- 并行任务互不踩文件，因为系统使用隔离 workspace。
- 下游任务只有在上游完成并合并后才会继续。

### 2:00 - 2:25 查看 Diff 和 Preview

用户操作：

1. 点击 RunCard 的「Diff」或右侧 ArtifactPanel 的 Diff tab。
2. 点击「Preview」。

预期画面：

- Diff 面板展示文件变更，例如：
  - `src/components/FeedbackForm.tsx`
  - `src/App.tsx`
  - `src/index.css`
- 每个文件显示 create / edit 状态。
- Preview 启动本地 dev server。
- Preview 成功后显示 localhost 地址。
- 页面中可以看到反馈表单。

讲解要点：

- Diff 用来审查 Agent 产物。
- Preview 用来启动 dev server 看实际效果。
- Preview 的定位是「看效果」，不是 Deploy。

### 2:25 - 2:45 一键 Deploy 验证

用户操作：

1. 点击「Deploy」。
2. 选择或默认执行 `npm run build`。

预期画面：

出现 DeployCard：

```text
Deploy

检测到 package.json scripts:
dev
build
start

正在执行：npm run build
```

日志区域流式输出：

```text
> demo-project@0.0.0 build
> vite build

✓ built in 1.24s
Deploy succeeded
```

成功状态：

- Badge：`Deploy succeeded`
- 显示执行命令：`npm run build`
- 如果执行的是 `dev` 或 `start`，显示可点击 localhost 地址。

讲解要点：

- Preview 是启动 dev server 看效果。
- Deploy 是执行 build，验证产物可交付。
- 这里的 Deploy 是本地一键构建 / 交付验证，不宣称云部署。

### 2:45 - 3:00 Apply 和总结

用户操作：

1. 点击「Apply Changes」。
2. 在 ConfirmationCard 点击 Confirm。
3. 打开 Summary。

预期画面：

ConfirmationCard 显示：

```text
即将把 3 个文件应用到主项目：

src/components/FeedbackForm.tsx
src/App.tsx
src/index.css

冲突检查：通过
目标：当前 workspace
```

Confirm 后：

- RunCard 显示「已应用」。
- SummaryModal 展示协作总结。

Summary 内容：

```text
本次协作总结

用户需求：
增加用户反馈表单并完成构建验证

参与 Agent：
@codex-cli：FeedbackForm 组件实现
@claude-code：页面集成、样式调整、构建验证

完成任务：
3 / 3

文件变更：
src/components/FeedbackForm.tsx
src/App.tsx
src/index.css

验证结果：
Deploy succeeded
npm run build passed
```

讲解要点：

- Apply 需要人工确认，体现安全边界。
- ConfirmationCard 显示影响范围，不是盲目写入主项目。
- Summary 把需求、Agent 分工、文件变更和验证结果统一收口。

## P0 打磨清单

只做服务本剧本的内容。

1. DeployCard 最小可演示版本。
   - 检测 `package.json` scripts。
   - 支持执行 `npm run build`。
   - 后端 spawn 进程。
   - 日志流式展示到前端。
   - 成功后显示 `Deploy succeeded`。
2. PlanCard 视觉强化。
   - Agent 头像或颜色。
   - 能力标签。
   - 并行 / 依赖关系更清晰。
3. RunCard 标题强化。
   - 显示 `@agent 正在执行：task title`。
   - 显示 Agent 颜色和能力标签。
4. ConfirmationCard 安全信息强化。
   - 展示即将应用的文件数。
   - 展示文件列表。
   - 展示冲突检查结果。
   - 展示目标 workspace。
5. SummaryModal 增加 Deploy / build 结果。
6. README 增加赛题能力映射和本 Demo 路径。

## 暂不处理

这些内容不进入 3 分钟演示路径：

- 飞书 / 微信真实 adapter。
- Electron 桌面版。
- npm 发布。
- 云部署平台集成。
- 长期记忆。
- Skill / Role 市场。
- replay / benchmark 体系。

## 验收标准

演示成功的标准：

1. 3 分钟内讲完完整链路。
2. 评委能看懂 AgentHub 是 IM 式多 Agent 协作平台。
3. 评委能看懂 Orchestrator 产出并行 DAG。
4. 评委能看懂 Claude / Codex 通过统一 adapter 被调度。
5. 评委能看到 Diff、Preview、Deploy、Apply、Summary 闭环。
6. 即使真实 Agent 执行变慢，也能用备用录像保持节奏。
