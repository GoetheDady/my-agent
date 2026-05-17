# M4 Runtime Execution

本文档记录 Runtime Execution 的模块边界。以后修改 `src/runtime/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Runtime Execution**：真正执行 Task 的运行时管线。
- **Runner**：执行器。这里指 Web 流式 runner、内部任务 runner 等具体执行入口。
- **Progress**：运行进度，表示 Task 当前处于哪个执行阶段。

## 1. 模块定位

Runtime Execution 负责把已领取的 Task 交给模型和工具执行，并把过程写入 Task 与 Event。

它应该负责：

- 领取或确认 Task 可运行。
- 构建 prompt。
- 构建当前 Agent 可用工具。
- 调用模型。
- 维护 Task 租约。
- 写入进度和运行事件。
- 在完成、失败、取消时释放 Agent。

它不应该负责：

- 创建长期记忆。
- 沉淀 Skill。
- 直接写 `agent.json`。
- 处理渠道协议细节。

## 2. 当前相关代码

```text
src/runtime/agent-runtime.ts
src/runtime/internal-runner.ts
```

## 3. 当前状态

当前 Runtime 已支持：

- Web 流式任务执行。
- 内部 delegation / callback 任务执行。
- 20 秒租约续约。
- 模型调用超时与 abort signal。
- 成功、失败、取消时释放 Agent。
- Web 工具审批续跑时，UI message stream 会带上原始 `messages`，让 AI SDK 能把批准后的工具输出合并回上一条 assistant 消息，而不是在服务端丢失工具调用上下文。
- 工具执行统一经过审计包装，执行前写 `tool.call`，执行后写 `tool.result`，并更新 Task progress metadata。
- Runtime 领取任务时会尊重 Task Dependency；依赖未完成的 task 保持 queued，并通过 `blocked` progress 解释原因。

本轮 M3 改动对 Runtime 的影响：

- Web runner 和 internal runner 会更新 `progress_status`、`progress_message`、`last_progress_at`。
- Web runner 收到工具相关 stream chunk 时会切到 `using_tool`；internal runner 检测到工具结果后也会记录工具进度。
- 模型错误、超时、客户端中断会写入结构化失败分类。
- 客户端中断现在归为 `canceled`，并记录 `user_canceled / cancel / retriable=false`。
- Task Plan / Dependency v1 后，Runtime 不负责自动拆解计划，只消费 Task Queue 给出的可运行任务。依赖 gating 属于 Task Queue，不绕过单 Agent 单线程模型。

本轮 M7 改动对 Runtime 的影响：

- Episode 生成从仅覆盖 completed 任务，扩展到所有终态（completed、failed、canceled）。
- `finalizeEpisodeForTask()` 替代原来的 `upsertEpisodeForTask()` + try-catch 模式，episode 生成失败时只写审计事件、不回滚任务终态。
- 用户取消和任务失败均会在 runner 中触发 episode 生成，确保失败经历也被记录。

## 4. 后续需要补齐

- 更细的模型错误分类。
- 执行上下文快照。
- running task 的当前步骤和最近输出已有基础展示；Task Plan step 已可展示结构化计划，后续需要进一步补模型 step、token 用量和更细的工具失败语义。
- 审批续跑仍需要更完整的任务语义：当前会创建新的 runtime task 执行批准后的工具，后续可考虑把“等待审批”和“审批后继续”建模为同一 Task 的暂停/恢复。
