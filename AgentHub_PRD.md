# AgentHub — 多 Agent 协作平台 产品需求文档（PRD）

> **版本**: v1.0  
> **日期**: 2026-05-19  
> **状态**: 初稿  

---

## 1. 项目背景

随着大语言模型（LLM）与 AI Agent 技术的快速演进，单一 Agent 已难以满足复杂开发与协作场景的需求。多 Agent 协作——即多个具备不同能力的 AI Agent 在统一平台上协同完成任务——正在成为提升研发效率的关键范式。

当前主流 Agent 平台（Claude Code、Codex 等）虽能力强大，但彼此割裂，缺乏统一的交互入口与协调机制。开发者在实际工作中往往需要在多个工具之间频繁切换，导致上下文丢失、协作效率低下。

AgentHub 正是在这一背景下提出的：打造一个运行在开发者本机上的多 Agent 协作工作台，以 IM 聊天为交互形态、以 Orchestrator 为协调核心，让开发者像使用飞书或微信一样自然地与多个本地 Coding Agent 对话、派发任务、审查成果。

## 2. 产品定位

AgentHub 是一个面向开发者的本地 IM 聊天式多 Agent 协作平台。它以 Electron 应用或 localhost Web 服务的形态运行在用户自己的机器上，将多个异构 Coding Agent CLI（如 Claude Code、Codex CLI）统一到一个对话界面中，通过自然语言驱动任务拆解、代码生成、审查与执行的全流程。

**核心价值主张**：一个对话窗口，调度本机上的所有 Agent，在用户自己的项目目录中完成从需求到代码修改的完整闭环。

## 3. 目标用户

**主要用户**：全栈开发者、技术团队负责人、独立开发者，熟悉 AI 辅助开发工具，希望在统一平台上高效利用多个 Agent 能力。

**次要用户**：产品经理、技术写作者等非纯开发角色，需要通过自然语言与 Agent 协作完成文档、原型、调研等工作。

## 4. 产品目标

**短期目标（MVP）**：实现基础的多 Agent 单聊与群聊能力，支持至少两个主流 Coding Agent CLI 的本地接入，完成核心 Orchestrator 任务拆解流程。

**中期目标**：完善代码 Diff、网页预览、命令执行结果回放等全流程功能；优化 Orchestrator 的任务理解与分配策略；支持更多 Agent 平台接入。

**长期目标**：构建开放的本地 Agent 生态，支持第三方 Agent 插件接入；实现跨项目的 Agent 协作编排。

## 5. 功能需求

### 5.1 统一适配器层（Adapter Layer）

AgentHub 需要构建一个统一的本地 Runtime 适配器层，将不同 Coding Agent CLI 的能力差异抽象为一致的接口。

**功能要求**：
- 定义标准化的 Agent Runtime 协议，包括进程启动参数、输入/输出事件格式、支持的工具类型、上下文窗口限制等
- 适配至少两个主流 Coding Agent CLI（如 Claude Code、Codex CLI），实现进程拉起、事件流解析、结果回传的统一封装
- 支持 Agent 能力的动态注册与发现，新增 Agent 无需修改核心代码
- 提供健康检查与状态监控，实时感知各 Agent CLI 的可用性与运行状态
- 处理不同 Agent 的本地配置、权限策略、中断恢复与错误重试

### 5.2 IM 聊天交互层

仿照飞书/微信的聊天体验，提供自然、直觉的对话交互。

**单聊模式**：
- 用户与单个 Agent 进行一对一对话，支持上下文连续、多轮交互
- 支持发送文本、代码片段、文件附件等多种消息类型
- 展示 Agent 的思考过程、工具调用、命令执行与文件变更结果

**多会话并行**：
- 支持同时开启多个独立会话，每个会话绑定不同的 Agent 或任务
- 会话之间互不干扰，支持快速切换
- 提供会话列表、搜索与归档管理

**群聊协作**：
- 在同一对话中引入多个 Agent，通过 `@AgentName` 指令定向派发任务
- Agent 之间可在群聊中进行接力式协作（如 Agent A 生成代码、Agent B 审查代码）
- 支持单个用户作为"群主"角色，对 Agent 的输出进行确认、修改或驳回

### 5.3 Orchestrator 协调器

Orchestrator 是 AgentHub 的"大脑"，负责理解用户意图、拆解复杂任务、决定每一步交给哪个本地 Agent CLI 执行，并监控执行过程。

**任务拆解**：
- 接收用户的高层需求描述，自动拆解为可执行的子任务序列
- 识别子任务之间的依赖关系，生成 DAG（有向无环图）执行计划
- 支持用户对拆解结果进行预览、调整与确认

**智能分配**：
- 根据各 Agent 的能力标签、当前忙闲状态与任务类型，将子任务分配给最合适的本地 Agent
- 支持分配策略的可配置化（如优先速度、优先质量、本地资源占用优先等）

**执行监控**：
- 实时追踪每个子任务对应 CLI 进程的执行状态（排队中、执行中、等待确认、已完成、失败）
- 在子任务失败时提供自动重试、切换 Agent 或降级方案
- 将各子任务的结果汇总整合，形成最终输出

### 5.4 代码 Diff 与审查

**功能要求**：
- 以 side-by-side 或 inline 模式展示 Agent 生成的代码变更
- 支持逐行批注与讨论，可在 Diff 视图中直接 `@Agent` 要求修改
- 提供语法高亮，支持主流编程语言
- 支持一键采纳或驳回变更
- 保留完整的修改历史与版本对比

### 5.5 网页预览

**功能要求**：
- 对 Agent 生成的前端代码（HTML/CSS/JS、React 组件等）提供实时渲染预览
- 支持桌面端与移动端视口切换
- 预览环境与代码编辑联动，修改后自动刷新
- 支持控制台输出查看，方便调试

### 5.6 一键部署

**功能要求**：
- 对 Agent 生成的项目提供本地运行、构建或预览的快捷入口
- 支持调用本地开发命令并展示运行日志
- 支持基础的环境配置（环境变量、运行时版本等）
- 为后续集成外部部署平台预留扩展点

## 6. 非功能需求

### 6.1 性能

- 消息发送与 Agent 响应首字延迟应在 2 秒以内
- 支持至少 5 个会话同时活跃，互不阻塞
- Orchestrator 的任务拆解应在 5 秒内完成
- 代码 Diff 渲染在 1000 行以内应流畅无卡顿

### 6.2 可用性与体验

- 聊天界面遵循 IM 产品的交互惯例，学习成本低
- 支持 Markdown 渲染、代码块高亮、图片/文件预览
- 提供完善的加载状态、错误提示与空状态引导
- 响应式布局，适配桌面端主流分辨率

### 6.3 可扩展性

- 适配器层设计为插件化架构，新增 Agent 平台接入的开发成本不超过 2 人天
- Orchestrator 的任务拆解策略支持配置化或插件化替换
- 前端组件库模块化，便于后续功能扩展

### 6.4 安全性

- Agent 的 API 密钥与本地 CLI 配置存储在本机，不暴露给前端
- 不以多租户为目标，但应保证不同本地会话之间的工作目录和历史记录互不污染
- Agent 执行的命令应具备基础的权限控制、中断能力与风险提示
- 本地前后端通信应限制在 localhost 或 Electron 内部通道

## 7. 系统架构

### 7.1 整体架构

系统采用本地前后端一体化架构，核心分为四层：

**前端展示层**：基于 React 构建 IM 聊天界面、代码 Diff 视图、预览面板与运行控制台。通过 WebSocket 实现消息的实时推送。

**本地服务层**：基于 Node.js 运行本地 HTTP/WebSocket 服务，对外暴露 RESTful API 与 WebSocket 接口，负责会话管理、事件转发与本地状态存储。

**业务逻辑层**：包含 Orchestrator 协调器、会话管理、消息处理、运行控制等核心模块。Orchestrator 不负责云端资源调度，而是负责本地任务拆解、Agent 指派与执行汇总。

**Agent Runtime 适配层**：通过统一适配器接口拉起和管理各 Agent CLI 进程。每个适配器封装特定 CLI 的启动参数、stdout/stderr 事件解析和进程控制逻辑，对上层暴露一致的 Agent 能力接口。

### 7.2 关键技术选型

- 前端框架：React + Vite + TailwindCSS
- 实时通信：WebSocket（Socket.IO）
- 后端框架：Node.js 本地服务
- 数据库：SQLite 或文件存储
- Agent Runtime：Claude Code CLI、Codex CLI
- 工作目录管理：本地项目目录 + 独立工作目录或 git worktree
- 可选封装形态：Electron 或 localhost Web 应用

### 7.3 核心数据模型

**会话（Conversation）**：id, type（single/group）, title, created_at, updated_at, participants[]

**消息（Message）**：id, conversation_id, sender_type（user/agent/system）, sender_id, content, content_type, metadata, created_at

**任务（Task）**：id, conversation_id, parent_task_id, description, status, assigned_agent_id, input, output, created_at, completed_at

**Agent（Agent）**：id, name, platform, capabilities[], status, config, adapter_type

**运行实例（AgentRun）**：id, conversation_id, task_id, agent_id, workspace_path, pid, status, started_at, completed_at, exit_code

## 8. 用户旅程

### 8.1 场景一：单 Agent 对话开发

用户创建新会话，选择 Claude Code 作为对话 Agent。用户输入"帮我用 React 写一个 Todo 应用"。本地服务在用户机器上拉起 Claude Code CLI 进程，在当前项目目录或独立 worktree 中执行任务，并将事件流实时推送到界面。用户在 Diff 视图中查看修改，在预览面板中实时查看效果，确认后运行本地预览命令。

### 8.2 场景二：多 Agent 群聊协作

用户创建群聊，拉入 Claude Code 和 Codex 两个 Agent。用户输入需求"开发一个带用户认证的博客系统"。Orchestrator 自动将需求拆解为后端 API 开发、前端页面开发、数据库设计三个子任务，并展示执行计划供用户确认。确认后，Orchestrator 在本地依次或并行拉起不同 Agent CLI 进程执行对应子任务。用户在群聊中看到各 Agent 的进展，可随时 `@Agent` 进行追问或调整。最终结果汇总后，用户审查代码 Diff、预览效果并运行本地项目。

### 8.3 场景三：Orchestrator 驱动的复杂任务

用户输入"重构当前项目的认证模块，从 Session 迁移到 JWT，要求向后兼容"。Orchestrator 分析需求后拆解为：分析现有认证代码、设计 JWT 方案、编写迁移代码、编写兼容层、编写测试用例。各子任务按依赖顺序在本地启动对应 Agent CLI 进程执行，每步结果供用户审查确认后再继续下一步。

## 9. 里程碑与排期

### Phase 1 — 基础框架搭建（第 1–2 周）

- 搭建本地前后端项目骨架
- 实现基础 IM 聊天界面（会话列表、消息收发、Markdown 渲染）
- 实现 WebSocket 实时通信链路
- 搭建统一适配器层框架，完成一个本地 Agent CLI 的接入

### Phase 2 — 核心功能开发（第 3–4 周）

- 实现群聊与 @指令功能
- 开发 Orchestrator 协调器的任务拆解与分配能力
- 完成第二个 Agent CLI 的适配接入
- 实现代码 Diff 展示与基础审查功能

### Phase 3 — 全流程打通（第 5–6 周）

- 实现网页预览功能
- 实现本地运行/预览功能
- 完善 Orchestrator 的执行监控与异常处理
- 端到端集成测试与性能优化

### Phase 4 — 打磨与交付（第 7–8 周）

- UI/UX 细节打磨与体验优化
- 文档编写（用户文档、技术文档、演示材料）
- 压力测试与安全审查
- 最终演示准备

## 10. 风险与应对

**本地 Agent CLI 的兼容性与稳定性**：不同 Agent CLI 的输出格式、版本兼容性和行为可能存在差异。应对措施为适配器层做好抽象隔离，同时实现版本检测、事件解析容错与降级机制。

**Orchestrator 任务拆解的准确性**：对于模糊或复杂的需求，Orchestrator 的自动拆解可能不够准确。应对措施为采用"拆解-确认-执行"的交互模式，让用户在执行前审查与调整任务计划。引入拆解质量的反馈闭环，持续优化 Prompt。

**多 Agent 协作的上下文同步**：不同 Agent 之间可能存在上下文信息不一致的问题。应对措施为设计统一的上下文管理模块，在任务分配时向 Agent 注入标准化的背景信息、工作目录和约束条件。

**本地资源占用与并发控制**：同时运行多个 Agent CLI 进程可能导致 CPU、内存与磁盘占用过高。应对措施为增加并发上限、任务队列、运行超时和进程中断机制。

**前端复杂度与性能**：IM 聊天 + 代码 Diff + 实时预览的组合对前端性能有较高要求。应对措施为采用虚拟列表、懒加载、Web Worker 等优化手段，必要时对重计算组件进行拆分与异步渲染。

## 11. 成功指标

- 用户能在 5 分钟内完成首次 Agent 对话并在本地项目目录中得到可执行的代码输出
- Orchestrator 对中等复杂度需求的任务拆解准确率达到 80% 以上
- 从需求输入到本地预览跑通的端到端流程可在 15 分钟内走通
- 群聊模式下多 Agent 协作的任务完成率不低于 70%
- 系统在 5 个并行会话下的消息响应延迟 P95 小于 3 秒

## 12. 附录

### 12.1 术语表

| 术语 | 说明 |
|------|------|
| Agent | 本地运行的 Coding Agent CLI，具备对话、代码生成、工具调用、命令执行等能力 |
| Orchestrator | 任务协调器，负责需求理解、任务拆解与本地 Agent 调度 |
| Adapter | 适配器，封装特定 Agent CLI 的进程控制与事件流差异，提供统一接口 |
| Diff | 代码差异对比视图，用于展示代码变更 |
| DAG | 有向无环图，用于描述子任务之间的依赖与执行顺序 |

### 12.2 参考资料

- Claude Code 官方文档
- OpenAI Codex 官方文档
- MCP（Model Context Protocol）协议规范
- 飞书开放平台设计规范


难点一：CLI 进程的生命周期管理与事件流解析
问题背景
Claude Code 和 Codex 都是设计给人在终端里交互的本地 CLI 工具。你的 AgentHub 要用 Node.js 的 child_process.spawn() 去启动它们、读它们的 stdout、往它们的 stdin 写东西。这不是调 REST API，是在管理一个有状态的、持续输出的子进程。
具体会碰到这些问题：
第一，JSON 分块问题。Claude Code 的 --output-format stream-json 输出的是换行符分隔的 JSON（NDJSON），但 Node.js 的 stdout.on('data') 回调拿到的不是完整的一行，而是任意大小的 buffer chunk。一个 JSON 对象可能跨两个 chunk，也可能一个 chunk 里有好几个 JSON 对象。这是社区公认的"第一大坑"——Khan Academy 开源的 format-claude-stream 项目和多篇博客都明确提到这一点。有个开发者在做 PATAPIM（一个能同时跑 9 个 Claude Code 会话的 Electron 应用）时，最初假设每次 onData 回调包含完整 JSON，结果立刻就崩了。
第二，两个 CLI 的事件协议完全不同。Claude Code 的 stream-json 输出的事件类型包括 assistant、user、result、system、stream 等，而 Codex 的 codex exec --json 输出的是 thread.started、item.completed、turn.completed 这种结构。你需要把两套完全不同的事件 schema 映射成 AgentHub 自己的统一事件格式。
第三，进程可能卡住或异常退出。CLI 进程可能因为 API 限流而长时间无响应（Claude Code 会发出 system/api_retry 事件，但 Codex 不一定有），可能因为等待用户审批而阻塞，可能因为网络断开而静默挂死。你的进程管理器必须区分"正在思考"、"被限流了"、"在等审批"和"真的死了"。
第四，Codex 的 headless 能力还不完善。有一个 GitHub issue（openai/codex#4219）专门提到 Codex CLI 不是为非交互式自动化设计的，在 non-TTY 环境下可能 panic 或阻塞。社区甚至出现了 codex-headless 这个 fork 来补这个缺。
如何解决
核心方案是构建一个带缓冲的 NDJSON 解析器 + 进程看门狗 + 统一事件映射层。
对于 JSON 分块，参考 backgroundclaude.com 博客给出的 30 行 Node.js 消费者模式：维护一个字符串 buffer，每次 data 事件到来时追加到 buffer，然后循环查找换行符，逐行取出完整 JSON 解析。Khan Academy 的 format-claude-stream 也是这个方案。关键代码逻辑：
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    // 解析 line 为 JSON 并分发
  }
});
对于事件协议统一，定义一个 AgentHub 内部事件枚举（如 text_delta、tool_started、tool_finished、file_changed、approval_needed、error、completed），每个适配器负责把各自 CLI 的原始事件映射过来。Claude Code 的 stream 类型中 event.delta.type == "text_delta" 映射到你的 text_delta，Codex 的 item.completed 中 item.type == "agent_message" 也映射到 text_delta。
对于进程看门狗，参考 Overstory 项目的三层监控方案：第零层是机械守护（检查 pid 是否存活、tmux 会话是否在），第一层是 AI 辅助的故障分类，第二层是监控 Agent 做持续巡检。AgentHub 的 MVP 做到第零层就够——定时检查进程状态，超时未输出则标记为疑似卡死，给前端发 warning 事件。
对于 Codex 的兼容性，MVP 阶段建议优先走 codex exec --json 这条路，它是官方支持的非交互模式，输出 JSONL 格式。如果需要多轮对话能力，可以参考 codex-headless fork 的做法，用 --session-id 实现会话恢复。
需要怎么测试，达到什么效果
测试一：构造一个 mock CLI 脚本，模拟 Claude Code 的 stream-json 输出，故意在 JSON 对象中间切分 chunk（比如一个 200 字节的 JSON 对象分三次发出），验证解析器能正确缓冲和拼接，不丢事件、不崩溃。覆盖率目标：100% 的事件类型都能被正确解析。
测试二：同时启动 3 个 CLI 进程，验证各自的事件流独立、不串流。具体方法是每个进程发送带会话 ID 的事件，前端侧校验接收到的事件按会话正确分组。
测试三：模拟进程异常退出（kill -9）、超时（60 秒无输出）、限流（发送 retry 事件），验证看门狗能在 5 秒内检测到异常并通知前端。
测试四：对 Claude Code 和 Codex 各跑 10 个真实任务（如"分析这个文件"、"写一个 hello world"），统计事件映射的完整性——每个原始事件都必须被映射到 AgentHub 事件或被明确忽略，不能有"未知事件类型"的静默丢弃。

难点二：Orchestrator 的任务拆解与跨 Agent 上下文传递
问题背景
Orchestrator 要做两件事：把用户的自然语言需求拆成可执行的子任务，然后把子任务分配给不同的 Agent，同时保证 Agent 之间的上下文连贯。
任务拆解本身就不简单。用户说"开发一个带用户认证的博客系统"，Orchestrator 需要判断这应该拆成几个子任务、哪些可以并行、哪些有依赖关系。拆得太粗（"做前端"+"做后端"）则 Agent 无从下手，拆得太细（"创建 users 表的 migration 文件"）则 Orchestrator 自己的 Prompt 会膨胀到不可控。
Claude Code 官方的 Agent Teams 功能已经在实践中暴露了这个问题：Orchestrator 的上下文窗口会随着子任务数量线性增长。每个子 Agent 返回的结果都要追加到 Orchestrator 的上下文里，10 个子任务每个产出 2000 token，Orchestrator 就要承载 20000+ token 的累积状态，还没算它自己的规划逻辑。官方文档显示 Agent Teams 有 10 个同时子 Agent 和 200 个任务的硬限制。
更难的是跨 Agent 上下文传递。Claude Code 和 Codex 各自维护独立的上下文窗口，它们之间没有共享记忆。Agent A 改了三个文件，Agent B 要基于这些改动继续工作。你不能只把 A 的文字回复丢给 B——B 需要看到文件系统的实际变化。
Claude Code Agent Teams 的解决方案是基于共享文件（一个磁盘上的 JSON 任务列表）做协调，Agent 之间不直接通信，而是通过读写共享文件来感知彼此的进展。但这要求所有 Agent 在同一个文件系统里工作。
如何解决
参考现有项目的做法，有三个层次的方案：
第一层：共享工作目录 + 文件系统作为通信层。 这是 Claude Code Agent Teams 和 ccswarm 项目的核心思路。所有 Agent 都在同一个 git 仓库的不同 worktree 里工作，但共享同一个 .git 对象库。Agent A 完成任务后提交到自己的分支，Orchestrator 把 A 的分支 merge 到 B 的 worktree 里（或者直接让 B 在 A 的 worktree 里继续工作），这样 B 就能看到 A 的所有文件改动。Overstory 项目更进一步，用 SQLite 实现了一个消息邮件系统，Agent 之间通过类型化的协议消息通信（如 worker_done、merge_ready、dispatch、escalation）。
第二层：上下文摘要注入。 在把任务分配给 Agent B 时，不是把 Agent A 的完整输出丢过去，而是让 Orchestrator 生成一份精简的上下文摘要（"Agent A 已完成用户认证 API 的开发，创建了 /api/auth/login 和 /api/auth/register 两个端点，使用 JWT，token 存在 Redis 里"），连同子任务描述一起注入 Agent B 的 Prompt。这样 B 的上下文窗口不会被 A 的完整日志淹没。关键是摘要的粒度要恰到好处——太粗则 B 缺信息，太细则失去摘要的意义。
第三层：Orchestrator 自身的分层架构。 参考 Addy Osmani 提出的层级分解模式——不要让一个 Orchestrator 直接管理所有子 Agent，而是设计成 Orchestrator → Feature Lead → Worker 三层结构。Orchestrator 只和 2-3 个 Feature Lead 通信，每个 Feature Lead 再管理自己下面的 Worker。这样 Orchestrator 的上下文窗口保持精简。但对于 MVP，两层结构（Orchestrator → Worker）足够。
对于 AgentHub 的 MVP，推荐方案是：Orchestrator 本身用一个 LLM 调用来做任务拆解（输入用户需求 + 项目结构摘要，输出子任务 JSON），子任务之间的依赖关系用一个简单的 DAG 表示。执行时，所有 Agent 共享同一个项目目录，通过 git 分支隔离各自的改动，Orchestrator 在切换 Agent 时自动 merge 上一个 Agent 的变更并生成上下文摘要。
需要怎么测试，达到什么效果
测试一：准备 10 个不同复杂度的需求描述（从"写一个 hello world"到"开发一个带认证的 REST API"），让 Orchestrator 拆解，人工评审拆解质量。评审标准：子任务是否可执行（一个 Agent 能独立完成）、依赖关系是否正确、是否有遗漏。目标准确率 80% 以上。
测试二：设计一个两步依赖场景——Agent A 创建一个数据库模型文件，Agent B 基于这个模型写 API。验证 Agent B 启动时能正确感知 Agent A 的文件改动（通过 git diff 或直接读文件），且 Orchestrator 注入的上下文摘要包含必要信息。判定标准：Agent B 不需要重复询问数据库 schema 就能开始工作。
测试三：Orchestrator 上下文膨胀测试。模拟 5 个子任务顺序执行，每个子任务返回约 2000 token，监控 Orchestrator 在分配第 5 个任务时的 Prompt 总 token 数。目标：通过摘要机制将累积上下文控制在 5000 token 以内（而非 10000+）。
测试四：异常路径测试。子任务执行失败时，Orchestrator 应能检测到并提供重试或跳过选项。模拟 Agent 返回错误，验证 Orchestrator 不会继续把后续依赖任务分配下去。

难点三：前端多会话实时状态展示与交互
问题背景
用户可能同时开着 3-5 个会话，每个会话里一个 CLI 在跑，不断吐出事件。前端要同时接收和渲染这些异步事件流，还要在群聊模式下处理多个 Agent 交错输出的情况。
PATAPIM 的开发者提到了核心痛点："tmux 给你终端复用，但不给你会话智能。你没法一眼看出哪个 Agent 在思考、哪个在等审批、哪个已经完成。" Parallel Code 项目的用户也反馈：当 5 个 Agent 同时运行时，人在终端之间不停切换，注意力被严重碎片化。
具体的前端挑战包括：
第一，流式渲染性能。Agent 的文本输出是一个字一个字蹦出来的（typewriter effect），同时可能有工具调用事件、文件变更事件穿插其中。如果消息列表很长（比如一个长对话有上百条消息），每次新 token 到来都触发 re-render，性能会严重下降。
第二，Agent 状态检测与展示。前端需要从事件流中实时推断每个 Agent 当前的状态（空闲、思考中、执行命令、等待审批、出错）。PATAPIM 的开发者尝试过用自然语言启发式去猜状态，结果"脆弱且不断出错"。最终的解决方案是优先用 stream-json 的结构化 type 字段判断，只在必要时回退到简单的正则匹配。
第三，群聊中多 Agent 交错输出的展示。两个 Agent 可能同时在输出，消息流怎么交错展示？如果简单地按时间戳排序，用户会看到两个 Agent 的 token 交替出现，完全无法阅读。
第四，审批交互的优先级。当一个 Agent 请求审批（比如要执行 rm -rf 这种危险命令），这个请求需要在 UI 上以高优先级弹出，不能淹没在消息流里。但同时其他 Agent 可能还在正常输出，审批弹窗不能阻塞整个界面。
如何解决
流式渲染：参考 Parallel Code 和 Claude Code Desktop 的做法，用虚拟列表（virtual scrolling）只渲染可视区域内的消息。正在流式输出的消息单独管理——用 useRef 而非 useState 来追踪当前 token buffer，只在达到一定阈值（如每 50ms 或每 100 个字符）时批量刷新 DOM，而不是每个 token 都触发 re-render。对于已完成的消息，渲染完整 Markdown 后缓存渲染结果。
状态检测：建立一个有限状态机（FSM），根据事件流驱动状态转移。收到 text_delta → 状态切到"正在输出"；收到 tool_call_started → "正在执行工具"；收到 permission_request → "等待审批"；收到 result → "已完成"；超过 30 秒无事件 → "疑似卡住"。状态机的好处是转移逻辑是确定性的、可测试的，不依赖启发式猜测。
群聊交错输出：不要按 token 级别交错展示，而是按"消息块"级别。每个 Agent 的一次连续输出视为一个消息块，块与块之间才交错。具体实现：为每个 Agent 维护一个独立的输出 buffer，前端按 Agent 分栏展示（类似分屏），或者等一个 Agent 的当前回合结束后再展示下一个 Agent 的输出。Parallel Code 项目选择的是分栏方案——每个任务一个独立的终端面板，用户通过侧边栏切换。
审批交互：审批请求独立于消息流，用全局的通知队列管理。收到 permission_request 事件时，在界面顶部或侧边弹出一个持久化的审批卡片（不是一闪而过的 toast），显示哪个 Agent 在哪个会话里请求执行什么命令，提供"批准"和"拒绝"按钮。Claude Code 的 stream-json 协议已经支持通过 stdin 发送 control_response 来回应权限请求。Codex 的 approval mode 也有类似机制。
需要怎么测试，达到什么效果
测试一：渲染性能压测。模拟一个会话中 500 条历史消息 + 一条正在流式输出的消息（每秒 50 个 token），测量滚动帧率。目标：在主流笔记本上保持 30fps 以上，输入延迟（从 token 到达 WebSocket 到渲染上屏）不超过 100ms。
测试二：多会话并发渲染。同时开 5 个会话，每个会话都有活跃的流式输出，在会话之间快速切换（每 2 秒切一次）。目标：切换时无白屏、无消息丢失、无 UI 冻结，切换延迟不超过 200ms。
测试三：状态机覆盖测试。构造一组事件序列，覆盖所有状态转移路径（空闲→思考→执行工具→等待审批→批准→继续输出→完成；空闲→思考→出错），验证每个状态转移后 UI 显示的状态标签正确。
测试四：审批流程端到端测试。Agent 请求执行一个命令 → 前端弹出审批卡片 → 用户点"批准" → 后端向 CLI 进程的 stdin 发送批准响应 → Agent 继续执行。验证整个链路在 3 秒内完成，审批结果正确传达。

难点四：工作区隔离与 Git Worktree 管理
问题背景
当多个 Agent 同时在同一个项目上干活，如果它们共用一个工作目录，就会互相踩踏——Agent A 改了一个文件，Agent B 在此基础上又改了一遍，两边的 git status 里混着对方的改动，最终不知道哪些变更属于哪个任务。
这不是理论风险。多个开源项目（ccswarm、Overstory、Bernstein、Parallel Code）都把 Git Worktree 隔离作为第一要务来实现，说明社区已经在实践中反复踩过这个坑。一篇详细的博客分析了三种具体的失败模式：静默覆盖（Agent B 把 Agent A 改的文件又写了一遍，没有任何冲突提示）、Git 历史分叉（两个 Agent 都提交了，rebase 时产生的冲突引用的是两个人类都没写过的代码）、stash 泄漏（一个 Agent 的实验性 stash 出现在另一个 Agent 的 debrief 里）。
此外，Worktree 隔离了文件系统，但没有隔离所有东西。两个 Agent 的集成测试可能都想占用 3000 端口、都想连同一个开发数据库、都想读同一个环境变量文件。
如何解决
参考 Parallel Code、Agent Orchestrator (Composio) 和 Bernstein 的做法：
每个会话/任务创建一个独立的 Git Worktree。当用户在 AgentHub 中创建一个新的 Agent 会话时，后端自动执行 git worktree add ../project-session-{id} -b session/{id} main，CLI 进程在这个隔离目录里启动。Agent 的所有文件读写都限制在这个 worktree 内。会话结束后，用户选择 merge 或丢弃，然后 git worktree remove 清理。
自动化分支管理。Parallel Code 的做法是：创建任务时自动创建分支和 worktree，任务完成后在侧边栏提供一键 merge 按钮，merge 完自动清理。AgentHub 可以直接复用这套流程。
端口和资源冲突的缓解。对于 MVP，最简单的做法是在 Agent 的 Prompt 里注入约束（"使用端口 300{session_number} 而非默认端口"），或者在 worktree 目录里放一个 .env.local 覆盖端口配置。更完善的方案是 Bernstein 的做法——用 Docker 容器或 E2B Firecracker 微虚拟机做完全隔离，但这对 MVP 来说太重。
磁盘清理。Worktree 会累积占磁盘空间。参考社区实践，需要一个清理策略：会话关闭且用户确认后自动 remove、定期扫描超过 7 天未活跃的 worktree 提示清理、在 UI 里提供 worktree 列表和手动清理入口。
需要怎么测试，达到什么效果
测试一：同时启动两个 Agent 会话，分别让它们修改同一个文件的不同部分。验证两个会话的 git diff 完全独立，各自只看到自己的改动。
测试二：会话 A 完成并 merge 到 main 后，创建会话 B。验证 B 的 worktree 基于最新的 main 分支创建，能看到 A 的改动。
测试三：模拟异常场景——会话进行到一半时用户关闭浏览器。后端应检测到 WebSocket 断开，保留 worktree 和 CLI 进程状态（或安全终止），用户重新打开时可以恢复。
测试四：累积 10 个已关闭的 worktree 后，验证清理机制能正确移除，git worktree list 输出干净，磁盘空间被回收。

难点五：统一适配器层的抽象设计
问题背景
Claude Code 和 Codex 虽然都是 coding agent CLI，但它们的协议、能力和行为差异很大。
Claude Code 用 --output-format stream-json --input-format stream-json 实现双向通信，支持 --continue 和 --resume 做会话恢复，通过 --permission-prompt-tool stdio 实现程序化的权限审批，有完善的 hooks 和 MCP 集成。但它的 --input-format stream-json 协议至今官方文档不全（GitHub issue #24594 明确指出这一点），社区项目不得不靠逆向工程。
Codex 用 codex exec 做非交互执行，输出 JSONL，支持 --sandbox（read-only/write/network-off）和 --approval-mode（auto/suggest/ask），通过 --session-id 做会话恢复。但它的 headless 能力被社区认为不如 Claude Code 成熟——有人专门为此做了 codex-headless fork。
如果你的适配器层抽象得不好，每加一个新 Agent 就要改一大堆代码，上层的 Orchestrator 和前端也要跟着改。
如何解决
参考 Overstory 项目的 AgentRuntime 接口设计。它定义了一个通用的 runtime 契约，每个适配器只需要实现这些方法：spawning（启动进程）、config deployment（注入配置到工作目录）、guard enforcement（权限控制）、readiness detection（检测 Agent 是否就绪）、transcript parsing（解析事件流）。
对于 AgentHub，核心接口大约是：

startSession(workdir, config) → 返回 session handle
sendMessage(sessionId, message) → 向 CLI 的 stdin 写入
onEvent(sessionId, callback) → 注册事件流监听
respondToApproval(sessionId, requestId, approved) → 回应权限请求
interrupt(sessionId) → 发送 SIGINT
resumeSession(sessionId) → 恢复中断的会话
closeSession(sessionId) → 终止并清理

每个适配器（ClaudeCodeAdapter、CodexAdapter）实现这套接口，内部处理各自 CLI 的特殊性。上层代码（Orchestrator、前端 WebSocket 推送）只依赖这个接口，不关心底层是 Claude Code 还是 Codex。
Agent Orchestrator (Composio) 的做法更进一步——它的插件系统不仅抽象了 Agent（支持 Claude Code、Codex、Aider），还抽象了 Runtime（tmux、ConPTY、Docker）和 Tracker（GitHub、Linear）。每一层都是可插拔的。但对 MVP 来说，只做 Agent 层的抽象就够了。
需要怎么测试，达到什么效果
测试一：写一个 MockAgent 适配器（不启动真实 CLI，只模拟事件流），验证上层的 Orchestrator 和 WebSocket 推送层能正常工作。这证明接口抽象是干净的——上层不依赖任何具体 CLI 的细节。
测试二：分别用 ClaudeCodeAdapter 和 CodexAdapter 执行同一个简单任务（"读取 package.json 并列出依赖"），验证两者向前端推送的事件序列在语义上一致（都包含 text_delta → completed），虽然底层原始事件格式完全不同。
测试三：写一个新的 DummyAdapter（比如模拟一个只会 echo 的假 Agent），评估开发成本。目标：一个熟悉项目的开发者在 4 小时内能完成一个新适配器的接入，不需要修改 Orchestrator 或前端的任何代码。
测试四：适配器的错误隔离测试。Claude Code 进程崩溃时，Codex 的会话不受影响。反之亦然。验证一个适配器的故障不会扩散到整个系统。