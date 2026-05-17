# M3 Task System

本文档是 `docs/project-module-map.md` 中 M3 Task System 的模块级文档。以后修改 `src/tasks/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Task**：任务。Agent 的最小执行单元，Web 消息、外部渠道消息、委派请求最终都应该转成 Task。
- **Queue**：队列。按顺序保存待执行 Task 的结构。
- **Lease**：租约。Task 运行时的有效期，执行器会续约；过期表示执行进程可能卡住或已经重启。
- **Retry**：重试。失败或卡住的 Task 重新排队执行。
- **Recovery**：恢复。服务启动或巡检时发现异常 Task，并把它恢复为可执行状态或标记为最终失败。
- **Idempotency**：幂等。同一个外部请求重复提交时，只产生一次 Task。
- **Outcome**：任务结果，包括成功、失败、取消、是否可重试和失败发生阶段。
- **Observability**：可观察性，指系统能暴露任务当前阶段、最近进展和失败位置。
- **Task Plan**：任务计划。这里指一个 Task 下的结构化步骤列表，不等同于模型自动规划。
- **Task Dependency**：任务依赖。这里指一个 queued Task 必须等待另一个 Task completed 后才能被领取。

## 1. 模块定位

Task System 是整个 `my-agent` 的执行入口层。所有输入都应该先变成 Task，再由 Runtime 执行。

它需要保证：

1. 同一个 Agent 同一时间只运行一个 Task。
2. Task 状态变化可追踪。
3. Task 失败可解释。
4. Task 卡住可恢复。
5. 外部重复消息不会重复创建 Task。
6. Task 的执行过程能给 Memory、Skill、Profile 和 Event 提供可靠素材。

Task System 不负责直接调用模型，也不负责发渠道消息。它只负责定义、保存、领取、重试、取消、恢复 Task。

## 2. 当前相关代码

```text
src/tasks/
├── task-store.ts
├── task-queue.ts
├── task-plan-store.ts
├── task-tools.ts
└── watchdog.ts
```

相关调用方：

```text
src/runtime/agent-runtime.ts
src/runtime/internal-runner.ts
src/channels/service.ts
src/channels/external-runner.ts
src/delegations/service.ts
src/routes/runtime.ts
src/events/event-log.ts
```

相关数据表：

```text
tasks
task_steps
task_dependencies
agents
events
```

## 3. 当前已有能力

### 3.1 Task 生命周期

当前 Task 生命周期是：

```text
queued -> running -> completed
                  -> failed
                  -> canceled
```

状态含义：

- `queued`：等待执行。
- `running`：已被某个 Agent 领取并正在执行。
- `completed`：执行成功。
- `failed`：执行失败。
- `canceled`：被取消。

### 3.2 单 Agent 单线程

Task queue 会检查 Agent 当前状态，避免同一个 Agent 同时领取多个 Task。

这是项目核心设计，不是临时限制。一个 Agent 应该像人一样一次专注处理一个任务。如果要并行推进，应该创建多个 Agent 分工。

### 3.3 可靠性字段

`tasks` 表已有这些可靠性字段：

- `attempt_count`：实际执行次数。
- `max_attempts`：最大执行次数，默认 3。
- `lease_expires_at`：租约过期时间。
- `idempotency_key`：幂等键。
- `canceled_at`：取消时间。
- `failure_type`：结构化失败类型，例如 `model_error`、`timeout`、`lease_expired`。
- `failure_stage`：失败阶段，例如 `model_call`、`delivery`、`recovery`。
- `retriable`：系统判断是否适合重试。
- `progress_status`：当前执行阶段，例如 `waiting`、`calling_model`、`persisting_result`。
- `progress_message`：面向 CLI/API/UI 的中文短状态。
- `last_progress_at`：最近进展时间。
- `parent_task_id`：父任务 id，用于表达子任务归属。
- `plan_step_id`：子任务对应的父任务步骤 id。

### 3.4 领取与租约

Task 被领取时：

1. 状态改为 `running`。
2. 写入 `started_at`。
3. 设置 `lease_expires_at`。
4. 递增 `attempt_count`。
5. 更新 Agent 当前任务。

Runtime 执行期间会续约。完成、失败、取消时清理租约并释放 Agent。

### 3.5 重试与恢复

当前已有：

- `retryTask()`：把失败或租约过期的 running Task 重新排队。
- `recoverRunningTasks()`：启动时恢复租约过期的 running Task。
- 超过最大执行次数时标记为最终失败。

### 3.6 事件审计

Task 相关事件包括：

- `task.started`
- `task.plan.updated`
- `task.step.updated`
- `task.dependency.added`
- `task.dependency.removed`
- `task.dependency.blocked`
- `task.child.created`
- `task.completed`
- `task.failed`
- `task.failed.classified`
- `task.progress.updated`
- `task.cancel.requested`
- `task.cancel.rejected`
- `task.canceled`
- `task.recovered`
- `task.retry_scheduled`
- `task.failed_permanently`
- `task.lease.renewed`
- `task.watchdog.detected`
- `task.watchdog.canceled`
- `task.watchdog.recovered`
- `task.watchdog.alerted`
- `agent.watchdog.repaired`

### 3.7 Task Watchdog

`src/tasks/watchdog.ts` 集中负责运行期间的异常巡检和保守自愈。

当前策略：

- Web queued 超过默认 60 秒会被标记为 `canceled / system_canceled`，并写入 `task.watchdog.detected` 与 `task.watchdog.canceled`。
- Web queued 批量清理超过 3 条时额外写入 P1 级 `task.watchdog.alerted`，用于控制台醒目提示。
- running task 租约过期时复用 `recoverRunningTasks()`，恢复为 queued 或达到最大次数后失败，并写入 `task.watchdog.recovered`。
- Agent 处于 running 但 `current_task_id` 缺失或不再指向 running task 时，修复为 idle，并写入 `agent.watchdog.repaired`。
- Feishu / delegation queued 超时不自动取消，只写 watchdog detected / alerted，并请求外部队列 drain。
- pending approval 超时只写 `task.watchdog.alerted`，不替用户批准或拒绝。
- failed 且 retriable 的任务只写提醒事件，不自动重试。

Watchdog 不新增数据库表，所有解释性信息通过 `tasks` 字段和 `events` 审计记录暴露。

### 3.8 Task Plan 与 Dependency v1

当前已支持最小计划和依赖能力：

- `task_steps` 保存某个 Task 的计划步骤，包含顺序、标题、详情、状态和可选 child task。
- `task_dependencies` 保存 task-level 依赖，依赖未完成时 queued task 不会被队列领取。
- `claimNextTask()` 和 `claimNextTaskForChannels()` 会跳过依赖未完成的 queued task。
- `claimTask()` 遇到依赖未完成时不会领取任务，会把进度标记为 `blocked / 等待依赖任务完成`，并写入 `task.dependency.blocked`。
- `createTask()` 支持 `parent_task_id` 和 `plan_step_id`；带 `plan_step_id` 的 child task 进入 completed / failed / canceled 终态时，会同步更新对应 step 状态。
- `task-tools.ts` 暴露 Agent 可调用的 planning tools：读取计划、写计划、更新步骤状态、按步骤创建 child task、维护 child task 依赖。
- 这些工具只允许操作当前运行 Task 及其直接 child tasks，避免 Agent 越权改写无关任务树。
- `task_child_create` 复用 DelegationService 创建委派子任务，并把 child task 绑定到父任务和对应 plan step。

当前 v1 不做：

- LLM 自动拆解任务。
- step-level dependency。
- 完整 DAG 调度。
- 依赖失败后的自动取消或自动重试。
- 改变同一 Agent 单线程执行模型。
- Web 规划编辑器。

## 4. 模块边界

Task System 应该负责：

- 创建 Task。
- 查询 Task。
- 领取 Task。
- 更新 Task 状态。
- 管理 attempt、lease、retry、recovery。
- 写入 Task 生命周期事件。
- 保证 Agent 单线程执行边界。

Task System 不应该负责：

- 直接调用模型。
- 直接执行工具。
- 直接发送飞书、微信或 Web 消息。
- 直接写 `agent.json`。
- 直接生成长期记忆。
- 决定 prompt 内容。

这些职责分别属于 Runtime、Tool、Channel、Agent Config、Memory 和 Prompt 模块。

## 5. 当前不足

### 5.1 Task outcome 仍需继续细化

当前 Task 已经能保存基础 outcome，但失败分类仍是系统级分类，还没有覆盖所有工具和业务失败语义。

缺少：

- 工具调用失败的统一错误结构。
- 权限失败、模型失败、渠道失败的更细分类。
- 可重试判断和 retry 策略的联动。

### 5.2 Episode 负责经历摘要

Task 不再承担“完整经历单元”的职责。经历摘要属于 Episode，长期沉淀属于 Memory / Dream / Skill。

M3 只提供：

- 任务输入。
- 任务状态。
- 任务 outcome。
- 任务进度。
- 任务事件素材。

### 5.3 失败分类已进入 v1

- `model_error`
- `tool_error`
- `permission_denied`
- `timeout`
- `lease_expired`
- `user_canceled`
- `system_canceled`
- `context_missing`
- `unknown`

### 5.4 Task 计划和依赖已有 v1，仍缺自动规划和复杂调度

复杂任务已经可以表达为步骤、子任务和 task-level 依赖。
Agent 也已经可以通过 runtime planning tools 主动写入这些结构。

后续仍需要设计：

- 等待、暂停、恢复。
- LLM 自动生成计划。
- 完整父子任务汇总。
- DAG 级调度和跨 Agent 协作时间线。

### 5.5 外部渠道幂等还没全面接入

Task Store 已支持 `idempotency_key`，但外部渠道需要稳定生成并传入，例如：

- 飞书 message id。
- 微信 message id。
- 未来 webhook event id。

### 5.6 运行中可观察状态已有基础

当前已有：

- `progress_status`
- `progress_message`
- `last_progress_at`
- `task.progress.updated`
- `task.progress.updated` payload 可带轻量 metadata，例如当前工具名、tool call id 和最近输出摘要；这些信息只进 Event，不新增 Task 表字段。

后续还缺：

- 最近续约时间。
- 更细粒度的卡住原因和用户可见诊断建议。

本轮 Task / Runtime timeline 改动对 M3 的影响：

- Task 表仍只保存当前状态、最终结果、失败分类、进度和租约字段。
- 单个任务的完整执行链路不写入 Task 表，而是通过 Task timeline 只读聚合视图从 Event 和 Episode 读取。
- `tool.call` / `tool.result` 成为工具调用审计事实；Task 只通过 progress metadata 暴露“当前工具”和“最近输出”的轻量状态。

## 6. 完整目标

Task System 完整后应该达到：

1. 任何输入都能变成可追踪 Task。
2. 同一 Agent 永远不会无意并发执行多个 Task。
3. Task 执行失败时能说明稳定失败类型。
4. 进程重启或模型卡住后能恢复或最终失败。
5. 外部消息重复投递不会创建重复 Task。
6. 每个 Task 终态都有清晰 outcome，可供 Episode 生成经历摘要。
7. Memory、Skill、Profile 通过 Episode / Dream 做沉淀，不由 Task 直接写入。
8. Runtime API 可以展示 Task 全生命周期。

## 7. 推荐开发阶段

### Phase 1：Outcome & Observability（已完成基础版）

目标：

- 为 Task failure 增加结构化类型。
- Runtime、Channel 调用失败时写入稳定分类。
- Task 运行中持续更新 progress。
- API 返回中文错误消息，内部保留英文 code。

验收：

- failed / canceled Task 能区分模型失败、取消、超时、租约过期、渠道投递失败。
- `GET /api/runtime/tasks/:id` 返回 progress 和 failure 字段。
- 相关测试覆盖 schema、store、runtime、route。

### Phase 2：Task Plan 与依赖

目标：

- 支持一个复杂 Task 拆成多个 step 或 child Task。
- 支持简单依赖关系。
- 保持单 Agent 单线程原则。

验收：

- 任务可以显示 plan。
- 依赖未完成时不会提前执行。

### Phase 3：外部渠道幂等落地

目标：

- Feishu 使用外部 message id 生成 `idempotency_key`。
- 未来 WeChat、Webhook 复用同一模式。

验收：

- 同一条外部消息重复投递，只创建一个 Task。
- 事件中能看到重复投递被复用。

### Phase 4：可观察运行状态增强

目标：

- 运行中 Task 可看到当前阶段、当前工具、最近输出和续约状态。

验收：

- Runtime API 能展示运行中的 Task 摘要。
- 前端控制台可选展示。

## 8. 文档维护要求

修改以下路径时，必须同步更新本文档和 `docs/project-module-map.md`：

```text
src/tasks/
```

如果修改 Runtime 中和 Task 生命周期强相关的逻辑，也应该更新本文档：

```text
src/runtime/agent-runtime.ts
src/runtime/internal-runner.ts
src/channels/external-runner.ts
src/routes/runtime.ts
```

同步更新时至少检查：

1. 当前已有能力是否变化。
2. 模块边界是否变化。
3. 数据字段是否变化。
4. 事件类型是否变化。
5. API 是否变化。
6. 后续阶段优先级是否变化。
