# Phase 2.0 Manual Acceptance

1. 启动前后端，打开一个已绑定 workspace 的 conversation。
2. 依次发送 `@frontend-agent`、`@backend-agent`、`@tester-agent` 三条慢任务，确认页面出现 3 个独立 `RunCard`，并且都能同时进入 `running`。
3. 中断其中一个 `RunCard`，确认该卡片进入 `interrupted`，另外两个 run 继续流式输出。
4. 刷新页面，确认历史 runs 仍按各自 agent 卡片展示，没有被合并成单条流。
5. 发送一条同时包含两个 mention 的消息，例如 `@frontend-agent @backend-agent 做登录页`，确认创建两个 run，两个卡片的 prompt 都是不带已识别 mention 的任务文本。
6. 发送包含未知 mention 的消息，例如 `@unknown-agent 修一下页面`，确认不会报错，仍只创建一个默认 agent run。
