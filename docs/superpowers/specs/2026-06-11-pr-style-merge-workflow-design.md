# AgentHub PR-Style Merge Workflow Design

## Goal

为 AgentHub 增加本地 PR 式合并工作流：

- Agent 在独立 workspace 完成任务后，不再直接视为 task 完成
- 系统自动对比该 run workspace 与真实项目目录，生成“本地 PR”
- 无冲突文件自动合并到真实项目目录
- 冲突文件优先尝试 LLM 自动裁决，失败时退回人工审批
- 只有变更成功合入真实项目目录后，才通知 DAG 调度器解锁下游任务

本设计基于已经实现的 DAG 调度器能力，不引入新的外部队列或 Git 依赖。

## Scope

本次设计覆盖以下内容：

1. 后端合并服务 `MergeService`
2. run 完成后的自动合并流程
3. 冲突审批数据模型与前端交互
4. DAG 调度器与合并成功事件的联动
5. 真实项目目录作为 main workspace 的直接回写策略

本次不包含：

- 真实 GitHub/GitLab PR 集成
- 远端代码托管平台 webhook
- 浏览器内完整代码编辑器
- 多用户并发审批权限系统

## Product Decisions

### 1. main workspace 的定义

本次实现中，`main workspace` 直接等于用户绑定的真实项目目录。

这意味着：

- 自动合并会直接修改用户项目目录中的文件
- 下游任务创建新 workspace 时，应当基于“已经合并过上游结果的真实目录”
- 不再引入额外的临时主线目录

这样做的好处是 DAG 下游任务可以真正读取到上游任务已经写出的代码，而不是只靠 prompt 中的接口描述。

### 2. 冲突默认处理路径

默认策略为：

1. 先尝试 LLM 自动裁决
2. 如果 LLM 明确认为可安全自动合并，则写回真实目录
3. 如果 LLM 判断有风险、调用失败、文件过大或文件类型不适合自动裁决，则进入人工审批

### 3. “PR” 的含义

本次“PR”是本地工作流对象，不接真实 Git 平台。

用户看到的是：

- 某个 run 对真实项目目录的 diff
- 自动合并或冲突审批的状态
- 合并完成后的系统消息与任务状态变化

## Architecture

### High-Level Flow

完整流转改为：

1. Orchestrator 规划任务，并由 DAG 调度器启动可执行任务
2. Agent 在独立 run workspace 中完成代码修改
3. run 结束后触发合并流程，而不是立刻通知 DAG 完成
4. `MergeService` 对比 run workspace、真实项目目录和 run 的 base 快照
5. 如果可自动合并，则直接写入真实项目目录
6. 如果存在高风险冲突，则生成 `conflict_review` 审批卡片
7. 只有在变更真正进入真实项目目录之后，task 才视为完成，并调用 `scheduler.notifyCompleted(taskId)`

### Core Components

#### MergeService

新建目录：

```text
server/src/modules/merge/
├── merge.service.ts
├── conflict-resolver.ts
└── merge.types.ts
```

职责拆分如下：

- `merge.service.ts`
  - 计算某个 run 的待合并文件
  - 判断文件是否冲突
  - 执行无冲突文件自动写入
  - 调用冲突裁决器
  - 汇总 `MergeResult`

- `conflict-resolver.ts`
  - 封装 LLM 冲突裁决 prompt
  - 输入左右两侧版本、文件路径和任务上下文
  - 输出 `can_auto_merge / merged_content / reason`

- `merge.types.ts`
  - 统一定义 `MergeResult`、`ConflictDetail`、`MergeResolutionDecision`

#### Orchestrator Integration

Orchestrator 不再把 “run completed” 直接当作 “task completed”。

改为：

- run completed: Agent 执行成功，但 task 尚未完成
- merge auto_merged / conflict_resolved: task completed，解锁 DAG 下游
- merge needs_approval: task stays blocked in review，等待用户处理

#### ConflictReviewCard

前端新增：

```text
frontend/src/components/ConflictReviewCard/
└── index.tsx
```

该组件复用现有 `DiffCard` 的展示思路，但聚焦冲突审批，而不是普通 diff 浏览。

## Detailed Backend Design

### MergeService Inputs

`mergeRunToMain(runId, runWorkspacePath, mainWorkspacePath, baseWorkspacePath)`

其中：

- `runWorkspacePath`: 当前 Agent 的隔离工作目录
- `mainWorkspacePath`: 用户真实项目目录
- `baseWorkspacePath`: 该 run 创建时所基于的快照目录

### File Classification Rules

对于 run 的每个变更文件：

1. 先计算 run 相对 base 的变更
2. 再比较真实项目目录中同一路径文件与 base 版本是否不同

分类规则：

- `safe`
  - main 目录中的文件与 base 相同
  - 说明没有其他任务改过这个文件
  - 直接用 run 版本覆盖 main

- `conflict`
  - main 目录中的文件与 base 不同
  - 说明已有其他任务改过该文件
  - 需要裁决

- `manual_only`
  - 文件过大
  - 二进制
  - 生成物/锁文件
  - LLM 调用失败
  - 直接进入人工审批

### LLM Conflict Resolution

LLM 输入必须包含：

- 文件路径
- 当前 task 标题与描述
- 当前 run 的 agent 信息
- Agent 版本文件内容
- 当前真实项目目录版本文件内容
- base 版本文件内容（如果存在）

输出 JSON：

```json
{
  "can_auto_merge": true,
  "merged_content": "complete merged file content",
  "reason": "why this merge is safe"
}
```

使用原则：

- LLM 只能返回“完整文件内容”，不能返回 patch
- 如果模型不能明确给出安全结果，应返回 `can_auto_merge=false`
- 对大文件（>100KB）直接跳过 LLM
- 如果裁决器报错，统一退化为人工审批

### Merge Result Semantics

`MergeResult.status` 语义：

- `auto_merged`
  - 所有变更都无需冲突裁决，或只有安全文件

- `conflict_resolved`
  - 至少一个冲突文件由 LLM 自动裁决并写回成功

- `needs_approval`
  - 至少存在一个仍需人工确认的冲突

### Task Completion Semantics

任务完成语义改为：

- run 成功 != task 完成
- merge 成功写回真实项目目录 == task 完成

推荐状态流：

- task running
- run completed
- merge in review
- merge success -> task completed
- merge needs approval -> task blocked / in_review

## Persistence Design

### Tasks Table

建议在 `tasks` 上增加与合并相关的轻量字段，例如：

- `merge_status`
- `merge_block_reason`

用于让前端和恢复逻辑快速判断当前任务是否卡在合并环节。

### Merge Records Table

新增一张 merge 结果表，例如 `run_merges`：

- `id`
- `run_id`
- `task_id`
- `conversation_id`
- `status`
- `merged_files_json`
- `conflicts_json`
- `created_at`
- `updated_at`

这样可以：

- 在重启后恢复冲突审批状态
- 为前端提供稳定查询来源
- 避免只依赖消息 metadata 恢复复杂审批流程

## Frontend Design

### Conflict Review UI

每个冲突审批卡片展示：

1. 冲突文件列表
2. 每个文件的两边版本
   - Agent version
   - Current main version
3. 如果 LLM 给出建议，同时展示建议合并版本
4. 用户操作按钮
   - 保留 Agent 版本
   - 保留现有版本
   - 采用 LLM 建议
   - 稍后处理

### Why No In-Browser Editor

本次不做浏览器内自由编辑器，原因是：

- 会明显扩大范围
- 会把任务从“工作流”变成“编辑器产品”
- 现有项目已有 diff 展示能力，先做可审批闭环更合适

### Approval Completion Rule

审批策略采用“整次 merge 批量完成后再解锁 task”，而不是逐文件处理即局部解锁。

原因：

- 状态机更简单
- 更容易保证真实目录处于一致状态
- 避免一半冲突已处理、一半未处理时错误解锁下游任务

## DAG Integration

### Unlock Rule

只有在以下两种情况下才调用：

```ts
scheduler.notifyCompleted(taskId)
```

- `auto_merged`
- `conflict_resolved`

以下情况不能解锁：

- run failed
- merge failed
- needs_approval
- user chose 稍后处理

### Workspace Source for Downstream Tasks

下游任务创建 run workspace 时，必须从“当前真实项目目录”派生，而不是从初始 plan 的旧基线派生。

这样可以保证：

- 下游任务真实 `import` 到上游产物
- 测试任务能够运行在真实已合并代码之上
- 减少纯 prompt 协调带来的错配

## Error Handling

### Merge Failures

如果合并过程中出现文件写入失败、路径创建失败或未预期异常：

- 当前 merge 记录标记为 `failed`
- task 不解锁
- 发送 system message 告知用户该任务未能合入

### LLM Resolver Failures

如果 LLM 冲突裁决失败：

- 不报致命错误
- 直接转为 `needs_approval`
- 在冲突详情中记录失败原因

### Large Files

大文件（>100KB）直接走人工审批：

- 不送入 LLM
- 避免 token 膨胀
- 降低延迟和错误率

## Testing Strategy

### Backend Tests

需要覆盖：

1. 无冲突文件自动合并
2. 冲突文件进入 LLM 裁决
3. LLM 成功返回自动合并内容
4. LLM 返回不可安全合并，进入人工审批
5. LLM 调用失败退化为人工审批
6. 大文件直接人工审批
7. 合并成功后 DAG 解锁
8. 需要审批时 DAG 不解锁

### Frontend Tests

需要覆盖：

1. `ConflictReviewCard` 渲染冲突文件
2. 三种选择按钮触发正确请求
3. “稍后处理”保持阻塞态
4. 审批完成后卡片状态更新

## Success Criteria

以下场景全部成立时，本设计视为达标：

1. 上游任务完成后，其无冲突变更自动进入真实项目目录
2. 下游任务从已更新的真实目录创建 workspace
3. 简单冲突可由 LLM 自动裁决并继续 DAG
4. 高风险冲突进入人工审批
5. 人工审批完成后，真实目录更新且 DAG 继续
6. 所有状态可持久化恢复，不依赖瞬时内存消息

## Tradeoffs

### Chosen Tradeoff

本设计选择“直接回写真实项目目录”，优点是 DAG 语义最直接、下游可真实读取上游结果；代价是自动合并逻辑必须足够保守。

### Deferred Work

未来可扩展但本次不做：

- 本地 commit/branch 可视化
- 审批历史回放
- 浏览器内逐行手工编辑冲突
- 合并策略按语言或文件类型定制
- 真实 Git 平台 PR 同步
