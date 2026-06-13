# DAG Auto-Merge And Ignore Filter Design

## Goal

修复当前 DAG 协作链路中的三个阻塞问题：

1. diff 与冲突检测错误包含 `node_modules` 等生成目录
2. DAG 任务完成后仍要求用户手动“应用到项目”，导致下游任务无法自动解锁
3. 大量冲突文件一次性渲染导致前端页面卡死

本设计要求在不破坏独立 run 现有手动 apply 体验的前提下，让 DAG 任务走自动合并链路，并将 ignore 规则统一应用到 diff、merge 和冲突检测全过程。

## Scope

本次设计覆盖：

- 后端 diff 文件扫描的 ignore 过滤
- DAG 任务 run 完成后的自动 merge 与调度解锁
- 前端 `RunCard` 的 DAG / 非 DAG 分流显示
- 大量冲突文件时的 UI 防御性渲染
- 针对以上行为的后端与前端回归测试

本次不包含：

- 引入新的外部依赖或 ignore 解析库
- 改造普通独立 run 的手动 apply / apply-and-commit 工作流
- 新增复杂代码编辑器或虚拟滚动列表
- 改造真实 Git 平台 PR 流程

## Product Decisions

### 1. ignore 规则来源

文件过滤优先级为：

1. 读取项目根目录 `.gitignore`
2. 合并内置默认忽略规则
3. 所有 diff、merge、冲突判断都使用同一套过滤结果

内置默认规则固定为：

- `node_modules/`
- `dist/`
- `build/`
- `.next/`
- `.cache/`
- `.turbo/`
- `coverage/`
- `*.lock`
- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`

`.gitignore` 不存在时，仅使用默认规则。

### 2. DAG run 与普通 run 分流

本次明确区分两种 run：

- `plan` 内任务产生的 run：自动 merge
- 非 `plan` 独立 run：维持现有手动 apply

判断标准不依赖前端推断，而是由后端明确返回该 run 的 merge 模式和 merge 状态。

### 3. 冲突处理优先级

冲突处理顺序保持为：

1. 先尝试自动路径
2. 自动无法完成时进入人工审批

本次不会为了实现该功能而强行扩展现有 LLM 能力边界。如果当前服务器未配置可用的冲突自动裁决器，则 DAG 任务在真实冲突场景下直接进入 `conflict_review`，等待用户确认后再继续解锁。

## Architecture

### High-Level Flow

新的 DAG run 完成链路为：

1. Agent 在隔离 workspace 中完成任务
2. `RunsService` 生成已过滤的 `FileChange[]`
3. `MergeService` 使用该过滤后的变更列表执行自动 merge
4. 无冲突则自动写回真实项目目录
5. 有冲突则创建 merge record，并进入审批链路
6. 只有 merge 成功后，Orchestrator 才将任务标记为 `completed` 并 `notifyCompleted`
7. DAG 调度器检查下游依赖满足后自动启动后续任务

### Core Components

#### Ignore Filter Module

新增一个聚焦的 ignore 过滤模块，职责仅包括：

- 读取工作区根目录 `.gitignore`
- 合并默认忽略规则
- 对相对路径做统一 `shouldIgnorePath(filePath)` 判定

该模块应被以下链路复用：

- `server/src/modules/runs/runs.service.ts`
- `server/src/modules/merge/merge.service.ts`
- 任何未来基于文件路径做 run 变更统计或冲突判断的代码

#### RunsService

`RunsService.getFileChanges()` 是本次 ignore 修复的第一入口：

- 非 git diff 路径下，扫描 base / run 目录收集文件集合前必须过滤
- git diff 路径下，`git diff --name-status`、`git ls-files --others` 结果进入 `fileStatuses` 前必须过滤
- 返回的 `FileChange[]` 必须天然不含被忽略路径

这样 `RunCard`、`DiffCard`、`MergeService` 使用同一数据源时，不会再二次出现生成目录文件。

#### MergeService

`MergeService` 不再重新扫描目录差异，而是只消费 `deps.getFileChanges(runId)` 结果。

行为要求：

- 对 DAG run：
  - 过滤后无变更：记为 `auto_merged`
  - 过滤后有变更且无冲突：自动写回主目录，记为 `auto_merged`
  - 有冲突但自动裁决成功：记为 `conflict_resolved`
  - 有冲突且仍需人工：记为 `needs_approval`
- 对普通 run：
  - 保持现有 `RunChangeApplicationService` 的手动 apply 语义

为支持前端分流，`RunCardSummary` 需要补充：

- `mergeMode: "auto" | "manual"`
- `mergeStatus: "pending" | "auto_merged" | "conflict_resolved" | "needs_approval" | "failed" | null`

若存在 merge record，还应补充 merge 摘要信息给前端，用于展示“已自动合并”或“等待冲突处理”。

#### Orchestrator

`OrchestratorService.pollOrchestratedRuns()` 继续作为 DAG 完成判定入口，但语义改为：

- `run completed` 仅表示 Agent 已结束
- `merge success` 才表示 task 真正完成

因此：

- `mergeRecord.status === auto_merged/conflict_resolved`
  - 更新 task 状态为 `completed`
  - 发系统消息确认自动合并结果
  - `scheduler.notifyCompleted(plannerTaskId)`
- `mergeRecord.status === needs_approval`
  - 更新 task 状态为 `in_review`
  - 创建 `conflict_review` 消息
  - 不调用 `notifyCompleted`
- `run failed/interrupted`
  - 保持现有失败传播逻辑，直接 `notifyFailed`

### Detailed Backend Design

#### Ignore Filter Rules

过滤规则处理逻辑：

1. 规则输入统一按 POSIX 路径处理
2. 目录规则如 `node_modules/` 匹配：
   - `node_modules`
   - `node_modules/foo`
   - 任意子目录中的同名段，例如 `packages/a/node_modules/bar`
3. 精确文件规则如 `package-lock.json` 匹配任意层级同名文件
4. 通配文件规则如 `*.lock` 匹配任意层级文件名后缀

本次不实现完整 gitignore 语法子集中的否定规则（如 `!foo`）或复杂双星模式扩展，除非现有仓库已明确依赖这些语义。设计优先最小实现并覆盖当前问题根因。

#### DAG Auto-Merge Mode Detection

run 是否属于 DAG 任务以服务端上下文为准：

- 若 `run.task_id` 对应 task 存在 `plan_message_id`
- 或 Orchestrator 当前 active plan 中存在该 task 的 planner 映射

则视为 `mergeMode = "auto"`。

否则返回 `mergeMode = "manual"`。

此判定需在 run card summary、watcher 和 merge 执行器中保持一致。

#### System Message Semantics

DAG 自动合并成功后发送明确的系统消息：

- 无冲突自动合并：
  - `✅ 任务「{title}」已完成并自动合并，{n} 个文件变更`
- 无变更：
  - `✅ 任务「{title}」已完成，无需合并文件变更`
- 冲突自动解决：
  - `✅ 任务「{title}」已完成，{n} 个冲突已自动解决并合并`

人工冲突审批仍沿用 `conflict_review` 消息类型。

## Frontend Design

### RunCard

`RunCard` 根据 `mergeMode` 分流：

- `manual`
  - 保留当前按钮：
    - 查看 Diff
    - 应用到项目
    - 应用并提交
  - 保留黄色提示：“这些改动还停留在隔离工作区里...”

- `auto`
  - 不渲染手动 apply 按钮
  - 不显示黄色提示
  - 改为展示自动 merge 状态：
    - `pending` → `等待自动合并`
    - `auto_merged` → `已自动合并到项目`
    - `conflict_resolved` → `冲突已自动解决并合并`
    - `needs_approval` → `检测到冲突，等待人工处理`
    - `failed` → `自动合并失败`

### Conflict Review UI

冲突列表增加三层保护：

1. 默认最多渲染前 `20` 个文件
2. 超过 `20` 个时展示“显示更多”
3. 超过 `50` 个时展示顶部警告：
   - `检测到大量冲突文件（N 个），可能是未排除生成目录导致，请检查 .gitignore 配置`

列表展示策略：

- 默认仅显示文件路径和冲突原因
- 不默认渲染整份 diff / 全量文本
- 用户点击单个文件后，才展开该文件的 `Base / Current / Run` 内容

该设计沿用现有 `DiffCard` 的按需展开思路，避免额外引入复杂列表虚拟化逻辑。

## Testing Strategy

### Backend

新增或修改测试覆盖：

1. `RunsService` ignore 过滤
- `.gitignore` 与默认规则共同生效
- `node_modules/`、`dist/`、`package-lock.json` 不出现在 `FileChange[]`

2. `MergeService` DAG 自动合并
- DAG run 无冲突时自动 merge
- DAG run 变更为空时直接完成
- DAG run 冲突时进入 `needs_approval`

3. `OrchestratorService`
- DAG task 在 run 完成后自动 merge 并解锁下游
- DAG task 不出现手动 apply 依赖
- 真实冲突时 task 停留在 `in_review`，下游不启动

### Frontend

新增或修改测试覆盖：

1. `RunCard`
- `manual` run 显示 apply 按钮
- `auto` run 不显示 apply 按钮，显示自动 merge 状态

2. 冲突列表保护
- 超过 20 条时只先显示前 20 条
- 可点击显示更多
- 超过 50 条时出现警告条
- 文件内容默认折叠

### End-to-End Validation

验证场景：

用户输入：

`@orchestrator 写一个 GET /health 接口，然后写测试`

预期：

1. Orchestrator 拆出 Task 1（接口）和 Task 2（测试），Task 2 依赖 Task 1
2. Task 1 自动启动
3. Task 1 完成后自动 merge，不出现“应用到项目”按钮
4. 聊天区出现：
   - `✅ 任务「Scaffold project & health endpoint」已完成并自动合并，3 个文件变更`
5. Task 2 自动进入 `queued/running`
6. Task 2 基于已合并的项目目录继续工作
7. Task 2 完成后自动 merge 并发送系统消息
8. 协作计划显示 `2 / 2 completed`
9. 全过程不出现 `node_modules` 等生成目录文件
10. 除真实冲突审批外，用户不需要手动点击任何 apply 按钮

## Risks And Mitigations

### Risk 1: ignore 规则实现过于简单

风险：若仓库依赖复杂 `.gitignore` 语法，最小匹配器可能覆盖不完整。

缓解：

- 本次实现先覆盖当前明确需要的目录与文件规则
- 若后续发现复杂规则依赖，再独立扩展解析能力

### Risk 2: DAG / 非 DAG 分流不一致

风险：后端 watcher、run summary、前端 RunCard 各自使用不同判断来源。

缓解：

- 统一以服务端返回的 `mergeMode` 和 `mergeStatus` 为准
- 前端只消费，不自行推断

### Risk 3: 冲突数量减少后 UI 保护被误以为不重要

风险：问题 1 修复后大部分场景不再复现大量冲突，导致防御措施被忽略。

缓解：

- 保留超过 20 / 50 的保护逻辑作为长期兜底
- 用测试固定行为，防止后续回退
