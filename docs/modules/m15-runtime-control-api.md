# M15 Runtime Control API

本文档记录 Runtime Control API 的模块边界。以后修改 `src/routes/` 中的运行时控制接口时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Control API**：控制面接口，用于观察和管理运行时状态。
- **Runtime State**：运行状态，包括 Agent、Task、Event、队列和进度。
- **409 Conflict**：HTTP 冲突状态，表示请求和当前资源状态冲突，例如已完成任务不能取消。

## 1. 模块定位

Runtime Control API 负责暴露后端运行状态和安全控制动作。

它应该负责：

- 查询 Agent 状态。
- 查询 Task 列表和单个 Task。
- 查询 Task 事件时间线。
- 触发 retry / cancel 等控制动作。
- 返回清晰中文错误。

它不应该负责：

- 直接执行模型。
- 绕过 Task Store 修改状态。
- 直接写长期记忆。

## 2. 当前相关代码

```text
src/routes/runtime.ts
```

## 3. 当前状态

当前 API 已支持：

- `GET /api/runtime/agents/:id`
- `GET /api/runtime/tasks`
- `GET /api/runtime/tasks/:id`
- `GET /api/runtime/tasks/:id/events`
- `POST /api/runtime/tasks/:id/retry`
- `POST /api/runtime/tasks/:id/cancel`

本轮 M3 改动对 API 的影响：

- Task 响应包含 progress 与 failure 字段。
- cancel 默认按用户取消处理：`user_canceled / cancel / retriable=false`。
- completed / failed task 重复 cancel 返回 409，并写 `task.cancel.rejected`。

## 4. 后续需要补齐

- Task 时间线聚合接口。
- running task 当前步骤视图。
- 控制动作审计筛选。
- 运行诊断接口。
