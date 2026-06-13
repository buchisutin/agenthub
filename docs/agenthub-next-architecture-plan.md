# AgentHub 下一阶段架构改造说明

## 1. 文档目的

这份文档的目标是帮助新的 AI 或新接手的开发者快速理解：

1. AgentHub 过去是怎么实现的
2. AgentHub 现在已经改成了什么
3. 结合参考项目（如 Multica）的建模方式，我们当前还存在哪些结构性问题
4. 下一阶段最应该怎么改，按什么顺序改

这份文档不是 PRD，也不是逐文件改动记录，而是一份面向后续重构和继续开发的技术说明。

---

## 2. 项目演进概览

### 2.1 原来的做法

项目最初是一个偏“聊天后端”的实现：

- 后端是 Python / FastAPI
- 核心对象是 `conversation + message`
- 所谓 “Claude Code” 实际上接的是普通 Anthropic-compatible 模型 API
- 每次交互更像：
  - 用户发一条消息
  - 后端调用模型
  - 得到一段文本回复
  - 将回复存回数据库

这套做法的问题是：

- 它不是一个真正的 coding agent 宿主
- 没有本地 CLI runtime
- 没有真实工具调用流
- 没有本地工作目录
- 没有原生 session / resume
- “Agent” 和 “模型回复” 基本是同一个概念

一句话总结：

**原来的 AgentHub 更像聊天应用，不像本地 Coding Agent 平台。**

### 2.2 现在的做法

当前项目已经完成了一次架构转向：

- 旧 `backend/` 已删除
- 新后端为 `server/`
- 技术栈变为 Node.js + TypeScript + Socket.IO + SQLite
- 前端为 React + Vite
- 后端直接在本机 `spawn` Claude Code CLI
- 运行时读取 Claude CLI 的 `stream-json` 事件流
- 前端不再以 message 为核心，而是以 `run + event timeline` 为核心
- 已接入 Claude 原生 `session / resume`

现在项目更准确的定位是：

**一个运行在本地机器上的 CLI Agent 宿主原型，前端以类聊天界面展示 run 和 tool 流。**

---

## 3. 当前已经具备的能力

### 3.1 后端已具备

- 会话 `conversations`
- 本地工作目录绑定 `workspaces`
- Agent 静态定义 `agents`
- 一次执行 `agent_runs`
- 执行事件流 `run_events`
- Claude CLI 本地启动与中断
- Claude `stream-json` 解析
- 结构化工具事件：
  - `tool_started`
  - `tool_input_delta`
  - `tool_completed`
  - `tool_result`
  - `tool_error`
- 文本事件：
  - `text_delta`
  - `run_completed`
  - `run_failed`
  - `run_interrupted`
- Claude session/resume：
  - `conversation.agent_session_id`
  - `conversation.session_status`
  - 后续 run 通过 `--resume <session_id>` 续接
- session invalid 时前端可手动 reset

### 3.2 前端已具备

- 左侧会话列表
- 顶部工作目录绑定
- 右侧 run timeline
- Agent 文本块
- 工具卡片
- 审批卡片占位
- 每个 run 的工具调用统计
- invalid session 提示和“重建会话”按钮

---

## 4. 参考项目给我们的关键启发

参考项目（如 Multica）最值得借鉴的不是具体技术栈，而是它把 Agent 系统明确拆成了多层对象。

其核心思路可以总结为：

- `Agent`：静态定义，表示“这个代理是谁”
- `Backend`：统一执行接口，隐藏本地/云端差异
- `Runtime`：某个 Agent 当前运行在哪里、是否在线、由谁托管
- `Session`：一次底层原生上下文会话
- `Run`：一次具体执行
- `Event`：执行过程中的离散事件流

这个拆法很重要，因为它说明：

1. 协作不等于共享底层 session
2. 本地 runtime 和云端 runtime 可以通过统一 backend 接口抽象
3. 产品层 `conversation` 与底层 `session` 不是同一个概念
4. `run` 不应该和 `session` 混为一谈
5. 事件流应当是一等公民，而不是附属日志

除了这五点，参考项目后续补充的信息还带来了两个非常重要的新结论：

1. **长期真正的协作中心应该是 `task`，不是 `conversation`**
2. **执行层对象应该同时能关联 chat/task/autopilot 等触发来源，而不是让一张大宽表承担所有职责**

这会直接修正我们对 AgentHub 下一阶段改造重点的判断。

---

## 5. 当前项目存在的核心问题

下面的问题不是“功能不能跑”，而是“从长期可维护性和扩展性看，核心模型还没完全拆干净”。

### 5.1 我们仍然太把 Conversation 当中心了

当前做法仍然隐含着一种假设：

- conversation 是主对象
- run 从 conversation 发起
- session 绑定在 conversation 上
- 协作上下文主要依赖 conversation 延续

这个结构对单 Agent 聊天式原型是可用的，但对真正的协作平台不够稳。

参考项目的启发是：

- `conversation/chat_session` 是交互层
- `task/issue` 是工作层
- `run/session` 是执行层

也就是说：

- `conversation` 负责承载“我们聊了什么、Agent 做了什么”
- `task` 负责承载“这件事是什么、谁负责、做到哪了”
- `run/session` 负责承载“具体怎么执行的”

当前 AgentHub 还没有 `task` 层，所以很多本来应该属于工作层的东西，仍然被 conversation 被动承担着。

### 5.2 Conversation 和 Agent Session 仍然耦合

当前做法：

- `conversation` 上直接挂了：
  - `agent_session_id`
  - `session_status`
  - `session_invalid_reason`

这作为过渡方案是可以工作的，但长期问题明显：

- `conversation` 是产品层容器
- `agent session` 是底层 runtime 上下文容器
- 一个 conversation 未来可能关联多个 agent session
- 一个 conversation 未来可能切换 agent 或并行多个 agent

所以把 session 字段直接放在 `conversations` 上，会越来越别扭。

### 5.3 Agent 和 Runtime 还没有正式分开

当前 `agents` 表更像是静态定义，但 runtime 状态事实上还散落在逻辑里：

- 本地 CLI 是否可用
- 当前 session 是否有效
- 将来本地/云端差异怎么表达

这些都还没有正式的 `agent_runtimes` 层。

问题在于：

- `Agent` 代表能力定义
- `Runtime` 代表运行实体

这两个概念长期不应合并。

### 5.4 Run 还没有显式绑定 Session

当前 `agent_runs` 有：

- `conversation_id`
- `agent_id`
- `workspace_id`

但没有显式 `agent_session_id`。

这会带来几个问题：

- 调试时无法直接知道某次 run 属于哪个 session
- 无法清晰支持同一 conversation 下多个 session
- 回放、统计、问题追踪都需要间接推断

### 5.5 Event 基础设施还不够完整

当前已经有结构化事件流，但还缺几个长期很重要的基础设施：

- 没有独立稳定的 `event_id` 语义
- 前端幂等去重能力不够明确
- 重连补偿策略还不够清楚
- `run_events` 现在更像按顺序日志，而不是完整事件总线

如果以后事件更多、run 更复杂、前端可能多端同步，这会成为痛点。

### 5.6 Runtime 抽象还偏 Claude 专用

虽然当前已经有 `AgentRuntime` 抽象，但仍然明显是围绕 `ClaudeCliRuntime` 来写的。

这意味着：

- 现在能跑 Claude
- 但未来接入 Codex CLI 或其他本地 runtime 时，可能会发现上层逻辑还是知道太多 Claude 细节

也就是说，当前抽象还没有完全稳定到“平台级”。

### 5.7 多 Agent 协作模型尚未建立

当前 session/resume 是单 Agent 场景下成立的：

- 一个 conversation
- 一个 Claude CLI session
- 多次 runs

但如果要做多 Agent 协作，不能简单让多个 Agent 共享同一个 provider session。

因为：

- Claude session 只能给 Claude 用
- Codex session 只能给 Codex 用
- 即使都是 Claude，不同角色的 Agent 也不适合共用一个底层 session

所以未来多 Agent 的正确模型应该是：

- 多个 Agent 共享 `task`
- conversation 作为交互入口承载讨论和回放
- 共享 `workspace`
- 共享 `task/artifacts`
- 各自维护自己的 `agent_session`

而当前项目还没有把这一层正式建出来。

### 5.8 缺少 Task 层，导致协作语义无处安放

当前系统仍然没有独立的 `task` 对象。

这意味着：

- 没有正式的工作目标实体
- 没有任务状态机
- 没有“被谁负责”的明确挂载点
- 多 Agent 协作时没有共享的工作对象

这会导致 conversation 被迫承担本不属于它的职责，比如：

- 表达目标
- 表达优先级
- 表达状态
- 表达阻塞原因
- 表达分工关系

如果继续沿着纯 conversation 模型往前走，后面会很快遇到：

- 很难回答“现在有哪些待办”
- 很难把大目标拆成多个子项
- 很难让多个 agent 围绕同一个目标协作
- 很难做 squad/leader/subtask 这类 orchestration

### 5.9 任务层和自动化层仍然缺席

当前系统仍然偏“聊天驱动 run”：

- 用户输入 prompt
- 启动一次 run
- 展示事件流

这适合当前原型阶段，但如果目标是“多 Agent 协作平台”，长期还会缺：

- `task`
- `task_run`
- `trigger_source`
- `autopilot`
- `workflow`

现在不是立刻要做全套任务系统，而是要意识到：

**未来不能把所有自动化和协作都塞回 conversation 本身。**

---

## 6. 建议的目标模型

结合当前项目现状和参考项目的信息，建议把 AgentHub 的长期模型理解成三层：

- `conversation`：交互层
- `task`：工作层
- `runtime/session/run/event`：执行层

这意味着：

- **conversation 不是长期中心**
- **task 才是长期协作中心**
- session/run 不直接等同于前端会话，也不直接等同于工作目标

在这个前提下，下一阶段建议将 AgentHub 的核心领域对象收敛为下面六层。

### 6.1 Task

表示一个可跟踪的工作目标。

建议新增表：`tasks`

建议字段：

- `id`
- `title`
- `description`
- `status`：`todo | in_progress | in_review | blocked | done | cancelled`
- `priority`
- `workspace_id`
- `owner_id`
- `assignee_type`
- `assignee_id`
- `created_at`
- `updated_at`

语义：

- 这是协作主对象
- 这是被推进、被分配、被完成的工作项
- conversation 和 run 都是围绕 task 展开的

### 6.2 Agent

表示静态代理定义。

建议字段：

- `id`
- `name`
- `platform`
- `backend_type`
- `visibility`
- `owner_id`
- `capabilities`
- `config_json`

语义：

- 这是“谁”
- 不是“现在在哪跑”
- 不是“当前会话”

### 6.3 AgentRuntime

表示某个 Agent 当前可用的运行实体。

建议新增表：`agent_runtimes`

建议字段：

- `id`
- `agent_id`
- `mode`：`local | cloud`
- `provider`
- `status`：`online | offline | busy | error`
- `owner_id`
- `machine_id` 或 `runtime_identity`
- `last_heartbeat_at`
- `metadata_json`

语义：

- 这是“它现在在哪跑”
- 未来可承载 daemon、本地 CLI host、云端 runtime

### 6.4 AgentSession

表示某个 runtime/provider 的原生上下文会话。

建议新增表：`agent_sessions`

建议字段：

- `id`
- `task_id`
- `conversation_id`
- `agent_id`
- `runtime_id`
- `provider_session_id`
- `status`：`none | active | invalid | interrupted | closed`
- `created_at`
- `last_resumed_at`
- `invalid_reason`
- `metadata_json`

语义：

- 这是 Claude/Codex 的真实上下文链
- 一个 session 下可以发生多次 runs
- 未来多 Agent 协作时，不同 agent 拥有不同 session
- session 可以既关联 conversation，也关联 task；两者不是互斥关系

### 6.5 AgentRun

表示一次执行。

当前已有 `agent_runs`，建议未来扩展字段：

- `task_id`
- `agent_session_id`
- `trigger_type`
- `trigger_source_id`
- `requested_by`

语义：

- 一次用户请求、一次自动触发、一次 orchestrator 分配都可以是 run
- run 不等于 session
- run 是执行层对象，不应该继续承担太多工作层含义

### 6.6 RunEvent

表示一次执行中的离散事件。

建议继续保留 `run_events`，但未来增强：

- `event_id`
- `event_family`
- `dedup_key`
- `occurred_at`

语义：

- 事件流是一等公民
- 前端 timeline、回放、调试、重连补偿都依赖它

---

## 7. 单 Agent、多 Agent 与 Task/Conversation 的正确关系

这部分很关键，后续 AI 接手时不要走错方向。

### 7.1 错误理解

“如果要协作，不同 agent 应该共享同一个 session。”

这通常是错的。

原因：

- 不同 provider 的 session 根本不兼容
- 同一 provider 的不同角色 agent 共用 session 也会造成上下文污染
- session 是 provider/runtime 级上下文，不是项目级共享记忆

### 7.2 正确理解

协作时应该共享的是：

- `task`
- `conversation`
- `workspace`
- `task context`
- `artifacts`
- `shared summaries`

而不是共享底层 provider session。

目标关系应当是：

- 一个 `task`
- 可关联一个或多个 `conversation`
- 绑定一个 `workspace`
- 可关联多个 `agent_sessions`
- 每个 `agent_session` 属于一个 `agent`
- 每个 `agent_session` 下有多个 `runs`

举例：

- task A
  - conversation A：用户和 agent 的交互线程
  - session 1: Claude planner
  - session 2: Claude coder
  - session 3: Codex reviewer

它们共享 task/workspace/项目产物，但不共享底层 session。

---

## 8. 推荐的改造顺序

下面是建议交给新 AI 的实现顺序。

### 阶段 1：承认当前 `runs` 是 chat-triggered runs

目标：

- 不急着引入过多抽象
- 先明确当前系统的边界

建议动作：

1. 在文档、类型命名和服务语义上明确：
   - 当前 `conversation` 是交互层对象
   - 当前 `agent_runs` 主要是 chat-triggered runs
2. 不再把 conversation 叙述成长期协作主对象
3. 在 `agent_runs` 上预留 `trigger_type`

完成标准：

- 后续开发不再默认“所有 run 都来自 conversation”

### 阶段 2：稳定当前单 Agent 架构

目标：

- 不破坏当前已可用的 Claude session/resume
- 明确抽出 `AgentSession` 概念

建议动作：

1. 新增 `agent_sessions` 表
2. 将当前 `conversation.agent_session_id` 视为过渡字段
3. 在代码层引入 `AgentSessionService`
4. `agent_runs` 增加 `agent_session_id`
5. `RunManager` 改为：
   - 先查 session
   - 再决定是否 resume

完成标准：

- 同一个 conversation 的连续提问仍能记住上下文
- 某次 run 可明确知道使用了哪个 session

### 阶段 3：引入 Task 层

目标：

- 建立真正的工作层中心

建议动作：

1. 新增 `tasks` 表
2. 允许 conversation 可空关联 `task_id`
3. 允许 run/session 可空关联 `task_id`
4. 前端先最小展示 task 标题/状态，不急着做完整任务系统

完成标准：

- conversation 和 task 正交
- 能表达“围绕某个 task 发生的对话和执行”

### 阶段 4：引入 AgentRuntime 层

目标：

- 把静态 agent 定义和运行实体分开

建议动作：

1. 新增 `agent_runtimes` 表
2. 为当前本地 Claude CLI host 创建一个最小 runtime 记录
3. 将 future-facing 的 `mode / provider / status / heartbeat` 放在 runtime 上
4. `agent_sessions` 绑定 `runtime_id`

完成标准：

- `Agent` 表示能力定义
- `Runtime` 表示具体运行实体
- session 和 run 都不再直接假设只有一个本地 runtime

### 阶段 5：完善 event 基础设施

目标：

- 让前端和重连逻辑更稳

建议动作：

1. 为 `run_events` 增加明确的唯一事件 ID 语义
2. 所有 WS 事件带 `eventId`
3. 前端按 `eventId` 去重
4. 明确协议：
   - WS 负责增量
   - REST 负责历史/重建

完成标准：

- 重连后不会重复渲染卡片
- 前端可以依赖事件顺序和去重机制重建 timeline

### 阶段 6：把 runtime 抽象提升到平台级

目标：

- 为接入 Codex CLI 打基础

建议动作：

1. 重新审视 `AgentRuntime` / `AgentBackend` 接口
2. 保证上层只依赖：
   - execute
   - interrupt
   - maybe resume
   - stream events
3. 不让 `RunManager` 直接依赖 Claude 特有事件细节
4. 将 Claude 特有逻辑继续限制在 `claude/` 子目录中

完成标准：

- 上层业务代码能在不理解 Claude 协议的情况下工作
- 接入新 backend 时主要改 runtime adapter，而不是改全局

### 阶段 7：为多 Agent 协作做最小准备

目标：

- 不立即做 Orchestrator，但把数据模型留口

建议动作：

1. 允许一个 task 下有多个 active sessions
2. conversation 仍可作为交互线程存在，但不再是唯一协作轴
3. run 创建时显式指定使用哪个 session / agent
4. 前端按 agent 维度显示多个运行链
5. 为 future task/orchestrator 留 `trigger_type` 等字段

完成标准：

- 同一 task 里可同时存在多个 agent 的独立 session
- 不同 agent 的上下文不会相互污染

---

## 9. 具体代码层建议

以下是建议优先改动的代码位置。

### 9.1 后端

#### 数据与类型

- `server/src/db/schema.ts`
- `server/src/db/client.ts`
- `server/src/shared/types.ts`

建议：

- 新增 `tasks`
- 新增 `agent_runtimes`
- 新增 `agent_sessions`
- 扩展 `agent_runs`
- 扩展 `run_events`

#### 会话、任务与运行

- `server/src/modules/conversations/conversations.service.ts`
- `server/src/modules/tasks/`（建议新增）
- `server/src/modules/runs/runs.service.ts`
- `server/src/runtime/manager/run-manager.ts`
- `server/src/runtime/base/agent-runtime.ts`

建议：

- 让 `run-manager` 明确依赖 session service
- conversation 不再直接承担全部 session 生命周期逻辑
- task 成为未来协作和状态推进的中心对象

#### Claude runtime

- `server/src/runtime/claude/claude-cli-runtime.ts`
- `server/src/runtime/claude/claude-event-parser.ts`

建议：

- 保持 provider-specific 逻辑只在这里
- `session_bound` 继续由 Claude parser 提供

#### 实时层

- `server/src/sockets/socket-server.ts`

建议：

- 未来加入 `eventId`
- 明确 conversation room 和 run room 的事件模型

### 9.2 前端

- `frontend/src/types/index.ts`
- `frontend/src/store/AppContext.tsx`
- `frontend/src/store/timeline.ts`
- `frontend/src/components/ChatArea/index.tsx`
- `frontend/src/components/TopBar/index.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/services/socket.ts`

建议：

- 未来不要再回到 message-only 模型
- 前端继续围绕：
  - conversation
  - session summary
  - run
  - run events
  - tool timeline

---

## 10. 不建议做的事情

下面这些方向，下一阶段不要做。

### 10.1 不要回到“拼聊天历史喂新 prompt”的假 session 方案

当前已经验证 Claude CLI 的 `--resume <session_id>` 可行。

所以：

- 不要退回到手工拼接历史消息作为主要记忆机制
- 拼历史只能作为极端 fallback，不应作为主方案

### 10.2 不要让不同 Agent 共享同一个底层 session

多 Agent 协作应共享 conversation/task/workspace，而不是共享 provider session。

### 10.3 不要把 Agent 和 Runtime 继续混成一个表

短期方便，长期会让可见性、在线状态、所有权、heartbeat 全部混乱。

### 10.4 不要把 conversation 当成长期唯一中心

conversation 适合承载：

- 用户交流
- tool timeline
- 过程回放

但不适合单独承担：

- 协作分工
- 任务状态机
- squad/leader/subtask 模型

### 10.5 不要急着做完整任务系统

当前阶段最重要的是把核心模型拆稳，不是马上抄一个大型 Linear/Multica。

---

## 11. 最小成功标准

如果新 AI 只做这一轮最重要的结构改造，成功标准应该是：

1. 承认并明确 `task` 是长期协作中心，`conversation` 是交互层
2. 引入正式的 `agent_sessions`
3. 引入正式的 `agent_runtimes`
4. `agent_runs` 显式绑定 `agent_session_id`
5. 现有 Claude session/resume 不回归
6. 前端 timeline 不回退
7. 为多 Agent 协作留下正确模型，而不是错误共享 session

---

## 12. 一句话结论

当前 AgentHub 已经从“聊天模型壳子”走到了“本地 Claude CLI Agent 宿主 MVP”，但下一阶段最重要的不是继续堆页面，而是把核心模型彻底拆成：

- `Task`
- `Agent`
- `AgentRuntime`
- `AgentSession`
- `AgentRun`
- `RunEvent`

同时要明确：

- `conversation` 是交互层
- `task` 是长期协作中心
- `session/run/event` 是执行层

只有这样，后面加 Codex、多 Agent 协作、任务编排、daemon 化和更稳的实时系统时，才不会推倒重来。

---

## 13. 下一轮建议继续追问 Multica 的问题

如果要继续从参考项目获得对 AgentHub 最有帮助的信息，建议优先追问下面这些问题。

### 13.1 关于 Task / Chat / Run 的边界

1. 你们后来有没有让一个 `issue/task` 关联多个 `chat_session`？
2. 一个 `chat_session` 是否也可能脱离 task 独立存在？
3. 一个 `task` 下是否允许多个 agent 同时各自拥有独立 session？

这些问题能帮助确认：AgentHub 未来的 `task <- conversation` 关系应该是一对一、一对多，还是可选关联。

### 13.2 关于执行层拆分

1. 如果重来一次，你们会不会更早把 `TaskRun`、`ChatRun`、`AutopilotRun` 真正拆成三套独立表？
2. 这些 run 之间最后共享了哪些字段，哪些字段事实证明不该共享？
3. 你们是否保留了一个统一的抽象接口，但底层表已经拆开？

这些问题直接对应 AgentHub 现在需要避免的“大宽表”风险。

### 13.3 关于多 Agent 协作

1. squad leader 给成员派发子任务时，成员 agent 拿到的上下文是什么？
2. 是直接共享 issue 全文，还是共享 leader 摘要后的 handoff？
3. agent 之间的协作痕迹最终主要落在 comment/message，还是落在 task/subtask 结构？

这些问题能帮助 AgentHub 判断以后多 Agent 协作应主要共享：

- task 状态
- artifacts
- summary/handoff

中的哪些对象。

### 13.4 关于 Runtime / Session 生命周期

1. runtime 失效后，旧 session 通常还能 resume 吗，还是通常直接废掉？
2. 你们是怎么区分“同一 runtime 恢复”与“新 runtime 重新注册”的？
3. daemon 重新注册后，旧执行上下文是否会迁移，还是全部新建？

这些问题对 AgentHub 以后如果做 daemon 化非常关键。

### 13.5 关于事件与事实来源

1. `task_message` 的去重、重放、分页是怎么处理的？
2. 如果 UI 错过了一段实时事件，最终靠什么补全？
3. 你们有没有后悔没有更早给 trace/message 事件加稳定 event id？

这些问题可以帮助 AgentHub 判断 `run_events` 未来应该增强到什么程度。
