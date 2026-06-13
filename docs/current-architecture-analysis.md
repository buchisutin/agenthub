# AgentHub Current Architecture Analysis

本文用于记录当前项目已经实现的产品形态、核心功能和模块职责边界。它不是改版方案，也不要求推翻现有设计。

## 1. 项目定位

AgentHub 当前更准确的定位是：

> 单用户本地 IM 式多 Agent 编程协作平台。

用户通过类似飞书/微信的会话界面发起协作请求，用 `@agent` 指定单个 Agent，用 `@orchestrator` 触发任务拆解和多 Agent 协作。Claude Code、Codex 等 CLI 工具不是产品入口，而是后端运行时。前端的核心价值不是替 Orchestrator 管理代码提交，而是把多 Agent 协作过程转成用户能理解、能干预、能追溯的聊天时间线。

因此，这个项目不是纯聊天机器人，也不是纯 CLI 调度器，而是：

```text
IM 交互层 + 本地 Agent Runtime 宿主 + Orchestrator 协作核心 + 工作区隔离/合并流水线
```

## 2. 赛题要求与当前实现对应关系

| 赛题要求 | 当前项目中的对应能力 |
| --- | --- |
| 类似飞书/微信的自然交互体验 | `Sidebar` 多会话列表、`ChatArea` 聊天主区域、message/plan/run/confirmation rich cards |
| 单聊、多会话并行 | `conversations`、侧边栏会话切换、每个 conversation 绑定独立 workspace |
| 通过 @ 指令实现群聊协作 | Chat 输入解析 `@orchestrator` 和 enabled agents，支持直接启动 Agent run 或 Orchestrator plan |
| 统一适配器层 | `RuntimeRegistry` + `ClaudeCliRuntime` + `CodexCliRuntime` + agent `adapter_type` |
| Orchestrator 任务拆解 | `OrchestratorService` 调用 planner 生成任务计划，落库为 message/task/assignment |
| 多 Agent 任务分配 | Orchestrator 根据 suggested agent、slug/name、capabilities、default agent 匹配执行者 |
| 代码 Diff | `RunsService.getFileChanges`、`DiffCard`、run workspace 与 base workspace 比较 |
| 网页预览 | `PreviewService`、`PreviewCard`，基于 run workspace 启动本地 preview |
| 一键部署/全流程能力 | 当前更接近本地 apply/preview/summary 闭环；真正部署能力尚未成为独立模块 |
| 协作结果汇报 | `SummaryModal` 汇总消息、任务、run、文件改动、确认状态 |

## 3. 用户主流程

当前推荐主流程是：

1. 用户打开本地 Web UI。
2. 在 `WorkspaceSetup` 输入本地项目绝对路径。
3. 后端验证 workspace 是否存在、是否为目录、是否是 git 仓库、是否支持 preview。
4. 创建 conversation，并绑定 workspace。
5. 用户在 `ChatArea` 输入 `@orchestrator ...` 或 `@agent ...`。
6. 如果是直接 `@agent`，系统创建单个 run。
7. 如果是 `@orchestrator`，系统先创建 plan，再把 plan 拆成 task/assignment/run。
8. 每个 run 在隔离 workspace 中执行。
9. 前端通过 socket 展示 run 状态、文本输出和 tool calls。
10. run 完成后，用户可以查看 Diff、启动 Preview、Apply 变更或处理确认。
11. Orchestrator DAG run 会在 merge 成功后解锁下游任务。
12. 用户最后查看 Summary，得到协作结果报告。

## 4. 前端职责

### 4.1 App Shell

`frontend/src/App.tsx` 定义了主界面骨架：

```text
Sidebar + TopBar + ConnectionBanner + ChatArea + Toast
```

这说明当前产品的中心不是 dashboard，而是会话工作区。

### 4.2 Sidebar

`Sidebar` 负责：

- 展示 conversation 列表。
- 创建新会话入口。
- 切换会话时 join socket room。
- 加载该会话的 workspace、timeline、active runs。
- 删除会话，并可选择清理临时 run workspaces。

### 4.3 TopBar

`TopBar` 负责展示当前会话上下文：

- conversation title。
- active run count。
- socket connection 状态。
- workspace 路径和 git 状态。
- runtime 不可用提示。
- Agent 管理入口。

它是当前会话的状态栏，不是任务调度器。

### 4.4 ChatArea

`ChatArea` 是 IM 产品形态的核心组件。它承担：

- 聊天输入。
- `@orchestrator` / `@agent` 用户意图入口。
- message、plan、run、confirmation 的统一展示。
- TaskPanel 和 TaskDetailDrawer 的入口。
- 把用户动作转成 API 调用，例如发送消息、启动 run、中断 run、rerun task。

需要注意：ChatArea 不应该拥有 Orchestrator 的调度语义。它可以发起用户意图和渲染状态，但 DAG 依赖、任务解锁、merge 成功判定、冲突处理的主逻辑应该继续留在后端。

### 4.5 PlanCard

`PlanCard` 是 Orchestrator 计划在 IM timeline 中的呈现方式。它适合展示：

- 计划摘要。
- 子任务列表。
- 每个任务的类型、Agent、状态。
- 查看 task / run 的入口。

它不应该演变成完整的 pipeline console。对于赛题而言，PlanCard 更像群聊里 Orchestrator 发出的一张结构化任务卡。

### 4.6 RunCard

`RunCard` 是单个 Agent 执行过程的 rich card。它已经承载了很多关键能力：

- Agent 名称、run id、状态、耗时、tool count。
- tool calls 折叠展示。
- completed 后展示 Diff、Preview、Apply。
- 对 Orchestrator DAG run 区分 auto merge 状态。
- 对普通 run 提供手动 apply。
- 清理 workspace 后隐藏不再可用的 Diff/Preview/Apply。

RunCard 的产品语义是“这个 Agent 在这个隔离工作区里做了什么，以及这些产物现在处于什么状态”。

### 4.7 ConfirmationCard

`ConfirmationCard` 用于本地单用户确认，不是企业审批系统。它覆盖：

- apply changes。
- cleanup workspace。
- cleanup conversation workspaces。
- 冲突或高风险动作的人类确认。

这符合当前项目“本地优先、单用户工具”的边界。

### 4.8 SummaryModal

`SummaryModal` 是演示和交付闭环。它能把当前 conversation 中的消息、任务、run、文件变更和确认事项汇总成 Markdown 报告。

## 5. 后端职责

### 5.1 App Composition

`server/src/app.ts` 是后端装配中心，创建并连接：

- database。
- conversations/messages/tasks/assignments/runs。
- agents/agent-runtimes/agent-sessions。
- runtime registry。
- workspace isolation。
- preview。
- merge。
- approval。
- orchestrator。
- realtime socket server。

它体现的是“本地协作平台后端”，而不是单一聊天 API。

### 5.2 RuntimeRegistry 与 Agent Runtime

`RuntimeRegistry` 管理不同 CLI runtime adapter。当前项目已经有：

- `claude_cli`。
- `codex_cli`。

Agent 通过 `adapter_type` 选择 runtime。后端会区分：

- adapter 是否 registered。
- 当前机器上 runtime 是否 available。

这就是统一适配器层的基础。

### 5.3 RunManager

`RunManager` 是执行层核心，负责：

- 校验 conversation、workspace、agent、runtime。
- 创建 `agent_runs`。
- 为 run 创建隔离 workspace。
- 组装结构化 Agent prompt。
- 启动 CLI runtime。
- 接收 runtime stream events。
- 持久化 run events。
- 更新 run/task/assignment 状态。
- 通过 socket 推送前端。
- 支持 interrupt 和 session resume。

RunManager 不负责 DAG 拆解，也不负责 IM 展示。

### 5.4 WorkspaceIsolationService

每个 run 会尽量获得独立工作区：

- clean git repo 优先使用 `git worktree`。
- dirty git repo 走 clone/sync fallback。
- 非 git 项目能力有限。

这个模块解决的是多 Agent 并行时互不踩文件的问题，是代码协作平台的关键基础设施。

### 5.5 OrchestratorService

Orchestrator 是多 Agent 协作核心，负责：

- 根据用户请求和 workspace 状态生成 planner prompt。
- 调用 planner run。
- 解析严格 JSON plan。
- 标准化 task id、依赖、task type、expected output、affected files、priority。
- 创建 plan message。
- 创建 task 和 assignment。
- 匹配合适 Agent。
- 启动 root tasks。
- 监听 run 完成。
- 对 DAG run 执行 merge。
- merge 成功后才把 task 标为 completed 并解锁下游。
- merge 失败或 run 失败时阻塞下游。
- 在全部完成后写入系统汇报 message。

这里最重要的设计点是：**运行完成不等于产物可用**。当前项目已经在 merge 成功后才解锁下游，这比只看 run status 的顺序调度更适合代码协作。

### 5.6 DagScheduler

`DagScheduler` 负责依赖调度：

- 找出没有依赖的 root tasks。
- 当上游完成后解锁 downstream。
- 当上游失败时阻塞 downstream。

它是 OrchestratorService 内部的执行计划状态机。

### 5.7 MergeService

`MergeService` 负责把 run workspace 里的结果合并回 base workspace：

- 无变更时标记 auto merged。
- base 未变化时可安全写入。
- base 已变化、删除、二进制、大文件等情况进入 conflict/needs approval。
- 人工解决冲突后继续更新状态。

这让 Orchestrator 可以管理代码产物的整合，而不是只汇报文本结果。

### 5.8 MessagesService

`MessagesService` 不是简单消息表封装。它还负责把后端多种记录还原成 conversation timeline：

- message。
- plan。
- run。
- confirmation。

这正是 IM UI 能展示完整协作过程的原因。

### 5.9 RealtimeServer

Socket 层提供：

- join/leave conversation。
- subscribe run。
- interrupt run。
- 推送 runtime events。
- 推送 orchestrator events。

这保证 ChatArea 能实时展示 Agent 输出和任务状态。

## 6. 数据与状态主线

当前项目的核心数据链路可以理解为：

```text
Conversation
  ├─ Workspace
  ├─ Messages
  │   └─ Plan Message
  ├─ Tasks
  │   └─ Assignments
  │       └─ Latest Run
  ├─ Agent Runs
  │   ├─ Runtime Events
  │   ├─ Run Workspace
  │   ├─ File Changes
  │   └─ Merge / Apply Status
  └─ Approval Requests / Confirmations
```

前端的 timeline 是这些记录的产品化视图，不是单一 messages 表。

## 7. ChatArea 是否必要

必要，但职责要准确。

Orchestrator 可以负责：

- 拆任务。
- 调度 Agent。
- 管理隔离 workspace。
- 自动合并。
- 冲突时暂停。
- 汇报最终状态。

但 Orchestrator 不是用户体验入口。ChatArea 负责：

- 用户自然语言输入。
- `@` 指令入口。
- 多会话上下文。
- 实时状态呈现。
- 让用户看到多个 Agent 像群聊成员一样协作。
- 在关键节点让用户审批。
- 给用户一个可追溯的工作记录。

所以不是“Orchestrator 已经能管理提交，就不需要 ChatArea”，而是：

```text
Orchestrator 管协作事务。
ChatArea 管人机交互和协作可见性。
```

这两个模块不是重复关系，而是产品层和执行层的关系。

## 8. 当前设计中应该保留的边界

后续改进时应尽量守住这些边界：

1. 不把 ChatArea 改成纯 DAG 控制台。
2. 不把 Orchestrator 逻辑塞进前端组件。
3. 不让 RunCard 直接决定 DAG 下游是否可运行。
4. 不让 PlanCard 承担合并事务逻辑。
5. 不把 confirmation 做成复杂多用户审批系统。
6. 不绕开 workspace isolation 直接在用户项目目录运行 Agent。
7. 不把 CLI runtime 暴露成产品主入口。
8. 不把手动 apply 流程和 Orchestrator auto merge 流程混在一起。

## 9. 当前项目已经比较有价值的点

与常见 demo 相比，当前项目比较有辨识度的能力包括：

- 本地 IM 式多 Agent 协作，而不是单 Agent chat。
- 统一 runtime adapter，可以接 Claude Code / Codex。
- conversation 绑定 workspace。
- run 级隔离工作区。
- task/assignment/run 分层清楚。
- Orchestrator 能把 plan 落成真实任务和真实 run。
- DAG 调度不只看文本完成，而是看 merge 后产物是否可用。
- Diff、Preview、Apply、Confirmation、Summary 已形成演示闭环。

这些能力已经贴合赛题，不需要为了“更像 orchestrator 框架”而改变产品形态。

## 10. 当前仍可改进但不应急着重做的点

下面是可以增强的方向，但不要求推翻现有 UI：

1. **ChatArea 变轻**
   - 保持 ChatArea 作为 IM 容器。
   - 把更多 API action 迁到 `runtimeActions` 或专用 hooks。

2. **PlanCard 更清楚**
   - 轻量展示依赖关系、阶段、阻塞原因。
   - 不需要改成完整流程编排器。

3. **Orchestrator 可解释性**
   - 显示为什么某任务分配给某 Agent。
   - 显示下游等待的是 run、merge 还是 confirmation。

4. **产物语义更明确**
   - 区分 run completed、merged、needs approval、artifact unavailable。
   - 这应该以后端状态为准，前端只渲染。

5. **演示文档更聚焦**
   - 用一条主线说明：用户发消息，Orchestrator 拆任务，Agent 并行执行，系统自动合并，用户查看 Diff/Preview/Summary。

## 11. 结论

当前项目的核心不是“聊天区是否有必要”，而是要明确：

- ChatArea 是 IM 协作体验入口。
- Orchestrator 是多 Agent 协作事务核心。
- RunManager 是 CLI Agent 执行核心。
- WorkspaceIsolation 和 MergeService 是代码产物安全流转核心。
- Summary/Diff/Preview/Confirmation 是赛题演示闭环。

后续改动应该围绕“让这些已有边界更清楚、更可演示”展开，而不是重做原有设计。
