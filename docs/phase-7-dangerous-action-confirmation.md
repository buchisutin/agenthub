# Phase 7: Dangerous Action Confirmation

AgentHub 是单用户本地 AI 编程协作平台。高风险操作（apply changes、cleanup workspace）需要用户二次确认后才能执行。

## 设计原则

- **单用户本地工具** — 不是多用户审批系统
- `approval_requests` 是内部表名，产品语义是 confirmation（确认）
- 不做 RBAC、不做审计大屏、不做多用户审批流
- 高风险动作：apply changes、cleanup workspace、cleanup conversation workspaces

## 数据模型

### approval_requests 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| conversation_id | TEXT FK | conversations.id |
| run_id | TEXT FK (nullable) | agent_runs.id |
| task_id | TEXT FK (nullable) | tasks.id |
| assignment_id | TEXT FK (nullable) | task_assignments.id |
| action_type | TEXT | apply_changes / cleanup_workspace / cleanup_conversation_workspaces |
| status | TEXT | pending / approved / rejected / executed / failed / cancelled |
| title | TEXT | 显示标题 |
| description | TEXT (nullable) | 详细说明 |
| payload_json | TEXT (nullable) | 操作参数 |
| result_json | TEXT (nullable) | 执行结果 |
| error_message | TEXT (nullable) | 错误信息 |
| created_at | TEXT | 创建时间 |
| decided_at | TEXT (nullable) | 确认/取消时间 |
| executed_at | TEXT (nullable) | 执行时间 |

### 状态流转

```
pending ──approve──→ approved ──execute──→ executed
   │                     │
   └──reject──→ rejected  │
                          └──exec error──→ failed
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /conversations/:id/approvals | 获取会话确认列表 |
| GET | /approvals/:id | 获取单个确认 |
| POST | /approvals/:id/approve | 确认并自动执行 |
| POST | /approvals/:id/reject | 取消（不执行） |
| POST | /runs/:id/apply-changes | mode=request 创建确认, mode=execute 直接执行 |
| POST | /runs/:id/workspace/cleanup | mode=request 创建确认, mode=execute 直接执行 |
| POST | /conversations/:id/workspaces/cleanup | mode=request 创建确认, mode=execute 直接执行 |

## Timeline 集成

`GET /conversations/:id/timeline` 返回新增 `confirmation` 类型：

```json
{
  "type": "confirmation",
  "approval": { ... }
}
```

排序：message → plan → run → confirmation

## 前端 UI

### ConfirmationCard

- **pending**: 黄色边框，显示 "Needs confirmation" 徽章，Confirm / Cancel 按钮
- **executed**: 绿色边框，显示 "Executed" 徽章，无按钮
- **rejected**: 灰色边框，显示 "Cancelled" 徽章，无按钮（产品语义是 Cancelled，内部状态是 rejected）
- **failed**: 红色边框，显示 "Failed" 徽章，显示错误信息

### 风险等级

- apply_changes: medium risk（黄色 RiskBadge）
- cleanup_workspace / cleanup_conversation_workspaces: high risk（红色 RiskBadge）

### Apply Changes 流程

1. 点击 Apply Changes → 执行 apply-check
2. 如有 conflict → 显示 conflict panel，不创建确认
3. 如无 conflict → 创建 approval_request (action_type=apply_changes, status=pending)
4. RunCard 下显示 ConfirmationCard
5. 用户点击 Confirm → approve + execute → 显示 Executed / Applied
6. 用户点击 Cancel → reject → 显示 Cancelled

### Cleanup Workspace 流程

1. 点击 Clean workspace → 创建确认
2. 显示 ConfirmationCard
3. Confirm → 执行 cleanup → 显示 cleaned
4. Cancel → 不执行

## execute mode 限制

`mode: "execute"` 保留给测试和内部调用。前端用户路径必须全部使用 request/confirmation 模式。单用户本地工具中，execute mode 不应暴露给 UI。

## 当前限制

- 无多用户审批流
- 无 RBAC / 权限系统
- 无审批超时策略
- 无策略引擎自动风险分类
- 无 tool-level 沙箱
- 无企业审计大屏
- conversation cleanup 确认在 TopBar 以 toast 提示，确认卡片在聊天区显示
