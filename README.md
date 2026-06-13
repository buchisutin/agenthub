# AgentHub

单用户本地 IM 式多 Agent 编程协作平台。在本地聊天界面中通过 @agent 和 @orchestrator 让多个 AI Agent 并行执行编程任务。

## 核心能力

- **多 Agent 协作**：同时 @ 多个 Agent，Orchestrator 自动拆解和分配任务
- **Workspace 隔离**：每个 Run 在独立 git worktree 或 copy 中执行，互不干扰
- **Diff / Preview**：Run 完成后查看文件变更 Diff，启动本地 Preview
- **Apply / Cleanup**：确认后 Apply 变更到 base workspace，完成后清理临时工作区
- **Dangerous Action Confirmation**：高风险操作（Apply、Cleanup）需要二次确认
- **IM 式交互**：看到 message、plan、run、confirmation 等 rich cards
- **本地优先**：所有数据存储在本地 SQLite，无需云端服务

## 快速启动

```bash
# 安装依赖
cd server && npm install
cd ../frontend && npm install

# 启动后端（终端 1）
cd server && npm run dev

# 启动前端（终端 2）
cd frontend && npm run dev
```

浏览器打开 `http://localhost:5173`。

## 推荐演示流程

1. 打开系统，进入 WorkspaceSetup
2. 输入本地项目路径，点击「验证项目」
3. 点击「创建协作会话」
4. 输入 `@orchestrator 请检查当前项目结构，并建议下一步任务`
5. 查看 PlanCard 和 RunCard
6. Run 完成后查看 Diff、启动 Preview
7. Apply Changes（确认后执行）
8. Clean Workspace（确认后清理）
9. 点击「查看总结」查看协作成果
10. 复制 Markdown 总结

详细演示步骤见：
- [演示指南](docs/demo-guide.md)
- [最终验收文档](docs/final-demo-acceptance.md)
