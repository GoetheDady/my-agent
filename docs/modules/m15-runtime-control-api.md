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
src/routes/memory.ts
```

Memory 相关 API 的业务语义属于 [M7 Memory System](./m7-memory-system.md)，路由层归入 Runtime Control API 统一管理。

## 3. 当前状态

当前 API 已支持：

Runtime 控制面 (`src/routes/runtime.ts`)：

- `GET /api/runtime/agents/:id`
- `GET /api/runtime/tasks`
- `GET /api/runtime/tasks/:id`
- `GET /api/runtime/tasks/:id/events`
- `POST /api/runtime/tasks/:id/retry`
- `POST /api/runtime/tasks/:id/cancel`

Memory 观察面 (`src/routes/memory.ts`)：

- `GET /api/memory/episodes` — 按 agentId、时间范围、关键词搜索 episode；支持 `taskId`、`status`（可多值逗号分隔）、`failureType` 过滤。
- `GET /api/memory/episodes/by-task/:taskId` — 按任务 ID 查询对应 episode。
- `GET /api/memory/episodes/:id` — 按 episode ID 查询单条经历。
- 其余 memory 接口的职责边界详见 [M7 Memory System](./m7-memory-system.md)。

本轮 M3 改动对 API 的影响：

- Task 响应包含 progress 与 failure 字段。
- cancel 默认按用户取消处理：`user_canceled / cancel / retriable=false`。
- completed / failed task 重复 cancel 返回 409，并写 `task.cancel.rejected`。

本轮 M7 改动对 API 的影响：

- Episode 查询参数扩展了 `taskId`、`status`（TaskStatus 可多值）和 `failureType`，支持按任务结果或失败类型回看经历。
- 新增按 taskId 和 episode id 的单条查询端点，方便从 Task 详情页直接定位 episode。

## 4. 后续需要补齐

- Task 时间线聚合接口。
- running task 当前步骤视图。
- 控制动作审计筛选。
- 运行诊断接口。
