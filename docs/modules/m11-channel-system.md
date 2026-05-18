# M11 Channel System

本文档记录 Channel System 的模块边界。以后修改 `src/channels/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Channel**：外部输入输出渠道，例如 Web、飞书、未来微信。
- **Delivery**：消息投递，把 Agent 结果发回外部渠道。
- **Idempotency Key**：幂等键，用来避免外部重复消息创建重复 Task。

## 1. 模块定位

Channel System 负责把外部消息接入 Runtime，并把结果发回对应渠道。

它应该负责：

- 渠道身份映射。
- 渠道 conversation 映射。
- 调用 `ChannelService` 创建 Task。
- 外部渠道 runner 执行和回发。
- 渠道投递失败事件。

它不应该负责：

- 直接绕过 Task 系统执行模型。
- 直接写长期记忆。
- 直接写 Agent 配置。

## 2. 当前相关代码

```text
src/channels/
```

## 3. 当前状态

当前 Channel System 已支持：

- Web channel。
- Feishu WebSocket MVP。
- Feishu onboarding 和 binding。
- 外部渠道队列 drain。
- 外部渠道最终回复会对空模型输出做兜底，避免飞书收到空消息。
- 外部渠道任务终态 episode 生成（已接入 `finalizeEpisodeForTask()`，覆盖完成、失败、投递失败、任务不可执行、审批后恢复等路径）。
- 外部渠道 runner 在调用模型前会复用 Runtime 的 RAG-in-context 流程，按当前 task input 检索少量相关长期记忆并交给 Prompt & Context 注入。
- WeChat stub。

本轮模块拆分与幂等改动对 Channel 的影响：

- `ChannelMessageInput` 新增可选 `idempotency_key` 字段，并由 `ChannelService.receiveMessage()` 原样透传给 `createTask()`。
- `feishu-dispatch.ts` 现在使用 `feishu:${appId}:${messageId}` 生成稳定幂等键。这里的“幂等”指同一条外部消息即使重复投递，也只会创建一次内部 Task，而不是重复执行多次。
- 这次改动把外部消息唯一标识的生成放在渠道适配层，把 Task 去重复用留给 Task System，模块边界更清楚：Channel 负责提供稳定外部 ID，Task 负责判定是否复用既有任务。
- 这意味着飞书消息重复回放、重连后重投或平台侧重复回调时，系统更容易保持“一条消息对应一个 Task”的行为。

本轮 M3 改动对 Channel 的影响：

- 外部渠道 runner 会写 Task progress。
- 渠道最终投递失败归入 `failure_stage='delivery'`。
- 渠道失败会写入结构化 outcome，方便 Runtime API 解释失败。
- `ChannelService` 作为统一入口，现在也承担把渠道侧幂等键带进 Task System 的职责。

本轮 P0 / M14 改动对 Channel 的影响：

- Channel 侧没有直接新增备份逻辑，但它依赖的 Task / Session / Event SQLite 数据现在可通过 Runtime Control API 备份和导出，便于后续排查重复投递和消息回放问题。

本轮 M7 改动对 Channel 的影响：

- 外部渠道 runner（`external-runner.ts`）在所有终态路径接入 `finalizeEpisodeForTask()`：正常完成、失败、投递失败、任务不可执行、审批后恢复完成/失败。
- 飞书等外部渠道任务现在和 Web / internal runner 一样，完成后会生成 episode 经历摘要，记录任务状态、失败分类、关键步骤等信息。
- episode 生成失败时只写 `episode.failed` 审计事件，不会回滚渠道任务的终态或阻碍投递。

本轮飞书空回复修复对 Channel 的影响：

- `external-runner.ts` 不再直接把空的 `generateText().text` 投递给飞书。
- 外部渠道模型调用显式设置 DeepSeek `thinking: disabled`，和 Web 聊天默认行为保持一致，避免只返回 reasoning 而没有最终正文。
- 如果模型执行了工具但没有生成最终文本，会把最近工具结果摘要作为可见回复和 Task result。
- 如果模型没有文本也没有工具结果，会回发明确兜底文案，避免用户看到空白消息。
- 审批恢复后的飞书回复也复用同一空输出兜底逻辑。

本轮 RAG-in-context 改动对 Channel 的影响：

- `external-runner.ts` 的普通外部渠道执行、审批恢复执行和队列 drain 都会把 `task.input` 用作记忆检索 query。query 指检索查询文本，也就是用来从长期记忆中找相关内容的输入。
- 外部渠道不会自己解析、写入或过滤长期记忆，只把检索出的记忆片段传给 Prompt & Context 模块统一注入。
- 记忆检索失败不会改变渠道任务终态，也不会阻止飞书等渠道回发；失败会在 prompt 构建层降级为空记忆上下文。
- 测试中可通过 `memorySearcher` 注入假检索函数，避免外部渠道单元测试依赖真实 embedding 服务。embedding 指把文本转换成向量，方便做语义相似度搜索。

## 4. 后续需要补齐

- 为更多渠道统一生成稳定 `idempotency_key`，例如未来微信 message id、webhook event id。
- 微信真实接入。
- 附件和富文本处理。
- 多渠道统一错误反馈。
- 外部渠道投递重试后的 episode 更新策略：同一 task 多次投递后 episode 是否需要反映最终投递状态。
- 外部渠道 RAG-in-context 的可观察性：后续可在事件或 timeline 中展示是否命中记忆、命中数量和检索降级原因。
