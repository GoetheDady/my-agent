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
- 手动触发运行时诊断或自愈动作。
- 返回清晰中文错误。

它不应该负责：

- 直接执行模型。
- 绕过 Task Store 修改状态。
- 直接写长期记忆。

## 2. 当前相关代码

```text
src/routes/runtime.ts
src/routes/workbench.ts
src/routes/memory.ts
src/routes/skills.ts
```

Memory 相关 API 的业务语义属于 [M7 Memory System](./m7-memory-system.md)，路由层归入 Runtime Control API 统一管理。
Skill 相关 API 的业务语义属于 [M9 Skill System](./m9-skill-system.md)，其中 Skill candidate 审查路由也通过控制面暴露给 Web 或调用方。
Workbench 相关 API 只用于本地开发分支管理，不进入 Agent Task / Event / Memory 主链路。

## 3. 当前状态

当前 API 已支持：

Chat 数据面 (`src/routes/chat.ts`)：

- `POST /api/chat` 接收前端 UI messages、sessionId、agentId 和 thinkingEnabled，并把 Web 输入转成 Task。
- `POST /api/chat` 会等待异步 `runAgentTask()` 完成任务领取、工具构建、prompt 构建和 RAG-in-context 记忆检索准备后，再返回 UI stream response。UI stream response 指前端可消费的模型流式响应。
- 工具审批续跑时会把原始 UI messages 传给 Runtime 的 UI stream response；如果这是 assistant message continuation，会原地更新已有 assistant 消息，避免重复追加用户消息或丢失工具卡上下文。
- Web 流式请求如果遇到目标 Agent 正忙，会通过 `src/routes/chat-busy.ts` 把本次刚创建的 Web task 标记为 `canceled/system_canceled` 并返回 409，避免 Web task 因没有后台 HTTP stream 可接管而永久停留在 queued。

Runtime 控制面 (`src/routes/runtime.ts`)：

- `GET /api/runtime/agents/:id`
- `GET /api/runtime/tasks`
- `GET /api/runtime/tasks/:id`
- `GET /api/runtime/tasks/:id/events`
- `GET /api/runtime/tasks/:id/timeline`
- `GET /api/runtime/tasks/:id/plan`
- `GET /api/runtime/export`
- `GET /api/runtime/backups`
- `PUT /api/runtime/tasks/:id/plan`
- `POST /api/runtime/backup`
- `POST /api/runtime/tasks/:id/dependencies`
- `DELETE /api/runtime/tasks/:id/dependencies/:dependsOnTaskId`
- `POST /api/runtime/watchdog/run`
- `POST /api/runtime/tasks/:id/retry`
- `POST /api/runtime/tasks/:id/cancel`

Workbench Git 控制面 (`src/routes/workbench.ts`)：

- `GET /api/workbench/branches` — 列出未合并到 `main` 的本地分支，包含 base commit、创建时间、diff 统计和疑似依赖。
- `GET /api/workbench/branches/:name/diff` — 返回 `main...branch` 的文本 diff，默认最多 500 行。
- `POST /api/workbench/branches/:name/merge` — 切换到 `main` 后优先执行 fast-forward merge，失败再尝试普通 merge；冲突返回 409。
- `POST /api/workbench/branches/:name/discard` — 强制删除本地分支，必须提交 `{ confirmed: true }`。
- `POST /api/workbench/branches/:name/merge-with-deps` — 按疑似依赖顺序先合并依赖分支，再合并目标分支。

这里的 **fast-forward merge** 指 `main` 没有额外分叉提交时，Git 只移动 `main` 指针完成合并；**疑似依赖** 指分支 B 的 merge-base 等于另一个本地分支 A 的 HEAD，而不是 `main` 的 HEAD。

Memory 观察面 (`src/routes/memory.ts`)：

- `GET /api/memory/episodes` — 按 agentId、时间范围、关键词搜索 episode；支持 `taskId`、`status`（可多值逗号分隔）、`failureType` 过滤。
- `GET /api/memory/episodes/by-task/:taskId` — 按任务 ID 查询对应 episode。
- `GET /api/memory/episodes/:id` — 按 episode ID 查询单条经历。
- 其余 memory 接口的职责边界详见 [M7 Memory System](./m7-memory-system.md)。

本轮 M3 改动对 API 的影响：

- Task 响应包含 progress 与 failure 字段。
- cancel 默认按用户取消处理：`user_canceled / cancel / retriable=false`。
- completed / failed task 重复 cancel 返回 409，并写 `task.cancel.rejected`。
- 新增 `POST /api/runtime/watchdog/run`，手动触发一次 Task Watchdog 扫描，返回 `{ scanned, canceled, recovered, alerted, repaired }`。
- Watchdog 会通过 Runtime events 暴露 `task.watchdog.*` 和 `agent.watchdog.repaired`，用于解释自动取消、恢复、告警或 Agent 状态修复。
- 该接口不新增业务规则，只复用 Task System 的 watchdog 实现；正常控制动作仍应通过 Task Store 和 Runtime API 完成。
- 新增 `GET /api/runtime/tasks/:id/timeline`，返回 Task、Episode、当前进度视图和事件时间线。它是只读聚合接口，不新增数据源。
- Task timeline 响应现在包含 `plan.steps`、`dependencies` 和 `children`，用于解释单个任务的计划、阻塞原因和子任务。
- 新增 Task Plan / Dependency 控制面 API：可读取/替换计划步骤、添加依赖和删除依赖。缺失 task 返回 404；计划覆盖冲突或依赖校验失败返回 409。
- `PUT /tasks/:id/plan` 在已有步骤关联 child task 时返回 409，避免覆盖计划后留下 orphan child task。

本轮 M7 改动对 API 的影响：

- Episode 查询参数扩展了 `taskId`、`status`（TaskStatus 可多值）和 `failureType`，支持按任务结果或失败类型回看经历。
- 新增按 taskId 和 episode id 的单条查询端点，方便从 Task 详情页直接定位 episode。

本轮 M14 改动对 API 的影响：

- 新增 `POST /api/runtime/backup`，触发一次 SQLite 热备份，并在返回前执行旧备份清理。这里的“热备份”指服务不中断时创建一致性快照。
- 新增 `GET /api/runtime/backups`，列出运行时数据目录下已有的 SQLite 备份文件。
- 新增 `GET /api/runtime/export`，返回结构化 JSON 导出，包含 agents、tasks、sessions 和 messages 等 SQLite 元数据。
- 当前 `export` 不包含 LanceDB 向量内容，只返回记忆导出说明和数量占位；这是有意保持的边界，避免把大体积 embedding 数据塞进控制面响应。

本轮 M9 改动对 API 的影响：

- `GET /api/skills/candidates` 列出正式 Skill candidate；支持按 `agentId` 和 `status` 过滤。
- `POST /api/skills/candidates/:id/accept` 会把候选转成正式 Skill，并写入候选审查记录。
- `POST /api/skills/candidates/:id/reject` 会把候选标记为 rejected，保留审查备注。
- 这组 API 让 Skill candidate 从兼容 review item 变成可操作的正式闭环。

本轮 RAG-in-context 改动对 API 的影响：

- Chat 数据面没有新增 HTTP 参数或返回字段，但 `src/routes/chat.ts` 现在会 `await runAgentTask()`，因为 Runtime 需要在返回模型流之前完成相关长期记忆检索。
- 记忆检索失败不会改变 HTTP 状态码；失败会在 Prompt & Context 层降级为空记忆片段，Chat API 仍继续返回正常 stream 或原有错误。
- 这次改动不新增 `/api/memory` 控制面接口；长期记忆的主动查询、episode 查询和管理仍由现有 Memory API 承担。
- RAG-in-context 指“检索增强的上下文注入”：系统先检索相关长期记忆，再把少量片段放入本轮模型上下文。

## 4. 后续需要补齐

- LanceDB、Agent 文件目录和 SQLite 的统一恢复接口；当前 Runtime API 只提供 SQLite 备份和结构化导出。
- Task timeline v1 已有，后续补过滤、分页、payload schema 和跨父子任务串联。
- running task 当前步骤视图已有基础，后续补模型 step、token 用量和更细工具状态。
- 控制动作审计筛选。
- 运行诊断接口。
- Watchdog 运行历史和最近一次扫描耗时。
- Chat / Runtime timeline 展示 RAG-in-context 检索状态，例如命中数量、过滤数量和检索失败降级原因。
- Web 多消息排队体验：当前策略是忙碌时拒绝并取消本次 Web task；后续如果要支持真正排队，需要后台 runner 和前端通知协议共同接管。
- Chat API 对缺失 `sessionId` 仍保留兼容兜底；后续可以把新版 Web 客户端的缺失 sessionId 视为 400，以便更早暴露前端状态错误。
