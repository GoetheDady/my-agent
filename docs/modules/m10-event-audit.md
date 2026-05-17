# M10 Event & Audit

本文档记录 Event & Audit 的模块边界。以后修改 `src/events/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Event**：运行时事件，记录系统在某个时间点发生了什么。
- **Audit**：审计，保留可检查证据，方便恢复、调试和解释。
- **Payload**：事件携带的结构化数据。

## 1. 模块定位

Event & Audit 是系统事实流水。它不替代 Task 状态，也不替代 Episode 摘要。

它应该负责：

- 写入运行时事件。
- 按 Agent、Task、Conversation 查询事件。
- 给 Runtime API、Dream Worker、调试工具提供证据链。

它不应该负责：

- 执行业务逻辑。
- 生成长期记忆。
- 保存完整任务摘要。

## 2. 当前相关代码

```text
src/events/
```

## 3. 当前状态

当前事件系统已支持：

- SQLite 事件表。
- `appendEvent()` 统一写入。
- 实时广播。
- Task、Tool、Memory、Skill、Channel、Dream、Profile 事件。
- Watchdog 自动检测、修复、恢复、取消和告警事件。
- 统一工具审计事件：`tool.call` 记录工具名、tool call id、参数和开始时间；`tool.result` 记录成功/失败、耗时、输出摘要或错误。

本轮 M3 改动新增或规范了这些事件类型：

- `task.plan.updated`
- `task.step.updated`
- `task.dependency.added`
- `task.dependency.removed`
- `task.dependency.blocked`
- `task.child.created`
- `task.progress.updated`
- `task.failed.classified`
- `task.cancel.requested`
- `task.cancel.rejected`
- `task.canceled`

本轮 M3/M15 改动新增了 Watchdog 审计事件：

- `task.watchdog.detected`：发现异常 task，例如 Web queued 过期、running 租约过期或外部 queued 过期。
- `task.watchdog.canceled`：Watchdog 自动取消 Web 僵尸 queued task。
- `task.watchdog.recovered`：Watchdog 触发 running task 租约恢复流程后的结果记录。
- `task.watchdog.alerted`：需要控制台或用户关注的提醒，例如批量清理、外部队列 drain 请求、审批超时、可重试失败。
- `agent.watchdog.repaired`：修复 Agent running 状态和 current task 不一致。

Watchdog 事件 payload 使用 `reason` 表示原因，并可带 `notificationLevel`：P0 表示需要用户决策或当前会话关注，P1 表示控制台醒目提示，P2 表示只保留审计记录。

Task Plan / Dependency 事件边界：

- `task.plan.updated` 记录某个 Task 的结构化步骤被替换。
- `task.step.updated` 记录步骤状态变化，包括 child task 终态同步。
- `task.dependency.*` 记录依赖添加、移除和领取时被阻塞的事实。
- `task.child.created` 记录 parent task 与 child task 的关联。
- 这些事件是审计事实，不替代 `task_steps` / `task_dependencies` 的当前结构化状态。
- Agent 通过 `task_plan_*`、`task_step_update`、`task_child_create` 和 `task_dependency_*` 工具写入计划和依赖时，仍会同时产生 `tool.call` / `tool.result` 工具审计事件，以及对应的 `task.*` 事实事件。

## 4. 后续需要补齐

- 事件 payload schema 文档。
- 事件严重等级与 `notificationLevel` 的统一规范。
- 事件导出和归档。
- Task timeline 已有 v1，后续需要补 payload schema、过滤条件和导出。
