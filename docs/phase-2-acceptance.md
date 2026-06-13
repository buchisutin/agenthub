# Phase 2 Acceptance

## Phase 2 能力清单

### Diff Artifact
- `GET /runs/:runId/file-changes`
- completed `RunCard` 可展开 `DiffCard`
- timeline 支持轻量 `file_change_indicator`

### Preview Artifact
- `POST /runs/:runId/preview/start`
- `POST /runs/:runId/preview/stop`
- completed `RunCard` 可启动和停止本地 `PreviewCard`

### Minimal Orchestrator
- 输入 `@orchestrator` 时走隐藏式 planning
- planner 结果拆成普通 runs
- 前端展示 `PlanCard`
- `PlanCard` item 通过 `runId` 关联到对应 `RunCard`

### run_status_changed
- 作为补充 socket 事件发送
- payload 包含 `runId / conversationId / agentId / taskId / status`
- 用于 `PlanCard` 状态更新
- 不替代 `run_completed / run_failed / run_interrupted`

## 明确限制

- `PlanCard` 只保存在前端内存中，不跨刷新恢复
- Diff 基于 `run_events + workspace filesystem` 推断，不是正式 artifact 存储
- Preview 是 run 级内存态，不跨进程重启恢复
- Orchestrator 不落正式 `tasks` 表
- 没有 worktree 隔离，多个 run 仍共享当前 workspace
- 还没有 queue、daemon、approval 闭环增强

## 手工验收脚本

### 1. 普通 `@agent` fan-out
1. 打开一个已绑定 workspace 的 conversation
2. 输入 `@frontend-agent @backend-agent 做一个登录页`
3. 确认生成两个独立 `RunCard`
4. 确认两个 run 可并发 streaming

### 2. `@orchestrator` 生成 PlanCard + 多 RunCard
1. 输入 `@orchestrator 做一个带登录的博客系统`
2. 确认出现一个 `PlanCard`
3. 确认 `PlanCard` 下每个 item 都有对应普通 `RunCard`
4. 点击 `PlanCard` item，确认页面滚动到对应 `RunCard`

### 3. RunCard 查看 Diff
1. 等某个 completed run 结束
2. 点击 `查看代码改动`
3. 确认 `DiffCard` 展开
4. 如果没有改动，确认显示 `本次 run 未检测到文件改动`

### 4. RunCard 启动 Preview
1. 在 completed run 下点击 `启动预览`
2. 确认出现 `PreviewCard`
3. 确认 iframe 地址是 `http://127.0.0.1:<port>`
4. 点击 `新标签页打开`，确认可跳转本地预览

### 5. 中断某一个 run
1. 让同一 conversation 内至少有两个 running runs
2. 点击其中一个 run 的 `中断`
3. 确认目标 run 进入 interrupted
4. 确认其他 run 继续运行

### 6. 多 run 并发下 TopBar 计数
1. 让同一 conversation 内并发运行 2 到 3 个 runs
2. 确认 `TopBar` 显示 `运行中 N`
3. 随着 run 完成或中断，确认计数同步变化

### 7. preview stop 清理
1. 启动某个 run 的 preview
2. 点击 `停止预览`
3. 确认 iframe 消失
4. 确认同页面其他 run 的 diff、preview、timeline 不受影响
