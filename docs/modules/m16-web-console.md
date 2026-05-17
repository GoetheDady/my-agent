# M16 Web Console

本文档记录 Web Console 的模块边界。以后修改 `web/` 前端控制台、聊天布局、运行时面板或前后端联调逻辑时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Web Console**：Web 工程控制台。这里指用于观察、调试和管理 Agent Runtime 的前端界面，不是系统架构中心。
- **Runtime Snapshot**：运行时快照。这里指某个 Agent 当前状态、任务列表和最近事件的组合视图。
- **Task Queue**：任务队列。这里指某个 Agent 的排队任务和最近任务展示，不等同于全部历史任务归档。
- **selected Agent**：当前选中的 Agent。前端 store 中的 `selectedAgentId`，用于决定控制台查看哪个 Agent。

## 1. 模块定位

Web Console 负责把后端 Runtime 的状态以可观察、可操作的方式展示出来。

它应该负责：

- 聊天入口和会话切换。
- Agent、Task、Event、Tool、Skill、Memory、Channel 等控制台页面。
- 展示后端 API 返回的运行状态。
- 发起安全的控制动作，例如刷新、取消任务、更新工具策略。
- 保持 UI 状态和后端 Agent-scoped 数据一致。

它不应该负责：

- 绕过后端 Runtime 直接执行模型或工具。
- 直接写 `.my-agent/` 运行时数据。
- 把前端页面作为系统架构中心。
- 在前端重新实现 Task、Memory、Channel 的业务规则。

## 2. 当前相关代码

```text
web/src/App.tsx
web/src/layouts/ChatLayout.tsx
web/src/layouts/ConsoleLayout.tsx
web/src/pages/
web/src/features/
web/src/store/
web/src/lib/
web/src/styles/globals.css
```

与本模块强相关的后端接口：

```text
src/routes/chat.ts
src/routes/runtime.ts
src/routes/agents.ts
src/routes/sessions.ts
src/routes/tools.ts
src/routes/skills.ts
src/routes/channels.ts
src/routes/memory.ts
```

## 3. 当前状态

当前 Web Console 已支持：

- 聊天页和控制台分离布局：`ChatLayout` 负责聊天侧边栏和会话入口，`ConsoleLayout` 负责工程控制台导航。
- 会话路由：`/` 新对话入口，`/sessions/:sessionId` 查看持久会话。
- 控制台路由：`/console`、`/console/tasks`、`/console/events`、`/console/tools`、`/console/skills`、`/console/memory`、`/console/channels` 等页面。
- Agent 会话侧边栏按 Agent 分组展示会话，并支持选择当前 Agent。
- Runtime 面板展示 Agent 状态、当前任务、排队任务、最近任务和最近事件。
- Chat 页面通过 `/api/chat` 流式对话，并保留工具审批卡片。
- Chat transport 会在手动发送和审批自动续发时统一带上当前 `sessionId`、绑定 Agent 和 thinking 开关，避免批准工具后创建额外“新对话”。
- 实时连接通过 `/api/ws` 推动会话、运行时、工具、记忆和 Skill 相关刷新。

## 4. 本轮改动影响

近期修复了 Runtime 控制台的 Agent 和 Task 展示一致性问题：

- `RuntimeSummary` 现在读取 `useAgentStore.selectedAgentId`，并按当前选中的 Agent 拉取运行时快照。
- 刷新按钮和取消 queued task 后的刷新也会使用当前 Agent，避免控制台固定看 `default`。
- Task Queue 现在优先展示 queued task，然后展示最新历史任务。
- 任务历史展示从“后端返回数组前 12 条”改为“按 `created_at` 新到旧取 12 条”，避免旧任务把新完成任务挤出页面。
- `runtimeStore.fetchRuntimeSnapshot()` 会对 `agentId` 做 URL 编码，避免 Agent ID 中的特殊字符破坏请求路径。

这次改动不改变后端 Task Store 的排序语义，只修正前端控制台的观察视图。

本轮修复了聊天工具审批续跑问题：

- `web/src/lib/chatTransport.ts` 统一构建 `DefaultChatTransport`，自动续发审批响应时也会读取当前会话、Agent 和 thinking 状态。
- `web/src/lib/toolApprovalContinuation.ts` 在用户批准或拒绝工具审批后显式提交 continuation 请求，并按 tool call 去重，避免审批卡片只闪一下但不继续执行。
- `ChatPage` 对已经处于 approved / denied 的历史审批卡片会自动补续跑，用于恢复刷新页面后卡住的工具调用。
- `ChatPage` 不再只在用户手动发送时传 body，避免工具审批续跑请求缺少 `sessionId`。
- `src/sessions/service.ts` 提供 assistant 消息原地替换能力，支持后端把审批后的工具输出更新回原消息。
- 影响面只限 Web 聊天与会话持久化，不改变后端 Runtime 的 Agent 单线程模型。

本轮新增了 Task Watchdog 的控制台可见性：

- `runtimeStore` 支持解析 `task.watchdog.*` 与 `agent.watchdog.repaired` 事件，并转换为中文事件标题。
- `RuntimeTask` 类型补齐 progress、failure、lease、attempt 等可观察字段，Task 卡片会展示系统自动取消、失败原因或运行进度。
- `RuntimeSummary` 会从最近事件里提取 P0/P1 watchdog 提醒，例如批量清理 Web 僵尸任务、外部队列告警、审批超时或 Agent 状态修复。
- 这部分只做观察与提示，不在前端实现自动状态修复；所有修复动作仍由后端 Task Watchdog 和 Runtime API 完成。

本轮新增了 Task timeline 控制台详情：

- Task 卡片可选中，并通过 `GET /api/runtime/tasks/:id/timeline` 加载单个任务详情。
- 详情面板展示任务输入、状态、Agent、渠道、attempt、lease、失败分类、当前工具、最近输出、episode 摘要和正序事件时间线。
- 详情面板会展示 Task Plan steps、Dependency blockers 和 child tasks；blocked task 会通过 progress message 解释正在等待依赖。
- Watchdog 提醒如果能定位到 task，会点击打开对应任务详情。
- 这仍是观察面能力；前端不保存新的任务状态，也不重新实现 Task / Event / Episode 业务规则。

## 5. 当前边界

- Web Console 只是观察和控制面，真实执行仍由后端 Runtime、Task System 和 Channel System 负责。
- Task Queue 页面不是完整任务归档；它当前展示 queued task 和最近历史任务。
- 控制台必须尊重 Agent-scoped 数据边界，所有运行时快照都应带上目标 Agent。
- Web 构建产物在生产模式下由 3100 端口后端服务读取 `web/dist` 提供。

## 6. 后续需要补齐

- Task timeline 已有 v1，后续补事件过滤、payload 展开和跨父子任务串联。
- Task 详情页已有基础，后续补更强的诊断建议、重试入口、事件 payload 展开和计划编辑入口。
- 控制台级实时连接：直接进入 `/console` 时也应建立订阅或 fallback 轮询。
- Watchdog 提醒详情页：从提示跳转到对应 task/event 时间线。
- Agent 切换器：控制台侧边栏需要能显式切换当前 Agent，而不只显示当前 Agent。
- Memory evidence 展示：让记忆能看到来源消息、Task 和事件证据。
- Skill diff / provenance：展示 Skill 内容差异、来源和更新时间。
- Channel message tracing：从外部消息追到 conversation、task、event 和投递结果。
- 前端路由 fallback：未知路径应回到聊天布局或明确跳转，避免裸 `ChatPage`。
